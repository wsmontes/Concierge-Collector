// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * O runner in-process substitui um processo supervisionado inteiro: ele é quem
 * CRIA os jobs agendados (heartbeat, reconciliação, retenção) e quem drena as
 * filas. Um build verde não prova nada disso, então aqui se testa o
 * comportamento: ordem (agendar antes de drenar), lote sequencial, sem
 * sobreposição de ciclos, e retentativa depois de um ciclo que falha.
 */

const getPayload = vi.fn()

vi.mock('payload', () => ({ getPayload: (...args: unknown[]) => getPayload(...args) }))
vi.mock('@payload-config', () => ({ default: { collections: [] } }))

interface JobSpy {
  handleSchedules: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
}

function payloadWith(jobs: JobSpy) {
  return { jobs }
}

/** Importa o módulo do zero: o estado do runner é estado de processo. */
async function loadRunner() {
  vi.resetModules()
  getPayload.mockReset()
  return import('../../../src/jobs/inProcessRunner')
}

async function startWith(jobs: JobSpy) {
  // `loadRunner` reseta os mocks (o estado do runner é estado de processo),
  // então o valor resolvido é configurado DEPOIS do reset.
  const runner = await loadRunner()
  getPayload.mockResolvedValue(payloadWith(jobs))
  await runner.startInProcessJobs()
  return runner
}

beforeEach(() => {
  vi.useFakeTimers()
  delete process.env.CMS_JOBS_INPROCESS
  delete process.env.CMS_JOBS_INTERVAL_MS
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.CMS_JOBS_INPROCESS
  delete process.env.CMS_JOBS_INTERVAL_MS
})

describe('runner de jobs in-process', () => {
  test('agenda os jobs ANTES de drenar, em lote sequencial', async () => {
    const ordem: string[] = []
    const jobs: JobSpy = {
      handleSchedules: vi.fn(async () => {
        ordem.push('schedules')
        return { created: 0 }
      }),
      run: vi.fn(async () => {
        ordem.push('run')
        return {}
      }),
    }
    const runner = await startWith(jobs)

    await vi.advanceTimersByTimeAsync(5_000)

    // Ordem invertida pararia os agendados em silêncio (é a diferença entre o
    // comando `jobs:run --handle-schedules` e o `autoRun`, que só drena).
    expect(ordem).toEqual(['schedules', 'run'])
    expect(jobs.run).toHaveBeenCalledWith({ allQueues: true, sequential: true, limit: 10 })
    expect(runner.inProcessJobsState.runs).toBe(1)
    expect(runner.inProcessJobsState.lastRunAt).not.toBeNull()
  })

  test('subir duas vezes não duplica o runner', async () => {
    const jobs: JobSpy = { handleSchedules: vi.fn(async () => ({})), run: vi.fn(async () => ({})) }
    const runner = await startWith(jobs)

    await runner.startInProcessJobs()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(getPayload).toHaveBeenCalledTimes(1)
    expect(jobs.handleSchedules).toHaveBeenCalledTimes(1)
  })

  test('um ciclo que falha é registrado e o próximo tenta de novo', async () => {
    const jobs: JobSpy = {
      handleSchedules: vi
        .fn()
        .mockRejectedValueOnce(new Error('mongo indisponível'))
        .mockResolvedValue({ created: 1 }),
      run: vi.fn(async () => ({})),
    }
    const runner = await startWith(jobs)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(runner.inProcessJobsState.lastError).toBe('mongo indisponível')
    expect(jobs.run).not.toHaveBeenCalled()
    expect(runner.inProcessJobsState.runs).toBe(0)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(jobs.run).toHaveBeenCalledTimes(1)
    expect(runner.inProcessJobsState.lastError).toBeNull()
    expect(runner.inProcessJobsState.runs).toBe(1)
  })

  test('ciclo lento não sobrepõe o seguinte', async () => {
    let liberar = () => {}
    const lento = new Promise<void>((resolve) => {
      liberar = resolve
    })
    const jobs: JobSpy = {
      handleSchedules: vi.fn(async () => ({})),
      run: vi.fn(async () => {
        await lento
        return {}
      }),
    }
    const runner = await startWith(jobs)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(jobs.run).toHaveBeenCalledTimes(1)

    // Três intervalos passam com o ciclo ainda em execução: sem o agendamento
    // recursivo (ou sem a guarda), seriam três drenos concorrentes — dentro do
    // processo que também renderiza, que é o pico que a mudança veio evitar.
    await vi.advanceTimersByTimeAsync(180_000)
    expect(jobs.run).toHaveBeenCalledTimes(1)

    liberar()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(jobs.run).toHaveBeenCalledTimes(2)
    expect(runner.inProcessJobsState.runs).toBe(2)
  })

  test('CMS_JOBS_INPROCESS=false desliga o runner sem tocar no Payload', async () => {
    process.env.CMS_JOBS_INPROCESS = 'false'
    const jobs: JobSpy = { handleSchedules: vi.fn(async () => ({})), run: vi.fn(async () => ({})) }
    getPayload.mockResolvedValue(payloadWith(jobs))
    const runner = await loadRunner()

    await runner.startInProcessJobs()
    await vi.advanceTimersByTimeAsync(300_000)

    expect(getPayload).not.toHaveBeenCalled()
    expect(jobs.handleSchedules).not.toHaveBeenCalled()
  })

  test('o intervalo é configurável', async () => {
    process.env.CMS_JOBS_INTERVAL_MS = '5000'
    const jobs: JobSpy = { handleSchedules: vi.fn(async () => ({})), run: vi.fn(async () => ({})) }
    await startWith(jobs)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(jobs.handleSchedules).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(jobs.handleSchedules).toHaveBeenCalledTimes(2)
  })
})
