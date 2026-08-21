// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const managerSource = readFileSync(path.join(root, 'scripts/storage/databaseManager.js'), 'utf8')
const diagnosticsSource = readFileSync(path.join(root, 'scripts/storage/databaseDiagnostics.js'), 'utf8')

const local = new Map()
globalThis.localStorage = {
  getItem: (key) => local.get(key) ?? null,
  setItem: (key, value) => local.set(key, String(value)),
  removeItem: (key) => local.delete(key),
  clear: () => local.clear(),
}
globalThis.ModuleWrapper = {
  defineClass: (name, cls) => {
    globalThis[name] = cls
    return cls
  },
  createInstance: () => undefined,
}
globalThis.Logger = { module: () => ({ debug() {}, info() {}, warn() {}, error() {}, log() {} }) }
globalThis.Dexie = Dexie

afterEach(async () => {
  for (const name of ['ConciergeCollector', 'ConciergeCollector-Recovery']) {
    await Dexie.delete(name).catch(() => {})
  }
  localStorage.clear()
  delete globalThis.DatabaseManager
  delete globalThis.DatabaseDiagnostics
  delete globalThis.DB
})

beforeEach(async () => {
  for (const name of ['ConciergeCollector', 'ConciergeCollector-Recovery']) {
    await Dexie.delete(name).catch(() => {})
  }
  localStorage.clear()
})

const schema = {
  entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
  curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status, lastAccessedAt, source',
  curators: '++id, curator_id, name, email, status, createdAt, lastActive',
  drafts: '++id, type, data, curator_id, createdAt, lastModified',
  syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
  settings: 'key',
  cache: 'key, expires',
  draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
  pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status',
  _meta: 'key',
}

function loadProductionDatabaseManager() {
  // Reproduce index.html ordering: databaseManager first, diagnostics immediately
  // afterwards; the latter installs the durable recovery prototype before DataStore.
  // eslint-disable-next-line no-new-func
  const loadManager = new Function('window', `${managerSource}\nreturn window.DatabaseManager;`)
  const Manager = loadManager(globalThis)
  // eslint-disable-next-line no-new-func
  const loadDiagnostics = new Function('window', `${diagnosticsSource}\nreturn window.DatabaseManager;`)
  loadDiagnostics(globalThis)
  return Manager
}

async function seedManager() {
  const Manager = loadProductionDatabaseManager()
  const manager = new Manager({ currentVersion: 92, retryAttempts: 1 })
  const db = new Dexie('ConciergeCollector')
  db.version(92).stores(schema)
  await db.open()
  await db._meta.put({ key: 'version', value: 92 })
  await db.entities.put({
    entity_id: 'e-local', type: 'restaurant', name: 'Local only', status: 'active',
    sync: { status: 'pending' },
  })
  await db.syncQueue.put({ type: 'entity', action: 'create', entity_id: 'e-local', data: {} })
  const audio = new Blob(['unique-audio-bytes'], { type: 'audio/webm' })
  await db.pendingAudio.put({ restaurantId: 'r1', status: 'pending', timestamp: Date.now(), blob: audio })
  manager.db = db
  return manager
}

describe('DatabaseManager durable recovery backend', () => {
  test('production load order replaces legacy localStorage backup and preserves Blob data', async () => {
    const manager = await seedManager()
    localStorage.setItem('concierge_db_backup', JSON.stringify({ legacy: true }))

    await manager.createBackup()

    expect(localStorage.getItem('concierge_db_backup')).toBeNull()
    const recovery = new Dexie('ConciergeCollector-Recovery')
    recovery.version(1).stores({ snapshots: 'key,timestamp' })
    await recovery.open()
    const snapshot = await recovery.snapshots.get('latest')
    expect(snapshot.stores.entities).toHaveLength(1)
    expect(snapshot.stores.syncQueue).toHaveLength(1)
    expect(snapshot.stores.pendingAudio).toHaveLength(1)
    expect(snapshot.stores.pendingAudio[0].blob).toBeInstanceOf(Blob)
    expect(await snapshot.stores.pendingAudio[0].blob.text()).toBe('unique-audio-bytes')
    recovery.close()
  })

  test('attemptRecovery works after it closes/nulls the primary connection', async () => {
    const manager = await seedManager()
    await manager.createBackup()

    await manager.db.entities.clear()
    await manager.db.syncQueue.clear()
    await manager.db.pendingAudio.clear()

    expect(await manager.attemptRecovery()).toBe(true)
    expect(manager.db?.isOpen()).toBe(true)
    expect(await manager.db.entities.count()).toBe(1)
    expect(await manager.db.syncQueue.count()).toBe(1)
    const restoredAudio = await manager.db.pendingAudio.toArray()
    expect(restoredAudio).toHaveLength(1)
    expect(await restoredAudio[0].blob.text()).toBe('unique-audio-bytes')
  })

  test('legacy localStorage snapshot is never read by the production recovery override', async () => {
    const manager = await seedManager()
    await manager.createBackup()
    const originalGetItem = localStorage.getItem
    localStorage.getItem = vi.fn((key) => {
      if (key === 'concierge_db_backup') throw new Error('legacy backup must not be read')
      return originalGetItem(key)
    })

    await manager.db.entities.clear()
    await expect(manager.attemptRecovery()).resolves.toBe(true)
    expect(await manager.db.entities.count()).toBe(1)
    expect(localStorage.getItem).not.toHaveBeenCalledWith('concierge_db_backup')
    localStorage.getItem = originalGetItem
  })

  test('without a durable backup, unsaved work prevents the nuclear fallback', async () => {
    const manager = await seedManager()
    await Dexie.delete('ConciergeCollector-Recovery').catch(() => {})
    const originalDelete = Dexie.delete
    const deletes = []
    Dexie.delete = async (name) => {
      deletes.push(name)
      return originalDelete.call(Dexie, name)
    }
    try {
      expect(await manager.attemptRecovery()).toBe(false)
      expect(deletes).not.toContain('ConciergeCollector')
    } finally {
      Dexie.delete = originalDelete
    }
  })
})
