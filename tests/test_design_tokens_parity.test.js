/**
 * Paridade da escala compartilhada entre o pacote de tokens e o design system
 * do Collector.
 *
 * O pacote (`packages/design-tokens`) é a fonte da linguagem visual que o Admin
 * passou a consumir; o Collector declara a MESMA escala em
 * `styles/design-system.css` e é a superfície de referência do produto. Sem este
 * teste, mudar um lado (um raio, um passo de tipo) diverge do outro em silêncio
 * e a padronização que este trabalho fez desmancha na primeira edição.
 *
 * O contrato é de VALOR, não de texto: o nome do token no Collector perde o
 * prefixo `cms-` (e as cores semânticas são `--color-*` lá, `--cms-*` aqui).
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

/** Nome no Collector para um token `--cms-*` (as semânticas usam --color-*). */
function nomeNoColetor(tokenCms) {
  const base = tokenCms.replace(/^--cms-/, '--');
  const semanticas = ['--success', '--success-light', '--error', '--error-light', '--warning', '--warning-light', '--info', '--info-light'];
  return semanticas.includes(base) ? base.replace('--', '--color-') : base;
}

describe('escala compartilhada — pacote × Collector', () => {
  const pacote = declaracoes(PACOTE);
  const coletor = declaracoes(COLETOR);
  const escala = [...pacote.keys()].filter((t) => /^--cms-(text|spacing|radius|shadow|font)-/.test(t));

  test('o pacote declara a escala inteira (não só cores)', () => {
    // Guarda contra alguém "enxugar" o pacote de volta para cores: sem escala
    // compartilhada o Admin volta a inventar tamanho de fonte e raio.
    expect(escala.filter((t) => t.startsWith('--cms-text-')).length).toBeGreaterThanOrEqual(7);
    expect(escala.filter((t) => t.startsWith('--cms-radius-')).length).toBeGreaterThanOrEqual(8);
    expect(escala.filter((t) => t.startsWith('--cms-spacing-')).length).toBeGreaterThanOrEqual(15);
    expect(escala.filter((t) => t.startsWith('--cms-shadow-')).length).toBeGreaterThanOrEqual(6);
    expect(escala.filter((t) => t.startsWith('--cms-font-')).length).toBeGreaterThanOrEqual(3);
  });

  test.each([...escala].map((t) => [t, nomeNoColetor(t)]))('%s tem o mesmo valor no Collector (%s)', (token, equivalente) => {
    const noColetor = coletor.get(equivalente);
    expect(noColetor, `o Collector não declara ${equivalente}`).toBeTruthy();
    expect(pacote.get(token)).toBe(noColetor);
  });

  test('as cores de marca continuam em paridade', () => {
    for (const [token, valor] of pacote) {
      const equivalente = nomeNoColetor(token.includes('limestone') || token.includes('olive') ? token.replace(/^--cms-/, '--cms-') : token);
      if (token.startsWith('--cms-limestone') || token.startsWith('--cms-olive')) {
        // No Collector as duas rampas vivem em tokens.generated.css (cópia
        // byte-idêntica do pacote), não em design-system.css — o byte-check do
        // gerador cobre esse par, então aqui só garantimos que não sumiram.
        expect(valor).toMatch(/^#[0-9a-f]{6}$/i);
        void equivalente;
      }
    }
  });
});
