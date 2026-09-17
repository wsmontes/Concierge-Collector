// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Guardas do tema do Admin.
 *
 * Duas classes de defeito foram medidas no working tree antes deste passe e não
 * podem voltar:
 *
 * 1. **Token referenciado que não existe.** `--cms-limestone-500` era usado numa
 *    borda, e `--theme-elevation-600`/`-500` em nove lugares do detalhe de
 *    Entity — nenhum dos dois era declarado, então a declaração era inválida e o
 *    valor caía para "herdado" em silêncio (o cinza do texto simplesmente não
 *    era o cinza pretendido).
 * 2. **Mapeamento `--theme-*` fora de camada.** Todo o CSS do Payload vive em
 *    `@layer payload-default`; estilo fora de camada vence camada, então o
 *    `:root { --theme-elevation-* }` antigo anulava o bloco de modo escuro do
 *    próprio Payload (que está dentro da camada).
 *
 * A terceira guarda é a que dá sentido às duas: contraste. Um tom "de fundo"
 * claro com um tom "de texto" que não chega a 4.5:1 é bonito no papel e ilegível
 * na tela — e era o que acontecia quando quarenta degraus semânticos do Payload
 * colapsavam em três hex.
 */

const STYLES_DIR = resolve(import.meta.dirname, '../../../src/styles')

function readStyles(): Array<{ file: string; css: string }> {
  return readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith('.css'))
    .map((name) => ({ file: name, css: readFileSync(join(STYLES_DIR, name), 'utf8') }))
}

/** Declarations of the form `--name: value;`, ignoring comments. */
function declarations(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found = new Map<string, string>()
  for (const match of withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (!found.has(match[1])) found.set(match[1], match[2].trim())
  }
  return found
}

/** Names the Payload declares itself; o Admin não é obrigado a declará-los. */
const PAYLOAD_OWNED = /^--(theme-elevation|theme-success|theme-error|theme-warning|theme-info|theme-bg|theme-text|theme-border-color|theme-input-bg|theme-overlay|z-|accessibility|base|nav-|doc-controls|app-header|gutter|style-|font-|color-)/

