/**
 * Paridade da linguagem visual compartilhada entre o pacote de tokens e o
 * design system do Collector.
 *
 * O pacote (`packages/design-tokens`) é a fonte da escala que o Admin consome; o
 * Collector declara a MESMA escala em `styles/design-system.css` e é a superfície
 * de referência do produto. Sem este teste, mudar um lado (um raio, um passo de
 * tipo, um tom semântico) diverge do outro em silêncio e a padronização
 * desmancha na primeira edição.
 *
 * O contrato é de VALOR, não de texto. O nome difere entre os dois lados: o
 * Collector não usa o prefixo `cms-`, e as cores semânticas lá são `--color-*`.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const PACOTE = path.join(RAIZ, 'packages/design-tokens/src/tokens.css');
const COLETOR = path.join(RAIZ, 'styles/design-system.css');

function declaracoes(arquivo) {
  const css = fs.readFileSync(arquivo, 'utf8');
  const mapa = new Map();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const nome = m[1].trim();
    if (!mapa.has(nome)) mapa.set(nome, m[2].trim().replace(/\s+/g, ' '));
  }
  return mapa;
}

/**
 * Nome do token no Collector para um `--cms-*`.
 *
 * Três famílias: a ESCALA perde só o prefixo (`--cms-text-sm` → `--text-sm`), as
 * rampas de marca não têm equivalente fora do pacote (o Collector as recebe pela
 * cópia gerada, coberta pelo byte-check do gerador) e as SEMÂNTICAS viram
 * `--color-*` no Collector.
 */
const SEMANTICAS = new Set([
  'primary', 'secondary', 'bg', 'surface',
  'success', 'success-light', 'success-dark',
  'error', 'error-light', 'error-dark',
  'warning', 'warning-light', 'warning-dark',
  'info', 'info-light', 'info-dark',
]);

function nomeNoColetor(tokenCms) {
  const base = tokenCms.replace(/^--cms-/, '');
  if (/^(limestone|olive)-/.test(base)) return null; // rampa: coberta pelo byte-check
  if (SEMANTICAS.has(base)) return `--color-${base}`;
  return `--${base}`;
}

describe('linguagem compartilhada — pacote × Collector', () => {
  const pacote = declaracoes(PACOTE);
  const coletor = declaracoes(COLETOR);

  // Inclui os passos SEM sufixo (`--cms-radius`, `--cms-shadow`), que o filtro
  // anterior deixava de fora por exigir hífen depois do prefixo.
  const compartilhados = [...pacote.keys()]
    .filter((t) => /^--cms-(text|spacing|radius|shadow|font|primary|secondary|bg|surface|success|error|warning|info)/.test(t))
    .map((t) => [t, nomeNoColetor(t)])
    .filter(([, equivalente]) => equivalente !== null);

  test('o pacote declara a escala inteira, não só cores', () => {
    // Guarda contra "enxugar" o pacote de volta para cores: sem escala
    // compartilhada o Admin volta a inventar tamanho de fonte e raio.
    const escala = [...pacote.keys()];
    expect(escala.filter((t) => t.startsWith('--cms-text-')).length).toBeGreaterThanOrEqual(7);
    expect(escala.filter((t) => /^--cms-radius($|-)/.test(t)).length).toBeGreaterThanOrEqual(9);
    expect(escala.filter((t) => t.startsWith('--cms-spacing-')).length).toBeGreaterThanOrEqual(15);
    expect(escala.filter((t) => /^--cms-shadow($|-)/.test(t)).length).toBeGreaterThanOrEqual(7);
    expect(escala.filter((t) => t.startsWith('--cms-font-')).length).toBeGreaterThanOrEqual(3);
  });

  test('toda semântica tem equivalente no Collector (nenhuma escapou da guarda)', () => {
    // Sem esta asserção um tom novo entraria no pacote sem par — e é justamente
    // a classe que ficou fora da marca (error/warning/info) que divergiria
    // primeiro.
    const nomes = [...pacote.keys()].map((t) => t.replace(/^--cms-/, ''));
    const semPar = [...SEMANTICAS].filter((s) => !nomes.includes(s));
    expect(semPar).toEqual([]);
    for (const s of SEMANTICAS) expect(coletor.has(`--color-${s}`), `o Collector não declara --color-${s}`).toBe(true);
  });

  test.each(compartilhados)('%s tem o mesmo valor no Collector (%s)', (token, equivalente) => {
    expect(coletor.get(equivalente), `o Collector não declara ${equivalente}`).toBeTruthy();
    expect(pacote.get(token)).toBe(coletor.get(equivalente));
  });

  test('a guarda cobre os quatro tons semânticos e os passos-base da escala', () => {
    const nomes = compartilhados.map(([t]) => t);
    for (const hue of ['success', 'error', 'warning', 'info']) {
      expect(nomes).toContain(`--cms-${hue}`);
      expect(nomes).toContain(`--cms-${hue}-light`);
      expect(nomes).toContain(`--cms-${hue}-dark`);
    }
    // Os dois passos sem sufixo, que o filtro antigo silenciava.
    expect(nomes).toContain('--cms-radius');
    expect(nomes).toContain('--cms-shadow');
  });
});
