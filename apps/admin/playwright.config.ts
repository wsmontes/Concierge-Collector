import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // O stack de qualificação é UM ambiente compartilhado: os specs disputam
  // o mesmo usuário dev (dev@collectordev.com) e os mesmos login states do
  // CMS — em paralelo, um handoff 401ava o do vizinho (callback 401 e
  // Explorer sem sessão no gate). Serializar é o isolamento correto aqui.
  workers: 1,
  // O Admin de qualificação é `next dev` (Turbopack): a PRIMEIRA visita a cada
  // rota compila no servidor e pode passar de 5s, e o default do Playwright
  // para `expect` estourava ali — o gate falhava por cold start com a página
  // correta, não por defeito de produto (medido: mesmo commit, servidor quente,
  // o mesmo spec passa em 1,6 min). 20s mantém a asserção significativa e cobre
  // o primeiro compile; `actionTimeout` fica no default porque clicar já espera
  // o elemento ficar acionável.
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.CMS_E2E_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
})
