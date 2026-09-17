import { defineConfig } from '@playwright/test'
import { collectorBaseUrl, isEnabled } from './preconditions'

/**
 * Harness de autoração do Collector (frontend vanilla em `scripts/`).
 *
 * Isolado do Playwright do Admin (`apps/admin/playwright.config.ts`): outro
 * alvo, outra suíte, outro banco. Sem dependência nova — `@playwright/test`
 * vem do hoist do workspace.
 *
 * O Collector é servido da RAIZ do repo (é um site estático com `index.html`
 * na raiz); o harness sobe esse servidor sozinho para que
 * `http://127.0.0.1:5500` — o host que `scripts/core/config.js` reconhece como
 * local e que o FRONTEND_URL do FastAPI libera em CORS — esteja no ar.
 *
 * Rodar:  COLLECTOR_E2E=1 npx playwright test        (com o stack de pé)
 * Pular:  npx playwright test                        (sem a flag, sai 0)
 */
const enabled = isEnabled()
const baseURL = collectorBaseUrl()
const port = new URL(baseURL).port || (new URL(baseURL).protocol === 'https:' ? '443' : '80')

export default defineConfig({
    testDir: '.',
    testMatch: '**/*.spec.ts',
    // Um ambiente compartilhado e um IndexedDB por profile: os passos do
    // encadeamento são sequenciais por natureza.
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    timeout: 180_000,
    // Mesmo motivo do Admin: o boot do Collector é serviço pesado (auth +
    // DataStore + pull inicial) e as asserções de tela nunca devem correr
    // contra um app que ainda está subindo.
    expect: { timeout: 30_000 },
    reporter: [['list']],
    outputDir: new URL('./test-results', import.meta.url).pathname,
    globalSetup: './global-setup.ts',
    use: {
        baseURL,
        viewport: { width: 1280, height: 900 },
        trace: 'retain-on-failure',
    },
    // O servidor estático só existe quando o harness está ligado: sem a flag a
    // suíte é pulada e o comando precisa sair 0 mesmo sem stack no ar.
    webServer: enabled
        ? {
              command: `python3 -m http.server ${port} --bind 127.0.0.1`,
              cwd: new URL('../..', import.meta.url).pathname,
              url: baseURL,
              reuseExistingServer: true,
              timeout: 30_000,
              stdout: 'ignore',
              stderr: 'pipe',
          }
        : undefined,
})
