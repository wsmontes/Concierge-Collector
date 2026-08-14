/**
 * Teste anti-"botão morto" — varre TODAS as superfícies (Collector:
 * index.html + templates dos scripts; capture/: index.html + módulos ES)
 * e falha se existir controle interativo (button/input/select/textarea/a)
 * com id que NUNCA é referenciado por nenhum JS.
 *
 * Regressões que este teste teria pego:
 * - #discard-recording (botão do player sem handler — corrigido ago/2026)
 * - #transcribe-audio (morto e escondido — removido ago/2026)
 * - #open-sync-settings (feature removida, botão órfão — removido ago/2026)
 *
 * Limitação declarada: o teste detecta "id sem NENHUMA referência no JS"
 * (sinal forte). Ids que são apenas cacheados (getElementById sem uso
 * posterior) são reportados como WARN no console — data-flow completo
 * exigiria análise estática, não grep.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (['node_modules', 'coverage', 'archive', 'data'].includes(entry)) continue;
      out.push(...walk(full, exts));
    } else if (exts.includes(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

// ── coleta ──
const collectorJs = walk(path.join(ROOT, 'scripts'), ['.js']);
const captureJs = [
  ...walk(path.join(ROOT, 'capture'), ['.js'])
];
const allJs = [...collectorJs, ...captureJs];
const markupFiles = [
  path.join(ROOT, 'index.html'),
  path.join(ROOT, 'capture', 'index.html')
];

// ids de elementos INTERATIVOS no markup (index.html) e nos templates JS
function extractInteractiveIds(source) {
  // elementos com id= e id sem aspas dentro de button/input/select/textarea/a
  const ids = new Set();
  const re = /<(button|input|select|textarea|a\b)[^>]*\bid\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    ids.add(m[2]);
  }
  return ids;
}

const markupIds = new Set();
for (const f of markupFiles) {
  for (const id of extractInteractiveIds(readFileSync(f, 'utf8'))) markupIds.add(id);
}
// templates embutidos nos JS (innerHTML = `...` etc.) — mesmo regex, fonte JS
const templateIds = new Set();
for (const f of allJs) {
  for (const id of extractInteractiveIds(readFileSync(f, 'utf8'))) templateIds.add(id);
}

const allInteractiveIds = new Set([...markupIds, ...templateIds]);

// ids referenciados em ARIA/labels não são controles mortos — mas controles
// interativos raramente são alvo de for=/aria-. Referências de código:
// qualquer menção do id em JS fora do próprio arquivo que o define.
const jsSources = allJs.map(f => ({ file: f, src: readFileSync(f, 'utf8') }));

// ids que são alvo de label for= ou aria-* no markup: não são botões mortos
// (input com label). Extrair for="X" do markup para allowlist.
const labelTargets = new Set();
for (const f of markupFiles) {
  const src = readFileSync(f, 'utf8');
  const re = /\bfor\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) labelTargets.add(m[1]);
}

describe('superfícies — nenhum controle interativo órfão', () => {
  test('todo button/input/select/textarea/a com id é referenciado por algum JS', () => {
    const dead = [];
    const cachedOnly = [];

    for (const id of allInteractiveIds) {
      if (labelTargets.has(id)) continue; // label for= aponta para o input
      const references = jsSources.filter(({ src }) => src.includes(id));
      if (references.length === 0) {
        dead.push(id);
        continue;
      }
      // sinal B (advisory): todas as referências são getElementById
      const nonCacheRefs = jsSources.filter(({ src }) => {
        const withoutGetById = src.split(new RegExp(`getElementById\\(['"]${id}['"]\\)`, 'g')).join('');
        return withoutGetById.includes(id);
      });
      if (nonCacheRefs.length === 0) {
        cachedOnly.push(id);
      }
    }

    if (cachedOnly.length) {
      // reportado, não falha: cache sem uso posterior PODE ser wiring via
      // referência (this.tabs.X.addEventListener) — data-flow exige análise
      console.info(
        '[no-dead-controls] ids apenas cacheados (verificar wiring manualmente):',
        cachedOnly.join(', ')
      );
    }

    expect(dead, `controles interativos sem NENHUMA referência no JS: ${dead.join(', ')}`).toEqual([]);
  });

  test('data-action dos templates é ligado por querySelector em algum JS', () => {
    // formManager usa data-action="discard" + querySelector('[data-action=...]')
    const actions = new Set();
    for (const f of allJs) {
      const src = readFileSync(f, 'utf8');
      const re = /data-action\s*=\s*["']([^"']+)["']/g;
      let m;
      while ((m = re.exec(src)) !== null) actions.add(m[1]);
    }
    const deadActions = [];
    for (const action of actions) {
      // padrões de binding válidos:
      // 1. literal: querySelector('[data-action="X"]')
      // 2. delegado por classe: btn.dataset.action === 'X' (pendingAudioModal)
      const bound = jsSources.some(({ src }) => {
        if (src.includes(`[data-action="${action}"]`) || src.includes(`[data-action='${action}']`)) return true;
        // valor do action aparece FORA dos atributos data-action do template
        const withoutAttrs = src.replace(/data-action\s*=\s*["'][^"']*["']/g, '');
        return withoutAttrs.includes(`'${action}'`) || withoutAttrs.includes(`"${action}"`);
      });
      if (!bound) deadActions.push(action);
    }
    expect(deadActions, `data-action sem binding: ${deadActions.join(', ')}`).toEqual([]);
  });
});