describe('tokens do tema', () => {
  const styles = readStyles()
  const defined = new Set<string>()
  for (const { css } of styles) for (const name of declarations(css).keys()) defined.add(name)

  test('nenhum `--cms-*` referenciado fica sem declaração', () => {
    const missing: string[] = []
    for (const { file, css } of styles) {
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const match of withoutComments.matchAll(/var\((--cms-[a-z0-9-]+)/gi)) {
        if (!defined.has(match[1])) missing.push(`${file}: ${match[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('nenhum token do Payload é referenciado fora do que ele próprio declara', () => {
    // A lista de exceções é explícita: um `--theme-*` novo aqui significa que
    // alguém inventou um passo de elevação em vez de usar o vocabulário do tema.
    const allowed = new Set(
      [...Array(21).keys()].flatMap((step) => {
        const value = step * 50
        return [
          `--theme-elevation-${value}`,
          ...['success', 'error', 'warning', 'info'].flatMap((tone) =>
            [25, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000].map(
              (value2) => `--theme-${tone}-${value2}`,
            ),
          ),
        ]
      }),
    )
    const missing: string[] = []
    for (const { file, css } of styles) {
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const match of withoutComments.matchAll(/var\((--theme-[a-z0-9-]+)/gi)) {
        if (!defined.has(match[1]) && !allowed.has(match[1])) missing.push(`${file}: ${match[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('o mapeamento do Payload vive dentro de `@layer payload-default`', () => {
    const theme = readStyles().find(({ file }) => file === 'theme.css')
    expect(theme, 'theme.css precisa existir: é onde o mapeamento mora').toBeDefined()
    const css = theme?.css ?? ''
    const layerStart = css.indexOf('@layer payload-default {')
    expect(layerStart).toBeGreaterThanOrEqual(0)
    for (const token of ['--theme-bg', '--theme-text', '--theme-border-color', '--theme-elevation-0']) {
      const at = css.indexOf(`${token}:`)
      expect(at, `${token} não é declarado`).toBeGreaterThan(layerStart)
      // Toda declaração precisa estar depois da abertura da camada — e antes do
      // fim do arquivo, já que não há bloco fora dela neste arquivo.
      expect(css.slice(0, layerStart).includes(`${token}:`)).toBe(false)
    }
  })

  test('o modo escuro redefine superfície, tinta e elevação', () => {
    const css = readStyles().find(({ file }) => file === 'theme.css')?.css ?? ''
    // A regra, não a menção em comentário: o cabeçalho do arquivo cita o seletor
    // ao explicar a camada, e `indexOf` cru casava com a citação.
    const darkStart = css.search(/html\[data-theme='dark'\]\s*\{/)
    expect(darkStart).toBeGreaterThan(0)
    const dark = css.slice(darkStart)
    for (const token of ['--cms-surface-0', '--cms-surface-1', '--cms-fg', '--cms-fg-muted', '--theme-elevation-0', '--cms-accent']) {
      expect(dark, `o modo escuro não redefine ${token}`).toContain(`${token}:`)
    }
  })

  test('a rampa semântica do Payload dá papéis distintos a fundo, borda e texto', () => {
    const css = readStyles().find(({ file }) => file === 'theme.css')?.css ?? ''
    const values = declarations(css)
    const used = (name: string) => values.get(name)
    for (const tone of ['success', 'error', 'warning', 'info']) {
      const bg = used(`--cms-tone-${tone}-bg`)
      const border = used(`--cms-tone-${tone}-border`)
      const fg = used(`--cms-tone-${tone}-fg`)
      const solid = used(`--cms-tone-${tone}-solid`)
      expect(bg, `${tone}: sem fundo`).toBeTruthy()
      expect(border, `${tone}: sem borda`).toBeTruthy()
      expect(fg, `${tone}: sem texto`).toBeTruthy()
      expect(solid, `${tone}: sem sólido`).toBeTruthy()
      // Os quatro papéis existem para não colapsarem no mesmo valor — era
      // exatamente o defeito (40 degraus → 3 hex).
      expect(new Set([bg, border, fg, solid]).size, `${tone}: papéis colapsados`).toBe(4)
    }
  })
})

describe('contraste do tema', () => {
  const all = readStyles()
  const css = all.find(({ file }) => file === 'theme.css')?.css ?? ''
  // O mapa completo: os valores da rampa vêm da projeção do pacote
  // (`tokens.generated.css`) e os papéis, do tema. Resolver um `var()` exige os
  // dois, senão todo par cai em "não resolvido".
  const values = new Map<string, string>()
  for (const file of ['tokens.generated.css', 'theme.css', 'kit.css', 'admin.css']) {
    const found = all.find((entry) => entry.file === file)
    if (found === undefined) continue
    for (const [name, value] of declarations(found.css)) if (!values.has(name)) values.set(name, value)
  }

  function resolve(name: string, seen = new Set<string>()): string | null {
    const raw = values.get(name)
    if (raw === undefined) return null
    const reference = raw.match(/^var\((--[a-z0-9-]+)\)$/i)
    if (reference === null) return raw
    if (seen.has(reference[1])) return null
    seen.add(reference[1])
    return resolve(reference[1], seen)
  }

  function channel(hex: string, offset: number): number {
    return Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  }

  function luminance(hex: string): number {
    const linear = [1, 3, 5].map((offset) => {
      const value = channel(hex, offset)
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }

  function ratio(foreground: string, background: string): number {
    const a = luminance(foreground)
    const b = luminance(background)
    const [light, dark] = a > b ? [a, b] : [b, a]
    return (light + 0.05) / (dark + 0.05)
  }

  // Os pares que o produto realmente usa: tinta sobre cada superfície, e tinta
  // de cada tom sobre o fundo sutil do próprio tom.
  const pairs: Array<[string, string, string]> = [
    ['--cms-fg-strong', '--cms-surface-1', 'título sobre cartão (claro)'],
    ['--cms-fg', '--cms-surface-1', 'corpo sobre cartão (claro)'],
    ['--cms-fg-muted', '--cms-surface-1', 'texto secundário sobre cartão (claro)'],
    ['--cms-fg-faint', '--cms-surface-0', 'texto fraco sobre papel (claro)'],
    ['--cms-tone-success-fg', '--cms-tone-success-bg', 'texto de sucesso'],
    ['--cms-tone-error-fg', '--cms-tone-error-bg', 'texto de erro'],
    ['--cms-tone-warning-fg', '--cms-tone-warning-bg', 'texto de alerta'],
    ['--cms-tone-info-fg', '--cms-tone-info-bg', 'texto de informação'],
    ['--cms-accent-fg', '--cms-accent-soft', 'texto de acento'],
  ]

  test('o texto claro tem ao menos 4.5:1 sobre a superfície em que vive', () => {
    const failures: string[] = []
    for (const [foreground, background, label] of pairs) {
      const fg = resolve(foreground)
      const bg = resolve(background)
      if (fg === null || bg === null) {
        failures.push(`${label}: não resolvido (${foreground}/${background})`)
        continue
      }
      const value = ratio(fg, bg)
      if (value < 4.5) failures.push(`${label}: ${value.toFixed(2)}:1 (${fg} sobre ${bg})`)
    }
    expect(failures).toEqual([])
  })

  test('o modo escuro redefine os pares e mantém o mesmo piso de contraste', () => {
    const darkStart = css.search(/html\[data-theme='dark'\]\s*\{/)
    const dark = css.slice(darkStart)
    const darkValues = declarations(dark)
    const merged = new Map(values)
    for (const [name, value] of darkValues) merged.set(name, value)

    function resolveDark(name: string, seen = new Set<string>()): string | null {
      const raw = merged.get(name)
      if (raw === undefined) return null
      const reference = raw.match(/^var\((--[a-z0-9-]+)\)$/i)
      if (reference === null) {
        // `--cms-bg`/`--cms-surface` vêm do pacote compartilhado; no escuro o
        // valor que importa é o do bloco dark, que já está em `merged`.
        return raw
      }
      if (seen.has(reference[1])) return null
      seen.add(reference[1])
      return resolveDark(reference[1], seen)
    }

    const failures: string[] = []
    for (const [foreground, background, label] of pairs) {
      const fg = resolveDark(foreground)
      const bg = resolveDark(background)
      if (fg === null || bg === null || !fg.startsWith('#') || !bg.startsWith('#')) continue
      const value = ratio(fg, bg)
      if (value < 4.5) failures.push(`escuro · ${label}: ${value.toFixed(2)}:1 (${fg} sobre ${bg})`)
    }
    expect(failures).toEqual([])
  })
})
