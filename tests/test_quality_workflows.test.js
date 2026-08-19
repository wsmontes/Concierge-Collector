import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'

test('quality always aggregates Collector, Admin, API and generated contracts', () => {
  const yaml = readFileSync('.github/workflows/quality.yml', 'utf8')
  for (const job of ['collector:', 'admin:', 'api:', 'generated:', 'quality:']) expect(yaml).toContain(job)
  expect(yaml).toContain('if: always()')
  expect(yaml).toContain('npm run check:contracts')
})

test('images are tagged by commit SHA and never latest', () => {
  const yaml = readFileSync('.github/workflows/build-images.yml', 'utf8')
  expect(yaml).toContain('${{ github.event.workflow_run.head_sha }}')
  expect(yaml).not.toContain(':latest')
})
