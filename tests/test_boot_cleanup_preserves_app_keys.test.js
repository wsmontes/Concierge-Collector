/**
 * Limpeza do boot x chaves do app (set/2026)
 *
 * Todo boot roda `cleanupBrowserData()` (scripts/core/main.js) ANTES do UIManager
 * e do DataStore, e ela apaga TODA chave de localStorage fora da lista de
 * preservação. Uma chave que o app grava e não está preservada desaparece em
 * silêncio a cada reload — foi assim que a persistência de filtros
 * (`collector.filters.v1`) e os rascunhos de formulário do StateStore
 * (`concierge-state`) morreram, sem nenhum teste acusar: a suíte de persistência
 * carrega só o uiManager, nunca o boot.
 *
 * Aqui a função REAL é extraída do arquivo publicado e executada contra as
 * chaves que o app grava, vindas de duas fontes:
 *   - o registro canônico `AppConfig.storage.keys` (scripts/core/config.js);
 *   - os literais escritos direto em `localStorage.setItem` no código publicado.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function readSource(relative) {
  return readFileSync(path.resolve(ROOT, relative), 'utf8');
}

/** Extrai uma função nomeada por casamento de chaves (não duplica o corpo). */
function extractFunction(source, name) {
  const at = source.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`function ${name} não existe em scripts/core/main.js`);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error(`function ${name} sem fechamento`);
}

/** A função real, como o browser a executa (escopo global do jsdom). */
function loadCleanupBrowserData() {
  // eslint-disable-next-line no-new-func
  return new Function(`${extractFunction(readSource('scripts/core/main.js'), 'cleanupBrowserData')}\nreturn cleanupBrowserData;`)();
}

/** O registro canônico de chaves, carregado do arquivo real. */
function loadStorageRegistry() {
  // eslint-disable-next-line no-new-func
  new Function('window', `${readSource('scripts/core/config.js')}\n`)(window);
  const keys = window.AppConfig?.storage?.keys;
  if (!keys) throw new Error('AppConfig.storage.keys não foi definido por scripts/core/config.js');
  return keys;
}

function sourceFiles(dir) {
  const absolute = path.resolve(ROOT, dir);
  if (!statSync(absolute).isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(absolute)) {
    const relative = path.join(dir, entry);
    if (statSync(path.resolve(ROOT, relative)).isDirectory()) out.push(...sourceFiles(relative));
    else if (entry.endsWith('.js')) out.push(relative);
  }
  return out;
}

/**
 * key -> arquivos que a escrevem. O primeiro argumento de `setItem` é resolvido
 * até um literal quando ele é um nome atribuído no mesmo arquivo
 * (`let persistenceKey = 'concierge-state'`) ou o prefixo estático de um
 * template (`concierge_onboarded_v1${…}`, coberto pela allowlist de prefixos).
 * Atribuições dinâmicas (`storageKey = this.storage.keys[name]`) ficam de fora —
 * essas chaves entram pelo registro canônico.
 */
function writtenStorageKeys() {
  const writes = new Map();
  const record = (key, file) => {
    if (!key) return;
    if (!writes.has(key)) writes.set(key, new Set());
    writes.get(key).add(file);
  };
  for (const file of [...sourceFiles('scripts'), ...sourceFiles('capture')]) {
    const source = readSource(file);
    const assigned = new Map();
    for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*'([^']*)'/g)) assigned.set(match[1], match[2]);
    for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*`([^`$]*)`/g)) assigned.set(match[1], match[2]);
    const sites = /localStorage\.setItem\(\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))/g;
    for (const match of source.matchAll(sites)) {
      const literal = match[1] ?? match[2];
      if (literal) record(literal, file);
      else {
        const indirect = assigned.get(match[3].split('.').pop());
        if (indirect) record(indirect, file);
      }
    }
  }
  return writes;
}

function describeOrigin(key, written) {
  const files = written.get(key);
  return files ? [...files].join(', ') : 'AppConfig.storage.keys (config.js)';
}

describe('limpeza do boot preserva as chaves do app', () => {
  let cleanup;
  let registry;
  let written;
  let keys;

  beforeEach(() => {
    localStorage.clear();
    registry = loadStorageRegistry();
    written = writtenStorageKeys();
    keys = [...new Set([...Object.values(registry), ...written.keys()])];
    cleanup = loadCleanupBrowserData();
  });

  test('a varredura encontra as chaves reais do app', () => {
    // Guarda de sanidade: se a varredura parar de enxergar o código, o teste
    // abaixo passaria vazio.
    expect(keys).toEqual(expect.arrayContaining([
      'oauth_access_token',
      'openai_api_key',
      'concierge_db_backup',
      'collector.filters.v1',
      'concierge-state',
    ]));
  });

  test('nenhuma chave gravada pelo app é apagada no boot', () => {
    for (const key of keys) localStorage.setItem(key, 'seeded');

    cleanup();

    const lost = keys.filter((key) => localStorage.getItem(key) === null);
    expect(
      lost.map((key) => `${key} — escrita por ${describeOrigin(key, written)}`),
      'cleanupBrowserData() (scripts/core/main.js) apaga chaves vivas do app:',
    ).toEqual([]);
  });

  test('a limpeza continua removendo chave que o app não conhece', () => {
    localStorage.setItem('legacy_key_sem_dono', 'x');
    cleanup();
    expect(localStorage.getItem('legacy_key_sem_dono')).toBeNull();
  });
});
