import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const text = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('Collector durable recovery wiring', () => {
  test('durable recovery override loads before DataStore instantiates DatabaseManager', () => {
    const html = text('index.html')
    const manager = html.indexOf('scripts/storage/databaseManager.js')
    const diagnostics = html.indexOf('scripts/storage/databaseDiagnostics.js')
    const dataStore = html.indexOf('scripts/storage/dataStore.js')
    expect(manager).toBeGreaterThan(-1)
    expect(diagnostics).toBeGreaterThan(manager)
    expect(dataStore).toBeGreaterThan(diagnostics)
  })

  test('production recovery override backs up Blob-bearing stores and never reads legacy backup JSON', () => {
    const source = text('scripts/storage/databaseDiagnostics.js')
    expect(source).toContain("'pendingAudio'")
    expect(source).toContain("'syncQueue'")
    expect(source).toContain("localStorage.removeItem('concierge_db_backup')")
    expect(source).not.toContain("localStorage.getItem('concierge_db_backup')")
    expect(source).toContain('proto.restoreBackup = async function restoreDurableBackup')
  })
})
