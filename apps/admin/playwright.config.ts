import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // O stack de qualificação é UM ambiente compartilhado: os specs disputam
  // o mesmo usuário dev (dev@collectordev.com) e os mesmos login states do
  // CMS — em paralelo, um handoff 401ava o do vizinho (callback 401 e
  // Explorer sem sessão no gate). Serializar é o isolamento correto aqui.
  workers: 1,
  use: {
    baseURL: process.env.CMS_E2E_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
})
