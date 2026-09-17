/**
 * Hook de instrumentação do Next: o ponto onde o processo do servidor começa.
 *
 * `register()` roda UMA vez por processo de servidor, antes de atender a
 * primeira requisição — é o único lugar onde dá para subir trabalho de fundo sem
 * amarrá-lo a uma request (e sem um quarto processo no container, que é o que
 * este runner veio eliminar; ver `src/jobs/inProcessRunner.ts`).
 *
 * Só no runtime `nodejs`: o hook também roda no runtime de edge, onde não existe
 * Mongo nem `payload`. O import é dinâmico exatamente por isso — o runner alcança
 * `payload`/mongoose, e um import estático os amarraria ao bundle de edge.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startInProcessJobs } = await import('./src/jobs/inProcessRunner')
  await startInProcessJobs()
}
