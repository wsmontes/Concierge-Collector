import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'

// CI (GitHub Actions) foi removido por decisão do dono (2026-08-14, custos)
// e a Baseline 1 documenta isso: "GitHub Actions are intentionally not part
// of this architecture because of project cost constraints". O agregador de
// qualidade é o gate LOCAL — scripts/release/release-gate.mjs — que executa
// Collector, Admin, API e contratos gerados em uma única barra.
test('quality always aggregates Collector, Admin, API and generated contracts', () => {
  const gate = readFileSync('scripts/release/release-gate.mjs', 'utf8')
  for (const step of [
    "'build:collector:check'", "'lint:collector'", "'test:collector'",
    "'test:admin'", "'typecheck:admin'", "'build:admin'",
    "'pytest'", "'black'", "'flake8'",
    "'check:contracts'",
  ]) expect(gate).toContain(step)
})
