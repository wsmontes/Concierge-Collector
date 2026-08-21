import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const text = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('CMS backup/restore smoke', () => {
  test('restore target is validated before any destructive restore', () => {
    const script = text('scripts/operations/cms-backup-restore-smoke.sh')
    expect(script).toContain('*-restore-test')
    expect(script).toContain('production')
    expect(script.indexOf('validate_restore_target')).toBeLessThan(script.indexOf('mongorestore'))
    expect(script).toContain('--drop')
    expect(script).toContain('trap cleanup EXIT')
  })

  test('dump is read-only and restore is namespace-remapped into test DB', () => {
    const script = text('scripts/operations/cms-backup-restore-smoke.sh')
    expect(script).toContain('mongodump')
    expect(script).toContain('--archive')
    expect(script).toContain('--gzip')
    expect(script).toContain('--nsFrom')
    expect(script).toContain('--nsTo')
    expect(script).not.toContain('dropDatabase')
  })

  test('post-restore checker compares counts and canonical collection hashes', () => {
    const checker = text('scripts/operations/check_cms_restore.py')
    expect(checker).toContain('count_documents')
    expect(checker).toContain('sha256')
    expect(checker).toContain('find({}).sort("_id", 1)')
    expect(checker).not.toContain('delete_')
    expect(checker).not.toContain('update_')
  })
})
