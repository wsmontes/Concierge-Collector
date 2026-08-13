/**
 * Test Suite: config.js — testes REAIS (avaliam o arquivo de verdade).
 * Os testes antigos de test_config.test.js montavam objetos literais e
 * assertavam neles mesmos (tautologia) — regressões no config passavam.
 * Aqui o config.js é avaliado com window fake por hostname e o AppConfig
 * real é inspecionado.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configSrc = readFileSync(path.resolve(__dirname, '../scripts/core/config.js'), 'utf8');

function loadConfig(hostname) {
  const fakeWindow = {
    location: { hostname, protocol: 'https:' },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${configSrc}\nreturn AppConfig;`);
  return fn(fakeWindow);
}

describe('config.js real — environment detection', () => {
  test('github.io aponta para o Render (pythonanywhere era 404)', () => {
    const cfg = loadConfig('wsmontes.github.io');
    expect(cfg.api.backend.baseUrl).toBe('https://concierge-collector.onrender.com/api/v3');
    expect(cfg.environment.isProduction).toBe(true);
  });

  test('localhost aponta para a API local de dev', () => {
    const cfg = loadConfig('localhost');
    expect(cfg.api.backend.baseUrl).toBe('http://localhost:8000/api/v3');
    expect(cfg.environment.isDev).toBe(true);
  });

  test('host desconhecido cai no Render (não em localhost)', () => {
    const cfg = loadConfig('meu-dominio-qualquer.com');
    expect(cfg.api.backend.baseUrl).toBe('https://concierge-collector.onrender.com/api/v3');
  });
});

describe('config.js real — endpoints casam com a API v3', () => {
  test('entityCurations usa a rota real /curations/entities/{id}/curations', () => {
    const cfg = loadConfig('localhost');
    expect(cfg.api.backend.endpoints.entityCurations).toBe('/curations/entities/{id}/curations');
  });

  test('endpoints mortos foram removidos (entitiesSearch, aiTranscribe, aiAnalyzeImage, conceptMatch)', () => {
    const cfg = loadConfig('localhost');
    const endpoints = cfg.api.backend.endpoints;
    expect(endpoints.entitiesSearch).toBeUndefined();
    expect(endpoints.aiTranscribe).toBeUndefined();
    expect(endpoints.aiAnalyzeImage).toBeUndefined();
    expect(endpoints.conceptMatch).toBeUndefined();
  });

  test('endpoints essenciais continuam presentes', () => {
    const cfg = loadConfig('localhost');
    const endpoints = cfg.api.backend.endpoints;
    expect(endpoints.entities).toBe('/entities');
    expect(endpoints.curationsSearch).toBe('/curations/search');
    expect(endpoints.aiOrchestrate).toBe('/ai/orchestrate');
    expect(endpoints.placesSearch).toBe('/places/nearby');
  });
});
