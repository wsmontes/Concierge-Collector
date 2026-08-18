/**
 * Testes de migração/integridade do DatabaseManager.
 *
 * Regressão P0: o sentinel de versão (`_checkSchemaSentinel`) apagava o
 * IndexedDB INTEIRO (Dexie.delete) quando a versão do código mudava —
 * antes de qualquer migração rodar. Numa app offline-first, um item
 * pending no IndexedDB pode ser a ÚNICA cópia de uma curadoria.
 *
 * Contratos testados:
 * - upgrade 92→93 preserva dados (nunca Dexie.delete no upgrade normal)
 * - sentinel mismatch NÃO apaga
 * - reset destrutivo é RECUSADO quando existe trabalho não sincronizado
 * - backup/restore usa os nomes reais das stores (syncQueue, não sync_queue)
 *
 * Roda em ambiente NODE (não jsdom): o Dexie REAL quebra o formatador de
 * stack no jsdom (nenhum outro teste usa Dexie real — todos usam o mock
 * do conftest). Polyfills mínimos no próprio arquivo.
 */
// @vitest-environment node
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/storage/databaseManager.js'),
  'utf8'
);

// Polyfills do ambiente de browser que o DatabaseManager usa
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};
globalThis.ModuleWrapper = {
  defineClass: (name, cls) => {
    if (!globalThis[name]) globalThis[name] = cls;
    return globalThis[name];
  },
  createInstance: (instanceName, className, ...args) => {
    if (!globalThis[instanceName] && globalThis[className]) {
      globalThis[instanceName] = new globalThis[className](...args);
    }
    return globalThis[instanceName];
  }
};
globalThis.Logger = { module: () => ({ debug() {}, info() {}, warn() {}, error() {}, log() {} }) };
globalThis.Dexie = Dexie;

