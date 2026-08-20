import { afterEach, describe, expect, test } from 'vitest'

import { DEFAULT_RETENTION_POLICY, readRetentionPolicy } from '../../../src/maintenance/retention'
import { isResumableOperation, shouldDeleteOrphanStage } from '../../../src/maintenance/reconciliation'

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('CMS_') && key.includes('TTL') || key.startsWith('CMS_ORPHAN_') || key.startsWith('CMS_OPERATION_ITEM_') || key.startsWith('CMS_AUDIT_RETENTION_')) {
      delete process.env[key]
    }
  }
  delete process.env.ENVIRONMENT
})

describe('retention policy', () => {
  test('uses versioned defaults when no overrides are present', () => {
    expect(readRetentionPolicy()).toEqual(DEFAULT_RETENTION_POLICY)
  })

  test('production refuses silently shortened retention windows', () => {
    process.env.ENVIRONMENT = 'production'
    process.env.CMS_AUDIT_RETENTION_DAYS = '30'
    expect(() => readRetentionPolicy()).toThrow(/cannot be shorter/i)
  })

  test('staging may use a shorter window for acceptance testing', () => {
    process.env.ENVIRONMENT = 'staging'
    process.env.CMS_ORPHAN_STAGING_RETENTION_DAYS = '1'
    expect(readRetentionPolicy().orphanStagingRetentionDays).toBe(1)
  })
})

describe('conservative staging cleanup', () => {
  test('treats active operation states as resumable', () => {
    for (const status of ['queued', 'materializing', 'staging', 'validating', 'committing']) {
      expect(isResumableOperation({ status })).toBe(true)
    }
    for (const status of ['completed', 'completed_with_skips', 'failed', 'cancelled', 'stale', 'conflicted']) {
      expect(isResumableOperation({ status })).toBe(false)
    }
  })

  test('never deletes staging while its operation can resume', () => {
    expect(shouldDeleteOrphanStage({ operation: { status: 'staging' }, hasActivePublish: false })).toBe(false)
  })

  test('never deletes staging while any publish promotion is active', () => {
    expect(shouldDeleteOrphanStage({ operation: null, hasActivePublish: true })).toBe(false)
  })

  test('deletes only when no resumable operation and no active publish exist', () => {
    expect(shouldDeleteOrphanStage({ operation: null, hasActivePublish: false })).toBe(true)
    expect(shouldDeleteOrphanStage({ operation: { status: 'failed' }, hasActivePublish: false })).toBe(true)
  })
})
