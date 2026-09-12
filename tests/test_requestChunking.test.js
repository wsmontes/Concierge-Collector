/**
 * RequestChunking: o corte de `?ids=` precisa respeitar DOIS limites — o cap do
 * servidor (500) e o tamanho da URL.
 *
 * Regressão (2026-09-12): ids do acervo podem CONTER vírgula
 * (`rest_<slug>_<lat>,<lng>` — 408 entidades) e o transporte era um CSV único,
 * então o servidor fragmentava o id e a entidade nunca era devolvida (as
 * curadorias que a referenciam ficavam órfãs para sempre no cache local). O
 * transporte agora é parâmetro REPETIDO (?ids=a&ids=b), sem ambiguidade — e o
 * orçamento é medido com o MESMO codificador usado no envio.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../scripts/utils/requestChunking.js'), 'utf8');

function loadChunking(appConfig) {
  delete window.RequestChunking;
  window.AppConfig = appConfig;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.RequestChunking;`);
  return fn(window);
}

// Id real do pipeline: 38 chars, o que fazia 500 ids passarem de 20KB de URL.
const overtureId = (i) => `overture_${String(i).padStart(32, '0')}`;
// Id real COM vírgula (lat,lng) — a família rest_* do acervo.
const restId = (name, lat, lng) => `rest_${name}_${lat},${lng}`;

afterEach(() => {
  delete window.RequestChunking;
  delete window.AppConfig;
});

describe('RequestChunking.chunkIds', () => {
  test('respeita o teto de itens quando os ids são curtos', () => {
    const chunking = loadChunking();
    const ids = Array.from({ length: 1200 }, (_, i) => `ent_${i}`);

    const chunks = chunking.chunkIds(ids);

    // Ids curtos: o limite que manda é a contagem (500), como antes.
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 200]);
  });

  test('quebra por TAMANHO de URL quando os ids são longos', () => {
    const chunking = loadChunking();
    const ids = Array.from({ length: 500 }, (_, i) => overtureId(i));

    const chunks = chunking.chunkIds(ids);

    // 500 ids de 38 chars dariam ~21KB de URL (> limite do edge).
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunking.idsQuery(chunk).length).toBeLessThanOrEqual(6000);
    }
  });

  test('nunca descarta nem reordena ids', () => {
    const chunking = loadChunking();
    const ids = Array.from({ length: 500 }, (_, i) => overtureId(i));

    const flat = chunking.chunkIds(ids).flat();

    expect(flat).toEqual(ids);
  });

  test('id COM vírgula sobrevive ao chunking e ao transporte (sem ambiguidade)', () => {
    const chunking = loadChunking();
    const comVirgula = [
      restId('a_pizza_da_mooca', '-23.5520', '-46.6200'),
      restId('akari_sushi', '-23.5050', '-46.6550'),
      'overture_sem_virgula',
    ];

    const chunks = chunking.chunkIds(comVirgula);
    const voltaram = chunks.flat();

    // O id chega intacto: nada de split/rejoin por vírgula.
    expect(voltaram).toEqual(comVirgula);
    // E a query decodifica de volta para exatamente os mesmos ids — é isso que
    // o servidor passa a receber (um id completo por item).
    const params = new URLSearchParams(chunking.idsQuery(chunks[0]));
    expect(params.getAll('ids')).toEqual(comVirgula);
  });

  test('conta o tamanho CODIFICADO, não o cru (ids com acento)', () => {
    const chunking = loadChunking();
    const accentedId = restId('pé_de_manga', '-23.5647', '-46.6962');
    // Orçamento derivado do próprio codificador: cabe UM id, não dois.
    const umId = chunking.idsQuery([accentedId]).length;
    const comDois = loadChunking({ api: { backend: { entitiesIdsMaxChars: umId } } });

    const chunks = comDois.chunkIds([accentedId, 'osm_w_1', 'osm_w_2']);

    expect(chunks[0]).toEqual([accentedId]);
    for (const chunk of chunks) {
      expect(comDois.idsQuery(chunk).length).toBeLessThanOrEqual(umId);
    }
  });

  test('id sozinho maior que o orçamento vira lote próprio (não some)', () => {
    const chunking = loadChunking({ api: { backend: { entitiesIdsMaxChars: 10 } } });

    const chunks = chunking.chunkIds(['id_muito_longo_que_estoura', 'curto']);

    expect(chunks).toEqual([['id_muito_longo_que_estoura'], ['curto']]);
  });

  test('usa os limites do AppConfig quando presentes', () => {
    const chunking = loadChunking({ api: { backend: { entitiesIdsMaxPerRequest: 2 } } });

    expect(chunking.chunkIds(['a', 'b', 'c', 'd', 'e']).map((c) => c.length)).toEqual([2, 2, 1]);
  });

  test('lista vazia ou ausente devolve nenhum lote', () => {
    const chunking = loadChunking();

    expect(chunking.chunkIds([])).toEqual([]);
    expect(chunking.chunkIds(undefined)).toEqual([]);
  });
});

describe('RequestChunking.idsQuery', () => {
  test('usa parâmetro repetido (não CSV) e ignora vazios', () => {
    const chunking = loadChunking();

    expect(chunking.idsQuery(['a', 'b'])).toBe('ids=a&ids=b');
    expect(chunking.idsQuery(['a', null, '', '  ', undefined, 'b'])).toBe('ids=a&ids=b');
    expect(chunking.idsQuery([])).toBe('');
  });

  test('codifica a vírgula do id como dado, não como separador', () => {
    const chunking = loadChunking();
    const id = restId('x', '-23.5', '-46.6');

    const query = chunking.idsQuery([id]);

    expect(query).toBe(`ids=${encodeURIComponent(id)}`);
    expect(new URLSearchParams(query).getAll('ids')).toEqual([id]);
  });
});