function loadDatabaseManager() {
  delete globalThis.DatabaseManager;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.DatabaseManager;`);
  return fn(globalThis);
}

const SCHEMA_92 = {
  entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status',
  curations: '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status',
  curators: '++id, curator_id, name, email, status, createdAt, lastActive',
  drafts: '++id, type, data, curator_id, createdAt, lastModified',
  syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
  settings: 'key',
  cache: 'key, expires',
  draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
  pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status',
  _meta: 'key'
};

async function seedV92Db(withPendingWork = true) {
  const db = new Dexie('ConciergeCollector');
  db.version(92).stores(SCHEMA_92);
  await db.open();
  await db._meta.put({ key: 'version', value: 92 });
  await db.entities.put({
    entity_id: 'entity_v92', name: 'Sobrevivente', type: 'restaurant', status: 'active',
    data: { address: { street: 'Rua 92' } },
    sync: withPendingWork ? { status: 'pending', lastModified: Date.now() } : { status: 'synced' }
  });
  if (withPendingWork) {
    await db.syncQueue.put({ type: 'entity', action: 'create', local_id: 1, entity_id: 'entity_v92', data: {} });
  }
  await db.curations.put({
    curation_id: 'cur_v92', entity_id: 'entity_v92', status: 'draft', restaurant_name: 'Curadoria 92',
    sync: { status: 'pending' }
  });
  db.close();
}

async function rawDbVersion() {
  const raw = await new Promise((resolve, reject) => {
    const req = indexedDB.open('ConciergeCollector');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const version = raw.version;
  raw.close();
  return version;
}

async function countData() {
  // abre na versão CORRENTE via raw IDB — Dexie version(92) num DB que o
  // manager já migrou pra 93 rejeitaria VersionError (e o formatador de
  // erro do Dexie quebra no ambiente vitest)
  const raw = await new Promise((resolve, reject) => {
    const req = indexedDB.open('ConciergeCollector');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const count = (store) => new Promise((resolve, reject) => {
    const req = raw.transaction(store, 'readonly').objectStore(store).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const getMeta = () => new Promise((resolve) => {
    try {
      const req = raw.transaction('_meta', 'readonly').objectStore('_meta').get('version');
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  const out = {
    entities: await count('entities'),
    curations: await count('curations'),
    syncQueue: await count('syncQueue'),
    version: await getMeta()
  };
  raw.close();
  return out;
}

describe('DatabaseManager — migrações sem wipe destrutivo', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Dexie.delete('ConciergeCollector').catch(() => {});
    localStorage.clear();
  });

  test('fresh install (perfil novo, DB inexistente) inicializa direto, sem erro nem wipe', async () => {
    // Regressão: perfil novo caía em getCurrentVersion→'legacy'→version(0)
    // ("Given version is not a positive number") e o wipe nuclear.
    // Nada semeado, localStorage vazio — o cenário do primeiro load.
    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass({ currentVersion: 93 });

    const db = await manager.initialize();
    expect(db).toBeTruthy();

    const after = await countData();
    expect(after.version).toBe(93);
    expect(after.entities).toBe(0);
    expect(after.curations).toBe(0);
  });

  test('REPRO brick: upgrade legado grava _meta=92 num IDB 1330 e o boot seguinte trava', async () => {
    // Banco da era pré-DatabaseManager: verno 132, schema antigo, SEM _meta.
    // O branch legacy abre em 132, declara 132+1 (→ IDB 1330, Dexie pede
    // verno×10) e grava _meta = currentVersion (92). No boot seguinte o
    // _meta diz 92 → same-version → version(92) → pedido 920 < existente
    // 1330 → VersionError PRA SEMPRE (brick do usuário em produção).
    const legacy = new Dexie('ConciergeCollector');
    legacy.version(132).stores({
      entities: '++id, entity_id',
      curations: '++id, curation_id',
      curators: '++id, curator_id',
      syncQueue: '++id',
      settings: 'key',
      cache: 'key',
      drafts: '++id',
      draftRestaurants: '++id',
      pendingAudio: '++id'
    });
    await legacy.open();
    await legacy.entities.put({ entity_id: 'legacy_1', name: 'Do tempo antigo' });
    legacy.close();

    // Boot 1: branch legacy — upgrade para 1330 e _meta = 92
    const Mgr1 = loadDatabaseManager();
    const m1 = new Mgr1();
    await m1.initialize();
    expect(await rawDbVersion()).toBe(1330);
    m1.db.close();

    // Boot 2 (recarga da página): _meta=92 com IDB real em 1330.
    // Sem o fix, rejeita com VersionError 920<1330 — o brick. (O
    // formatador de stack do Dexie quebra no vitest, então a falha é
    // capturada por flag, sem expect().rejects.)
    const Mgr2 = loadDatabaseManager();
    const m2 = new Mgr2({ retryAttempts: 1, retryDelayMs: 0 });
    let bricked = false;
    try {
      await m2.initialize();
    } catch (e) {
      bricked = true;
    }
    expect(bricked).toBe(false);
    const after = await countData();
    expect(after.entities).toBe(1);
  });

  test('falha transitória do open recupera via retry, sem tocar backup/nuclear', async () => {
    // iOS/Safari (WebKit): o processo IDB pode ser morto pelo OS e o
    // primeiro open rejeita com erro interno truncado ('t'). Uma falha
    // transitória não pode derrubar o app para degraded mode nem tocar
    // em backup/nuclear — retry resolve.
    await seedV92Db(true);
    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass({ retryAttempts: 3, retryDelayMs: 10 });
    const attemptRecoverySpy = vi.spyOn(manager, 'attemptRecovery');

    const RealDexie = globalThis.Dexie;
    let failuresLeft = 1;
    class FlakyDexie extends RealDexie {
      open(...args) {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          return Promise.reject('t');
        }
        return super.open(...args);
      }
    }
    globalThis.Dexie = FlakyDexie;

    try {
      const db = await manager.initialize();
      expect(db).toBeTruthy();
      expect(attemptRecoverySpy).not.toHaveBeenCalled();
      const after = await countData();
      expect(after.entities).toBe(1);
      expect(after.syncQueue).toBe(1);
      expect(after.curations).toBe(1);
    } finally {
      globalThis.Dexie = RealDexie;
    }
  });

  test('upgrade 92→93 preserva entities, curations e syncQueue (nunca Dexie.delete)', async () => {
    await seedV92Db(true);
    localStorage.setItem('concierge_db_schema_version', '92');

    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass({ currentVersion: 93 });
    const deleteCalls = [];
    const originalDelete = Dexie.delete;
    Dexie.delete = (...args) => { deleteCalls.push(args); return originalDelete(...args); };
    await manager.initialize();

    expect(deleteCalls).toHaveLength(0);
    const after = await countData();
    expect(after.entities).toBe(1);
    expect(after.curations).toBe(1);
    expect(after.syncQueue).toBe(1);
    expect(after.version).toBe(93);
    expect(localStorage.getItem('concierge_db_schema_version')).toBe('93');
    Dexie.delete = originalDelete;
  });

  test('sentinel mismatch não apaga o banco', async () => {
    await seedV92Db(true);
    // sentinel antigo (v10) vs código 92: mismatch sem wipe
    localStorage.setItem('concierge_db_schema_version', '10');

    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass();
    const deleteCalls = [];
    const originalDelete = Dexie.delete;
    Dexie.delete = (...args) => { deleteCalls.push(args); return originalDelete(...args); };
    await manager.initialize();

    expect(deleteCalls).toHaveLength(0);
    const after = await countData();
    expect(after.entities).toBe(1);
    expect(after.syncQueue).toBe(1);
    Dexie.delete = originalDelete;
  });

  test('downgrade com trabalho não sincronizado recusa reset destrutivo', async () => {
    // DB em v93 (mais novo que o código em 92) com pending/conflict
    const db = new Dexie('ConciergeCollector');
    db.version(93).stores(SCHEMA_92);
    await db.open();
    await db._meta.put({ key: 'version', value: 93 });
    await db.entities.put({
      entity_id: 'entity_v93', name: 'Única cópia', type: 'restaurant', status: 'active',
      sync: { status: 'pending' }
    });
    db.close();
    localStorage.setItem('concierge_db_schema_version', '93');

    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass({ currentVersion: 92 });
    const deleteCalls = [];
    const originalDelete = Dexie.delete;
    Dexie.delete = (...args) => { deleteCalls.push(args); return originalDelete(...args); };

    // o downgrade com trabalho pendente NÃO pode apagar — init falha
    // (ou degrada), mas os dados ficam
    await expect(manager.initialize()).rejects.toThrow();

    const after = await countData();
    expect(after.entities).toBe(1);
    Dexie.delete = originalDelete;
  });

  test('backup/restore usa os nomes reais das stores (syncQueue roundtrip)', async () => {
    await seedV92Db(true);
    localStorage.setItem('concierge_db_schema_version', '92');

    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass();
    await manager.initialize();

    await manager.createBackup();

    // Corrompe: limpa as stores
    await manager.db.entities.clear();
    await manager.db.curations.clear();
    await manager.db.syncQueue.clear();

    await manager.restoreBackup();

    expect(await manager.db.entities.count()).toBe(1);
    expect(await manager.db.curations.count()).toBe(1);
    expect(await manager.db.syncQueue.count()).toBe(1);
  });

  test('backup que falha aborta o reset (não engole erro e continua)', async () => {
    await seedV92Db(true);
    localStorage.setItem('concierge_db_schema_version', '92');

    const DatabaseManagerClass = loadDatabaseManager();
    const manager = new DatabaseManagerClass();
    await manager.initialize();

    // Simula falha de serialização (localStorage cheio) — no ambiente node
    // o localStorage é o polyfill Map-backed deste arquivo (não existe
    // Storage.prototype), então o stub é direto na função
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    await expect(manager.createBackup()).rejects.toThrow();

    localStorage.setItem = originalSetItem;
    // dados intactos — nada foi limpo
    expect(await manager.db.entities.count()).toBe(1);
    expect(await manager.db.syncQueue.count()).toBe(1);
  });
});

describe('DatabaseManager — recovery (repairEntity/duplicatas/export)', () => {
  let dm;

  beforeEach(async () => {
    // cada teste parte de um IndexedDB limpo (fake-indexeddb persiste no env)
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('ConciergeCollector');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    const Klass = loadDatabaseManager();
    dm = new Klass();
  });

  async function openSeedDb() {
    const db = new Dexie('ConciergeCollector');
    db.version(92).stores(SCHEMA_92);
    await db.open();
    return db;
  }

  test('repairEntity corrige pelo entity_id (a PK é ++id — update(entity_id) era no-op)', async () => {
    const db = await openSeedDb();
    await db.entities.put({
      entity_id: 'ent_repair', name: 'X', type: 'restaurant', status: 'active',
      data: { location: {} }, metadata: 'bad', version: 0
    });
    dm.db = db;

    const doc = await db.entities.where('entity_id').equals('ent_repair').first();
    const repaired = await dm.repairEntity(doc, [
      'Empty location object (should be undefined or have data)',
      'Missing or invalid metadata array',
      'Missing or invalid version'
    ]);

    expect(repaired).toBe(true);
    const fixed = await db.entities.where('entity_id').equals('ent_repair').first();
    expect(fixed.data.location).toBeUndefined();
    expect(fixed.metadata).toEqual([]);
    expect(fixed.version).toBe(1);
    db.close();
  });

  test('removeDuplicates mantém a cópia MAIS RECENTE e poupa cópia pending', async () => {
    const db = await openSeedDb();
    await db.entities.bulkPut([
      { entity_id: 'ent_dup', name: 'Old', status: 'active', updatedAt: '2026-01-01T00:00:00Z', sync: { status: 'synced' } },
      { entity_id: 'ent_dup', name: 'New', status: 'active', updatedAt: '2026-08-01T00:00:00Z', sync: { status: 'synced' } },
      { entity_id: 'ent_dup', name: 'Oldest pending', status: 'active', updatedAt: '2025-01-01T00:00:00Z', sync: { status: 'pending' } },
    ]);
    dm.db = db;

    const dups = await dm.findDuplicates();
    expect(dups.length).toBe(2);

    const removed = await dm.removeDuplicates(dups);

    const remaining = await db.entities.where('entity_id').equals('ent_dup').toArray();
    const names = remaining.map(e => e.name).sort();
    // keeper = 'New' (mais recente); 'Old' removida; 'Oldest pending' poupada
    // (nunca apagar trabalho não sincronizado)
    expect(names).toEqual(['New', 'Oldest pending']);
    expect(removed).toBe(1);
    db.close();
  });

  test('exportForDebug lê settings em vez da store inexistente sync_metadata', async () => {
    const db = await openSeedDb();
    await db.settings.put({ key: 'sync_metadata', value: { lastPullAt: '2026-08-15' } });
    dm.db = db;

    // polyfills browser-only do export (Blob/URL/document não existem em node)
    globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
    globalThis.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };
    globalThis.document = { createElement: () => ({ click() {}, download: '', href: '' }) };

    await expect(dm.exportForDebug()).resolves.not.toThrow();

    db.close();
  });
});

describe('uiManager — filtro de tombstones no schema real (sem índice status)', () => {
  // Regressão 2026-08-18: _localDeletedCurationIds usava .where('status')
  // no store curations, mas NENHUM schema do DatabaseManager indexa 'status'
  // ali (só sync.status) — Dexie SchemaError em todo load de curadorias no
  // perfil real do usuário. Os testes antigos mockavam .where('status') e
  // nunca tocavam o schema real — por isso o erro passou.
  beforeEach(() => {
    localStorage.clear();
    delete globalThis.DataStore;
    delete globalThis.UIManager;
    // O source do uiManager chama createInstance no fim (instanciaria o
    // constructor inteiro, que não existe fora do browser) — aqui só
    // precisamos da CLASSE para chamar o método direto no prototype.
    globalThis.ModuleWrapper.createInstance = () => undefined;
  });

  afterEach(async () => {
    await Dexie.delete('ConciergeCollector').catch(() => {});
    delete globalThis.DataStore;
    localStorage.clear();
  });

  const uiSrc = readFileSync(
    path.resolve(__dirname, '../scripts/ui-core/uiManager.js'),
    'utf8'
  );

  function loadUIManager() {
    // eslint-disable-next-line no-new-func
    const fn = new Function('window', `${uiSrc}\nreturn window.UIManager;`);
    return fn(globalThis);
  }

  test('_localDeletedCurationIds devolve ids deleted no schema real v92', async () => {
    const db = new Dexie('ConciergeCollector');
    db.version(92).stores(SCHEMA_92);
    await db.open();
    await db.curations.put({
      curation_id: 'c_del_local',
      entity_id: 'e1',
      status: 'deleted',
      sync: { status: 'pending' },
    });
    await db.curations.put({
      curation_id: 'c_viva',
      entity_id: 'e1',
      status: 'draft',
      sync: { status: 'synced' },
    });
    globalThis.DataStore = { db };

    const UIManager = loadUIManager();
    // Object.create: sem constructor (o método só usa window.DataStore)
    const ids = await Object.create(UIManager.prototype)._localDeletedCurationIds();

    expect(ids.has('c_del_local')).toBe(true);
    expect(ids.has('c_viva')).toBe(false);
    db.close();
  });
});
