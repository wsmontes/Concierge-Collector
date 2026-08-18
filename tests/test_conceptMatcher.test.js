/**
 * Testes do ConceptMatcher (scripts/services/conceptMatcher.js) — o
 * matcher de conceitos por similaridade de texto (fallback sem
 * embeddings: normalização acento-insensível + remoção de stop words +
 * três medidas: Jaccard, edit distance e overlap coefficient).
 *
 * Cobre: estado default e limiar (clamp 0..1), normalização, tokenização,
 * as três medidas de similaridade isoladas, o filtro por categoria do
 * findSimilarConcepts, ordenação/limiar/erros, e o singleton global
 * criado pelo ModuleWrapper (mock do conftest).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/services/conceptMatcher.js'),
  'utf8'
);

// O defineClass/createInstance do ModuleWrapper (mock do conftest) só
// definem UMA vez — sem o delete, o 2º load do mesmo arquivo reusaria o
// estado do teste anterior (e o próprio módulo dá warn e pula).
function loadConceptMatcher() {
  delete globalThis.ConceptMatcher;
  delete globalThis.conceptMatcher;
  // eslint-disable-next-line no-new-func
  new Function('window', `${src}\n;`)(window);
  return window.ConceptMatcher;
}

beforeEach(() => {
  delete globalThis.ConceptMatcher;
  delete globalThis.conceptMatcher;
});

afterEach(() => {
  delete globalThis.ConceptMatcher;
  delete globalThis.conceptMatcher;
  vi.restoreAllMocks();
});

describe('ConceptMatcher — estado e configuração', () => {
  test('construtor: limiar default 0.7, modelo sempre "carregado", stop words presentes', () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    expect(matcher.similarityThreshold).toBe(0.7);
    expect(matcher.modelLoaded).toBe(true);
    expect(matcher.stopWords.has('the')).toBe(true);
    expect(matcher.stopWords.has('and')).toBe(true);
    expect(matcher.stopWords.has('restaurant')).toBe(false); // palavra de negócio NÃO é stop word
  });

  test('loadModel resolve true e anuncia o fallback no console', async () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(matcher.loadModel()).resolves.toBe(true);
    expect(logSpy).toHaveBeenCalledWith('Using enhanced text similarity matching for concepts');
  });

  test('setSimilarityThreshold clampa em [0,1], atualiza o estado e retorna o valor', () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    expect(matcher.setSimilarityThreshold(1.5)).toBe(1);
    expect(matcher.similarityThreshold).toBe(1);

    expect(matcher.setSimilarityThreshold(-0.2)).toBe(0);
    expect(matcher.similarityThreshold).toBe(0);

    expect(matcher.setSimilarityThreshold(0.55)).toBe(0.55);
    expect(matcher.similarityThreshold).toBe(0.55);
  });

  test('o script cria o singleton window.conceptMatcher com o limiar default', () => {
    loadConceptMatcher();

    expect(window.conceptMatcher).toBeTruthy();
    expect(window.conceptMatcher).toBeInstanceOf(window.ConceptMatcher);
    expect(window.conceptMatcher.similarityThreshold).toBe(0.7);
  });

  test('segundo load do script não redefine (guard do ModuleWrapper + warn)', () => {
    loadConceptMatcher();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // load SEM o delete dos globais: o guard `typeof window.ConceptMatcher === 'undefined'`
    // deve pular a definição e avisar
    // eslint-disable-next-line no-new-func
    new Function('window', `${src}\n;`)(window);

    expect(warnSpy).toHaveBeenCalledWith('ConceptMatcher already defined, skipping redefinition');
  });
});

describe('ConceptMatcher — normalização e tokenização', () => {
  test('normalizeText: minúsculas, sem acentos, pontuação vira espaço, colapsa e trima', () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    expect(matcher.normalizeText('  Café, lindo!!!  ')).toBe('cafe lindo');
    expect(matcher.normalizeText('Churrascaria#1 (Média)')).toBe('churrascaria 1 media');
    expect(matcher.normalizeText('Açaí-Bowl_Teste')).toBe('acai bowl teste');
    // acento agudo/cedilha removidos pelo NFD
    expect(matcher.normalizeText('não àção ção')).toBe('nao acao cao');
  });

  test('normalizeText: valores vazios/não-string viram string vazia', () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    expect(matcher.normalizeText(null)).toBe('');
    expect(matcher.normalizeText(undefined)).toBe('');
    expect(matcher.normalizeText(123)).toBe('');
    expect(matcher.normalizeText('')).toBe('');
  });

  test('tokenizeAndFilter remove stop words e tokens vazios', () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    expect(matcher.tokenizeAndFilter('the quick and the dead')).toEqual(['quick', 'dead']);
    expect(matcher.tokenizeAndFilter('  ')).toEqual([]);
    expect(matcher.tokenizeAndFilter('italian food')).toEqual(['italian', 'food']);
  });

  test('getEmbedding devolve o texto normalizado (comentário promete remover stop words, o código só normaliza)', async () => {
    // Observação: o doc-comment diz "normalize the text AND remove stop
    // words", mas a implementação retorna só normalizeText(text) — as stop
    // words continuam presentes. O teste fixa o comportamento REAL.
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    await expect(matcher.getEmbedding('The Café!')).resolves.toBe('the cafe');
  });
});

describe('ConceptMatcher — medidas de similaridade', () => {
  test('Jaccard: idêntico = 1, disjunto = 0, ambos vazios = 1, um vazio = 0', () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    expect(matcher.calculateJaccardSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(matcher.calculateJaccardSimilarity(['a', 'b'], ['c'])).toBe(0);
    expect(matcher.calculateJaccardSimilarity([], [])).toBe(1);
    expect(matcher.calculateJaccardSimilarity([], ['a'])).toBe(0);
    expect(matcher.calculateJaccardSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 5);
  });

  test('Overlap coefficient: subconjunto = 1, disjunto = 0, vazio = 0', () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    expect(matcher.calculateOverlapCoefficient(['a', 'b'], ['a'])).toBe(1);
    expect(matcher.calculateOverlapCoefficient(['a', 'b'], ['a', 'b', 'c'])).toBe(1);
    expect(matcher.calculateOverlapCoefficient(['a', 'b'], ['c'])).toBe(0);
    expect(matcher.calculateOverlapCoefficient([], ['a'])).toBe(0);
  });

  test('Edit distance: idêntico = 1, vazio vs texto = 0, typos pequenos = alto', () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    expect(matcher.calculateEditDistanceSimilarity('cafe', 'cafe')).toBe(1);
    expect(matcher.calculateEditDistanceSimilarity('', '')).toBe(1);
    expect(matcher.calculateEditDistanceSimilarity('', 'abc')).toBe(0);
    // kitten → sitting = 3 edições; 1 - 3/7
    expect(matcher.calculateEditDistanceSimilarity('kitten', 'sitting')).toBeCloseTo(4 / 7, 5);
  });

  test('calculateCosineSimilarity é stub de compatibilidade (sempre 0.5)', () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    expect(matcher.calculateCosineSimilarity([1, 2], [3, 4])).toBe(0.5);
  });
});

describe('ConceptMatcher — findSimilarConcepts', () => {
  const existing = [
    { id: 1, category: 'cuisine', value: 'Italian' },
    { id: 2, category: 'cuisine', value: 'French' },
    { id: 3, category: 'setting', value: 'Italian restaurant' } // categoria DIFERENTE
  ];

  test('filtra por categoria: conceito de outra categoria nunca aparece', async () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    const results = await matcher.findSimilarConcepts(
      { category: 'cuisine', value: 'italian' },
      existing
    );

    expect(results.map(r => r.id)).toEqual([1]); // 'Italian restaurant' excluído pelo filtro
    expect(results[0].similarity).toBe(1);
    // campos originais preservados (spread do conceito)
    expect(results[0].value).toBe('Italian');
    expect(results[0].category).toBe('cuisine');
  });

  test('retorna apenas acima do limiar, ordenado do maior para o menor, com _debug', async () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    const results = await matcher.findSimilarConcepts(
      { category: 'cuisine', value: 'steak house' },
      [
        { id: 1, category: 'cuisine', value: 'Steak' },
        { id: 2, category: 'cuisine', value: 'Steakhouse' }
      ]
    );

    expect(results.length).toBe(2);
    expect(results[0].id).toBe(1); // overlap 1.0
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    expect(results[0]._debug).toHaveProperty('jaccardSim');
    expect(results[0]._debug).toHaveProperty('editDistSim');
    expect(results[0]._debug).toHaveProperty('overlapSim');
  });

  test('abaixo do limiar não retorna; baixar o limiar passa a retornar', async () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    const candidates = [{ id: 9, category: 'cuisine', value: 'Pasta' }];

    // 'pizza' vs 'pasta': só edit distance 0.4 → abaixo do 0.7 default
    const none = await matcher.findSimilarConcepts({ category: 'cuisine', value: 'pizza' }, candidates);
    expect(none).toEqual([]);

    matcher.setSimilarityThreshold(0.3);
    const some = await matcher.findSimilarConcepts({ category: 'cuisine', value: 'pizza' }, candidates);
    expect(some.length).toBe(1);
    expect(some[0].similarity).toBeCloseTo(0.4, 5);
  });

  test('categoryFilter=false ignora a categoria e considera todos', async () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    const results = await matcher.findSimilarConcepts(
      { category: 'cuisine', value: 'italian' },
      existing,
      false
    );

    // 'Italian' (1.0) e 'Italian restaurant' (overlap 1.0) — 'French' fica abaixo do limiar
    expect(results.map(r => r.id).sort()).toEqual([1, 3]);
  });

  test('lista filtrada vazia devolve [] sem erro', async () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();

    await expect(
      matcher.findSimilarConcepts({ category: 'nope', value: 'x' }, existing)
    ).resolves.toEqual([]);
  });

  test('erro (conceito nulo) loga no console e relança', async () => {
    const ConceptMatcher = loadConceptMatcher();
    const matcher = new ConceptMatcher();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(matcher.findSimilarConcepts(null, existing)).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith('Error finding similar concepts:', expect.any(TypeError));
  });
});
