import { assertDisposableStack, isEnabled, seedFixtures } from './preconditions'

/**
 * Guardas do harness de autoração — rodam ANTES de qualquer browser.
 *
 * 1. Loopback em `COLLECTOR_E2E_BASE_URL` e `COLLECTOR_E2E_API_URL`;
 * 2. banco servido pela API terminando em `-test` (lido de `/api/v3/info`);
 * 3. CORS liberando a origem do Collector (sem isso o app não passa do login);
 * 4. fixture do repo recriada (Entities + Curations do seed oficial).
 *
 * Sem `COLLECTOR_E2E=1` nada disso roda: a suíte é pulada e o comando sai 0.
 */
export default async function globalSetup(): Promise<void> {
    if (!isEnabled()) return

    const stack = await assertDisposableStack()
    const seeded = seedFixtures(stack.database)

    // eslint-disable-next-line no-console
    console.log(
        `[authoring-e2e] stack descartável ok — banco=${stack.database} api=${stack.api} collector=${stack.collectorOrigin}\n` +
            `[authoring-e2e] fixture: ${seeded}`
    )
}
