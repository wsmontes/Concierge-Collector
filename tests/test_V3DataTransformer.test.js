/**
 * Testes do V3DataTransformer (scripts/services/V3DataTransformer.js) —
 * a transformação bidirecional MongoDB ↔ IndexedDB do modelo
 * Entity/Curation v3.
 *
 * Cobre: mapeamento entity_id || _id (tolerância a shape v3 vs
 * bulk/legado), defaults de type/status/version, conversão ISO string ↔
 * Date (parseDate/formatDate com fallback e warn), bloco sync
 * (serverId/status), fallbacks de curator_id/restaurant_name/transcript
 * das curadorias, transformações em lote (validação de array), o
 * validateEntityRoundtrip (campos críticos e erros) e o runTests
 * embutido.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/services/V3DataTransformer.js'),
  'utf8'
);

// O módulo é um IIFE que anexa o singleton em window.V3DataTransformer —
// sem o delete, o 2º load cria uma instância nova em cima da velha.
function loadTransformer() {
  delete globalThis.V3DataTransformer;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.V3DataTransformer;`);
  return fn(window);
}

beforeEach(() => {
  delete globalThis.V3DataTransformer;
});

afterEach(() => {
  delete globalThis.V3DataTransformer;
  vi.restoreAllMocks();
});

describe('V3DataTransformer — entidades: Mongo → IndexedDB', () => {
  const mongoEntity = {
    _id: '507f1f77bcf86cd799439011',
    entity_id: 'restaurant_123',
    type: 'restaurant',
    name: 'Test Restaurant',
    status: 'active',
    metadata: [{ type: 'google_places', source: 'google_places_api', data: { placeId: 'ChIJ123' } }],
    createdAt: '2025-01-15T10:30:00.000Z',
    updatedAt: '2025-01-15T10:30:00.000Z',
    createdBy: 'curator_001',
    version: 1
  };

  test('entity_id é preservado; _id vira sync.serverId e timestamps viram Date', () => {
    const tr = loadTransformer();
    const local = tr.mongoEntityToLocal(mongoEntity);

    expect(local.entity_id).toBe('restaurant_123');
    expect(local.name).toBe('Test Restaurant');
    expect(local.createdAt).toBeInstanceOf(Date);
    expect(local.createdAt.toISOString()).toBe('2025-01-15T10:30:00.000Z');
    expect(local.updatedAt).toBeInstanceOf(Date);
    expect(local.sync.serverId).toBe('507f1f77bcf86cd799439011');
    expect(local.sync.status).toBe('synced');
    expect(local.sync.lastSyncedAt).toBeInstanceOf(Date);
    expect(local.metadata).toEqual(mongoEntity.metadata);
    expect(local.version).toBe(1);
    expect(local.createdBy).toBe('curator_001');
  });

  test('sem entity_id cai para _id (shape v3 com só _id)', () => {
    const tr = loadTransformer();
    const local = tr.mongoEntityToLocal({
      _id: 'mongo_only',
      name: 'Do Mongo',
      createdAt: '2025-01-15T10:30:00.000Z'
    });

    expect(local.entity_id).toBe('mongo_only');
    // defaults aplicados
    expect(local.type).toBe('restaurant');
    expect(local.status).toBe('active');
    expect(local.externalId).toBeNull();
    expect(local.metadata).toEqual([]);
    expect(local.createdBy).toBeNull();
    expect(local.updatedBy).toBeNull();
    expect(local.version).toBe(1);
  });

  test('sync existente no Mongo é mergeado, mas _id tem precedência no serverId', () => {
    const tr = loadTransformer();
    const local = tr.mongoEntityToLocal({
      _id: 'mongo_1',
      entity_id: 'e1',
      sync: { serverId: 'outro', status: 'dirty', lastSyncedAt: '2025-01-01T00:00:00.000Z' }
    });

    expect(local.sync.serverId).toBe('mongo_1');
    expect(local.sync.status).toBe('dirty'); // resto do sync preservado
    expect(local.sync.lastSyncedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  test('mongoEntityToLocal(undefined) lança erro de campo obrigatório', () => {
    const tr = loadTransformer();

    expect(() => tr.mongoEntityToLocal(null)).toThrow('mongoEntity is required');
    expect(() => tr.mongoEntityToLocal(undefined)).toThrow('mongoEntity is required');
  });
});

describe('V3DataTransformer — entidades: IndexedDB → Mongo', () => {
  const localEntity = {
    entity_id: 'e_local',
    type: 'restaurant',
    name: 'Local Spot',
    status: 'active',
    metadata: [{ k: 1 }],
    createdAt: new Date('2025-02-01T12:00:00.000Z'),
    updatedAt: new Date('2025-02-01T12:00:00.000Z'),
    version: 3,
    sync: { serverId: 'mongo_9', status: 'pending', lastSyncedAt: new Date('2025-02-01T12:00:00.000Z') }
  };

  test('Date vira ISO string e sync.serverId volta como _id', () => {
    const tr = loadTransformer();
    const mongo = tr.localEntityToMongo(localEntity);

    expect(mongo.entity_id).toBe('e_local');
    expect(mongo.createdAt).toBe('2025-02-01T12:00:00.000Z');
    expect(mongo.updatedAt).toBe('2025-02-01T12:00:00.000Z');
    expect(mongo._id).toBe('mongo_9');
    expect(mongo.version).toBe(3);
    expect(mongo.sync.status).toBe('pending');
    expect(mongo.sync.lastSyncedAt).toBe('2025-02-01T12:00:00.000Z');
  });

  test('sem sync.serverId o doc Mongo não ganha _id', () => {
    const tr = loadTransformer();
    const mongo = tr.localEntityToMongo({ entity_id: 'e2', name: 'X' });

    expect(mongo._id).toBeUndefined();
    expect(mongo.type).toBe('restaurant');
    expect(mongo.status).toBe('active');
    expect(mongo.externalId).toBeNull();
    expect(mongo.createdBy).toBeNull();
  });

  test('localEntityToMongo(undefined) lança erro de campo obrigatório', () => {
    const tr = loadTransformer();

    expect(() => tr.localEntityToMongo(null)).toThrow('localEntity is required');
  });
});

describe('V3DataTransformer — curadorias', () => {
  test('mongoCurationToLocal: curation_id cai para _id; curator.id vira curator_id', () => {
    const tr = loadTransformer();
    const local = tr.mongoCurationToLocal({
      _id: 'cur_m1',
      entity_id: 'e1',
      curator: { id: 'cur_9', name: 'Ana' },
      restaurant_name: 'Rest',
      category: 'cuisine',
      concept: 'Italian',
      createdAt: '2025-01-15T10:30:00.000Z'
    });

    expect(local.curation_id).toBe('cur_m1');
    expect(local.curator_id).toBe('cur_9');
    expect(local.curatorName).toBe('Ana');
    expect(local.restaurant_name).toBe('Rest');
    expect(local.category).toBe('cuisine');
    expect(local.createdAt).toBeInstanceOf(Date);
    expect(local.sync.serverId).toBe('cur_m1');
  });

  test('mongoCurationToLocal: curator_id plano e restaurant_name caem para name (shape legado)', () => {
    const tr = loadTransformer();
    const local = tr.mongoCurationToLocal({
      curation_id: 'c_legacy',
      entity_id: 'e2',
      curator_id: 'cur_7',
      name: 'Restaurante Legado'
    });

    expect(local.curation_id).toBe('c_legacy');
    expect(local.curator_id).toBe('cur_7');
    expect(local.restaurant_name).toBe('Restaurante Legado');
  });

  test('transcript cai para sources.audio[0].transcript → unstructured_text → transcription → null', () => {
    const tr = loadTransformer();

    const deAudio = tr.mongoCurationToLocal({ entity_id: 'e', sources: { audio: [{ transcript: 'do audio' }] } });
    expect(deAudio.transcript).toBe('do audio');

    const deUnstructured = tr.mongoCurationToLocal({ entity_id: 'e', unstructured_text: 'texto solto' });
    expect(deUnstructured.transcript).toBe('texto solto');

    const deTranscription = tr.mongoCurationToLocal({ entity_id: 'e', transcription: 'transcricao antiga' });
    expect(deTranscription.transcript).toBe('transcricao antiga');

    const semNada = tr.mongoCurationToLocal({ entity_id: 'e' });
    expect(semNada.transcript).toBeNull();

    // prioridade: transcript explícito vence tudo
    const comTudo = tr.mongoCurationToLocal({
      entity_id: 'e',
      transcript: 'principal',
      sources: { audio: [{ transcript: 'secundario' }] }
    });
    expect(comTudo.transcript).toBe('principal');
  });

  test('localCurationToMongo: monta objeto curator, _id do sync e defaults', () => {
    const tr = loadTransformer();
    const mongo = tr.localCurationToMongo({
      curation_id: 'c1',
      entity_id: 'e1',
      curator_id: 'cur_9',
      curatorName: 'Ana',
      restaurant_name: 'Rest',
      images: ['i1', 'i2'],
      createdAt: new Date('2025-01-15T10:30:00.000Z'),
      sync: { serverId: 'm_cur_1', status: 'synced' }
    });

    expect(mongo.curation_id).toBe('c1');
    expect(mongo.curator).toEqual({ id: 'cur_9', name: 'Ana' });
    expect(mongo._id).toBe('m_cur_1');
    expect(mongo.createdAt).toBe('2025-01-15T10:30:00.000Z');
    expect(mongo.images).toEqual(['i1', 'i2']);
  });

  test('localCurationToMongo: sem curatorName, name é "Unknown"; transcript cai p/ unstructured_text', () => {
    const tr = loadTransformer();
    const mongo = tr.localCurationToMongo({
      curation_id: 'c2',
      entity_id: 'e2',
      curator_id: 'cur_1',
      unstructured_text: 'texto'
    });

    expect(mongo.curator).toEqual({ id: 'cur_1', name: 'Unknown' });
    expect(mongo.restaurant_name).toBeNull();
    expect(mongo.transcript).toBe('texto');
    expect(mongo.category).toBeNull();
  });
});

describe('V3DataTransformer — transformações em lote', () => {
  test('mongoEntitiesToLocal/localEntitiesToMongo mapeiam 1:1', () => {
    const tr = loadTransformer();
    const mongoEntities = [
      { _id: 'a', entity_id: 'e1', name: 'A', createdAt: '2025-01-01T00:00:00.000Z' },
      { _id: 'b', entity_id: 'e2', name: 'B', createdAt: '2025-01-01T00:00:00.000Z' }
    ];

    const locals = tr.mongoEntitiesToLocal(mongoEntities);
    expect(locals.length).toBe(2);
    expect(locals[0].entity_id).toBe('e1');

    const backToMongo = tr.localEntitiesToMongo(locals);
    expect(backToMongo[0].entity_id).toBe('e1');
    expect(backToMongo[1].name).toBe('B');
  });

  test('mongoCurationsToLocal/localCurationsToMongo mapeiam 1:1', () => {
    const tr = loadTransformer();
    const mongoCurations = [
      { _id: 'c1', entity_id: 'e1', curator_id: 'cur_1', createdAt: '2025-01-01T00:00:00.000Z' },
      { _id: 'c2', entity_id: 'e2', curator_id: 'cur_2', createdAt: '2025-01-01T00:00:00.000Z' }
    ];

    const locals = tr.mongoCurationsToLocal(mongoCurations);
    expect(locals.length).toBe(2);
    expect(locals[0].curation_id).toBe('c1');

    const backToMongo = tr.localCurationsToMongo(locals);
    expect(backToMongo[0]._id).toBe('c1');
    expect(backToMongo[1].entity_id).toBe('e2');
  });

  test('lotes rejeitam não-array com erro descritivo', () => {
    const tr = loadTransformer();

    expect(() => tr.mongoEntitiesToLocal('nope')).toThrow('mongoEntities must be an array');
    expect(() => tr.localEntitiesToMongo(null)).toThrow('localEntities must be an array');
    expect(() => tr.mongoCurationsToLocal({})).toThrow('mongoCurations must be an array');
    expect(() => tr.localCurationsToMongo(42)).toThrow('localCurations must be an array');
  });
});

describe('V3DataTransformer — datas (parseDate/formatDate)', () => {
  test('parseDate: Date passa direto; string ISO e número viram Date', () => {
    const tr = loadTransformer();

    const date = new Date('2025-01-15T10:30:00.000Z');
    expect(tr.parseDate(date)).toBe(date);

    expect(tr.parseDate('2025-01-15T10:30:00.000Z').toISOString()).toBe('2025-01-15T10:30:00.000Z');
    expect(tr.parseDate(1736937000000).toISOString()).toBe('2025-01-15T10:30:00.000Z');
  });

  test('parseDate: ausente/indeterminável vira Date de agora + warn no log', () => {
    const tr = loadTransformer();
    const warnSpy = vi.spyOn(tr.log, 'warn');

    const now = Date.now();
    const parsed = tr.parseDate(undefined);
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(now - 1000);

    expect(tr.parseDate('data-invalida').getTime()).toBeGreaterThanOrEqual(now - 1000);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('formatDate: Date vira ISO; string ISO é normalizada', () => {
    const tr = loadTransformer();

    expect(tr.formatDate(new Date('2025-01-15T10:30:00.000Z'))).toBe('2025-01-15T10:30:00.000Z');
    expect(tr.formatDate('2025-01-15T10:30:00.000Z')).toBe('2025-01-15T10:30:00.000Z');
    // string com offset é normalizada para ISO UTC (TZ-independente)
    expect(tr.formatDate('2025-01-15T10:30:00+05:00')).toBe('2025-01-15T05:30:00.000Z');
  });

  test('formatDate: ausente/inválido devolve ISO de agora + warn no log', () => {
    const tr = loadTransformer();
    const warnSpy = vi.spyOn(tr.log, 'warn');

    const nowIso = tr.formatDate(undefined);
    expect(new Date(nowIso).getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
    expect(tr.formatDate('xyz')).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('V3DataTransformer — validateEntityRoundtrip e runTests', () => {
  test('roundtrip toLocal com doc completo é válido (sem erros)', () => {
    const tr = loadTransformer();
    const result = tr.validateEntityRoundtrip({
      _id: 'm1',
      entity_id: 'e1',
      type: 'restaurant',
      name: 'X',
      status: 'active',
      metadata: [{ k: 1 }]
    }, 'toLocal');

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('roundtrip toMongo (local → mongo → local) é válido com sync.serverId', () => {
    const tr = loadTransformer();
    const result = tr.validateEntityRoundtrip({
      entity_id: 'e1',
      type: 'restaurant',
      name: 'X',
      status: 'active',
      metadata: [{ k: 1 }],
      sync: { serverId: 'm1' }
    }, 'toMongo');

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('doc Mongo com SÓ _id (sem entity_id) reporta mismatch no campo entity_id', () => {
    // O transformador deriva entity_id do _id (tolerância de shape), mas o
    // validador compara campo a campo contra o ORIGINAL — doc sem entity_id
    // explicito é reprovado. Comportamento real; teste documenta o quirk.
    const tr = loadTransformer();
    const result = tr.validateEntityRoundtrip({
      _id: 'somente_id',
      type: 'restaurant',
      name: 'X',
      status: 'active',
      metadata: []
    }, 'toLocal');

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('entity_id'))).toBe(true);
  });

  test('campos críticos ausentes (ex.: status) reprovam a validação', () => {
    const tr = loadTransformer();
    const result = tr.validateEntityRoundtrip({
      _id: 'm1',
      entity_id: 'e1',
      type: 'restaurant',
      name: 'X' // sem status → default 'active' no roundtrip ≠ undefined
    }, 'toLocal');

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('status'))).toBe(true);
  });

  test('entrada nula é capturada como Transformation error (sem throw)', () => {
    const tr = loadTransformer();
    const result = tr.validateEntityRoundtrip(null);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Transformation error: mongoEntity is required');
  });

  test('runTests embutido passa no caso canônico (passed=1, failed=0)', () => {
    const tr = loadTransformer();
    const results = tr.runTests();

    expect(results.passed).toBe(1);
    expect(results.failed).toBe(0);
    expect(results.errors).toEqual([]);
  });
});
