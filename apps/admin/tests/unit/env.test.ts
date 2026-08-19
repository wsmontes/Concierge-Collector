import { afterEach, describe, expect, test } from 'vitest'
import { readEnv } from '../../src/env'

const original = { ...process.env }
afterEach(() => { process.env = { ...original } })

describe('readEnv', () => {
  test('falha fechado sem os três segredos/configs obrigatórios', () => {
    delete process.env.CMS_MONGODB_URL
    delete process.env.CMS_SERVICE_KEY
    delete process.env.FASTAPI_BASE_URL
    delete process.env.PAYLOAD_SECRET
    delete process.env.CMS_PUBLIC_SERVER_URL
    expect(() => readEnv()).toThrow('CMS_MONGODB_URL')
  })

  test('fixa o banco lógico CMS', () => {
    process.env.CMS_MONGODB_URL = 'mongodb://localhost:27017'
    process.env.CMS_MONGODB_DB_NAME = 'concierge-cms-test'
    process.env.CMS_SERVICE_KEY = 'test-cms-service-key'
    process.env.FASTAPI_BASE_URL = 'http://localhost:8000'
    process.env.METRICS_KEY = 'test-metrics-key'
    process.env.PAYLOAD_SECRET = 'x'.repeat(32)
    process.env.CMS_PUBLIC_SERVER_URL = 'http://localhost:3000'
    expect(readEnv().cmsDatabaseName).toBe('concierge-cms-test')
  })
})
