/**
 * Runner de jobs do CMS dentro do processo do Admin.
 *
 * ## Por que ele existe
 *
 * O serviço fundido rodava QUATRO processos nos 512 MB do plano Starter
 * (uvicorn, Next/SSR, runner de jobs e nginx). Medido em 2026-09-16/17: o
 * container vive a ~450 MB de pico, e cada estouro mata o container inteiro —
 * `supervisord started` sem nenhuma linha de erro antes, ~30 s de 502 em todas
 * as superfícies, 5 vezes em dois dias. O runner era o processo mais caro que
 * dava para eliminar sem perder semântica: ele carregava uma SEGUNDA cópia do
 * Payload (config + mongoose + tasks) só para drenar filas.
 *
 * Aqui o trabalho é o mesmo, no processo que já tem o Payload carregado. O ganho
 * é de memória residente, não de código: some um processo sem que nada deixe de
 * acontecer.
 *
 * ## A semântica é a do comando, não a do `autoRun`
 *
 * `payload jobs:run --handle-schedules` faz DUAS coisas: cria os jobs agendados
 * (heartbeat, reconciliação de leases, retenção) e drena as filas. O
 * `jobs.autoRun` do Payload só drena — trocar por ele pararia os agendados em
 * silêncio. Por isso este runner chama `handleSchedules()` e depois `run()`, na
 * mesma ordem do comando, e a cada ciclo (não só no boot).
 *
 * ## Reversão em uma linha
 *
 * `CMS_JOBS_INPROCESS=false` desliga este runner; o processo dedicado volta
 * ligando o programa `jobs` do `deploy/supervisord.conf`. As duas formas usam o
 * MESMO código de task — os leases/fencing do banco são o que garante que dois
 * drenos simultâneos não apliquem a mesma operação duas vezes.
 */

/** Intervalo entre ciclos. Um minuto é a granularidade dos agendados. */
const DEFAULT_INTERVAL_MS = 60_000

/**
 * Lote por ciclo, executado SEQUENCIALMENTE.
 *
 * As duas decisões são independentes e as duas importam:
 *
 * - `sequential: true` é o que protege a memória: um job ativo por vez, sem
 *   várias transações/Payload abrindo ao mesmo tempo enquanto o Next renderiza.
 *   O pico é o de UM job, não o da fila.
 * - `limit: 10` (o mesmo default do comando antigo) é o que protege o
 *   THROUGHPUT: com um job por ciclo, publicação e materialização ficariam
 *   atrás de heartbeat/reconciliação, que são criados em todo ciclo. Sequencial
 *   com lote dá o pico de um e a vazão de dez.
 *
 * Se um ciclo gastar mais que o intervalo, o agendamento recursivo espera o
 * ciclo terminar antes de marcar o próximo (não há sobreposição).
 */
const JOBS_PER_CYCLE = 10

/**
 * Estado do runner para observabilidade: o worker como processo próprio tinha
 * heartbeat em coleção; aqui ele vive no mesmo processo do SSR, e expor o
 * último ciclo é o que permite provar que ele está vivo.
 */
export const inProcessJobsState: { lastRunAt: Date | null; lastError: string | null; runs: number } = {
  lastRunAt: null,
  lastError: null,
  runs: 0,
}

/**
 * O flag vive no `globalThis`, não no módulo.
 *
 * `register()` pode rodar mais de uma vez (dev/HMR re-avalia o módulo do hook, e
 * o Next pode ter mais de um contexto de servidor), e aí um `let` local nasceria
 * de novo — criando uma SEGUNDA cadeia recursiva de ciclos no mesmo processo,
 * cada uma drenando a fila por conta própria. O símbolo é a chave para não
 * colidir com nada de outro pacote.
 */
const STARTED = Symbol.for('concierge.admin.jobsInProcessStarted')

let started = false

export async function startInProcessJobs(): Promise<void> {
  const guard = globalThis as typeof globalThis & { [STARTED]?: boolean }
  if (started || guard[STARTED]) return
  started = true
  guard[STARTED] = true
  if (process.env.CMS_JOBS_INPROCESS === 'false') {
    console.info('[jobs] runner in-process desligado por CMS_JOBS_INPROCESS=false')
    return
  }
  started = true

  // Import dinâmico de propósito: `payload` (e o mongoose por trás) só existe no
  // runtime Node, e este arquivo é alcançável a partir do hook de instrumentação,
  // que o Next também compila para edge. Um import estático amarraria Mongo e
  // config ao bundle de edge e a compilação falharia.
  const [{ getPayload }, config] = await Promise.all([
    import('payload'),
    import('@payload-config').then((module) => module.default),
  ])
  const payload = await getPayload({ config })
  const intervalMs = Number(process.env.CMS_JOBS_INTERVAL_MS ?? DEFAULT_INTERVAL_MS)

  let running = false

  async function cycle(): Promise<void> {
    // Guarda contra sobreposição: um ciclo que passa do intervalo não pode
    // começar outro por cima. Sem isso, `setInterval` + `void cycle()`
    // empilham drenos quando o banco está lento — e dois drenos concorrentes
    // dentro do processo do SSR é justamente o pico que a mudança veio evitar.
    if (running) {
      console.warn('[jobs] ciclo anterior ainda em execução; pulando este')
      return
    }
    running = true
    try {
      // `handleSchedules` PRIMEIRO: é ele que cria os agendados. `run` sozinho
      // (o que o `autoRun` faz) deixaria heartbeat, reconciliação e retenção
      // sem nunca serem enfileirados.
      await payload.jobs.handleSchedules({ allQueues: true })
      await payload.jobs.run({ allQueues: true, sequential: true, limit: JOBS_PER_CYCLE })
      inProcessJobsState.lastRunAt = new Date()
      inProcessJobsState.lastError = null
      inProcessJobsState.runs += 1
    } catch (error) {
      // Uma falha de ciclo não pode derrubar o servidor de páginas: registra e
      // tenta de novo no próximo. É o mesmo comportamento do runner antigo, que
      // o supervisor reiniciava.
      inProcessJobsState.lastError = error instanceof Error ? error.message : 'unknown_error'
      console.error('[jobs] ciclo falhou', inProcessJobsState.lastError)
    } finally {
      running = false
    }
  }

  /**
   * Agendamento RECURSIVO, não `setInterval`: o próximo ciclo é marcado quando o
   * anterior termina, então o intervalo é o piso entre ciclos e não uma
   * promessa de pontualidade que vira sobreposição quando o trabalho demora.
   */
  async function loop(): Promise<void> {
    await cycle()
    const next = setTimeout(() => void loop(), intervalMs)
    next.unref?.()
  }

  // O primeiro ciclo espera o servidor terminar de subir: durante o boot o SSR
  // precisa da memória e da conexão mais do que a fila precisa de um minuto.
  const first = setTimeout(() => void loop(), 5_000)
  first.unref?.()
  console.info(`[jobs] runner in-process ativo (intervalo ${intervalMs}ms, até ${JOBS_PER_CYCLE} jobs/ciclo, sequencial)`)
}
