/**
 * RequestChunking: o corte de `?ids=` precisa respeitar DOIS limites — o cap do
 * servidor (500) e o tamanho da URL. Ignorar o segundo fazia o edge responder
 * `414 URI Too Long`, cuja resposta de erro não traz CORS: o browser reportava
 * "bloqueado por CORS" e o pull de entidades vinculadas falhava inteiro.
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

    // 500 ids de 38 chars dariam ~21KB de URL (> limite do edge). Nenhum lote
    // pode passar do orçamento, então precisa haver mais de um lote.
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const encoded = chunk.map(encodeURIComponent).join(',').length;
      expect(encoded).toBeLessThanOrEqual(6000);
    }
  });

  test('nunca descarta nem reordena ids', () => {
    const chunking = loadChunking();
    const ids = Array.from({ length: 500 }, (_, i) => overtureId(i));

    const flat = chunking.chunkIds(ids).flat();

    expect(flat).toEqual(ids);
  });

  test('conta o tamanho CODIFICADO, não o cru (ids com acento)', () => {
    // "rest_pé_de_manga_-23.5647,_-46.6962" tem 35 chars crus mas 42 codificados
    // (é → %C3%A9, vírgula → %2C). Com orçamento 43, contar o tamanho CRU
    // agruparia este id com "osm_w_1" (35+1+7=43 ≤ 43); contar o codificado não
    // (42+1+7=50 > 43). A URL é o que vai na requisição, então o codificado manda.
    const chunking = loadChunking({ api: { backend: { entitiesIdsMaxChars: 43 } } });
    const accentedId = 'rest_pé_de_manga_-23.5647,_-46.6962';

    const chunks = chunking.chunkIds([accentedId, 'osm_w_1', 'osm_w_2']);

    expect(chunks[0]).toEqual([accentedId]);
    for (const chunk of chunks) {
      expect(chunk.map(encodeURIComponent).join(',').length).toBeLessThanOrEqual(43);
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
