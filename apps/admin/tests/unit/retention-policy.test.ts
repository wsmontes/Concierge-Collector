import { afterEach, expect, test } from 'vitest'
import { readPositiveInt, readRetentionInt } from '../../src/retention-policy'

const originalDbName = process.env.CMS_MONGODB_DB_NAME
const originalAuditDays = process.env.CMS_AUDIT_RETENTION_DAYS
const originalBatch = process.env.CMS_TEST_BATCH_SIZE

afterEach(() => {
  if (originalDbName === undefined) delete process.env.CMS_MONGODB_DB_NAME
  else process.env.CMS_MONGODB_DB_NAME = originalDbName
  if (originalAuditDays === undefined) delete process.env.CMS_AUDIT_RETENTION_DAYS
  else process.env.CMS_AUDIT_RETENTION_DAYS = originalAuditDays
  if (originalBatch === undefined) delete process.env.CMS_TEST_BATCH_SIZE
  else process.env.CMS_TEST_BATCH_SIZE = originalBatch
})

test('uses the production minimum when retention override is absent', () => {
  process.env.CMS_MONGODB_DB_NAME = 'concierge-cms'
  delete process.env.CMS_AUDIT_RETENTION_DAYS

  expect(readRetentionInt('CMS_AUDIT_RETENTION_DAYS', 365)).toBe(365)
})

test('rejects a shorter retention window on a non-test CMS database', () => {
  process.env.CMS_MONGODB_DB_NAME = 'concierge-cms'
  process.env.CMS_AUDIT_RETENTION_DAYS = '30'

  expect(() => readRetentionInt('CMS_AUDIT_RETENTION_DAYS', 365))
    .toThrow(/cannot be lower than production minimum 365/)
})

test('allows shorter qualification retention only on an explicit disposable test database', () => {
  process.env.CMS_MONGODB_DB_NAME = 'concierge-cms-staging-test'
  process.env.CMS_AUDIT_RETENTION_DAYS = '30'

  expect(readRetentionInt('CMS_AUDIT_RETENTION_DAYS', 365)).toBe(30)
})

test('does not treat a production-shaped test suffix as disposable', () => {
  process.env.CMS_MONGODB_DB_NAME = 'concierge-production-test'
  process.env.CMS_AUDIT_RETENTION_DAYS = '30'

  expect(() => readRetentionInt('CMS_AUDIT_RETENTION_DAYS', 365))
    .toThrow(/cannot be lower than production minimum 365/)
})

test('rejects invalid configured retention instead of silently changing policy', () => {
  process.env.CMS_MONGODB_DB_NAME = 'concierge-cms'
  process.env.CMS_AUDIT_RETENTION_DAYS = 'not-a-number'

  expect(() => readRetentionInt('CMS_AUDIT_RETENTION_DAYS', 365))
    .toThrow(/must be a positive integer/)
})

test('allows production retention to be lengthened explicitly', () => {
  process.env.CMS_MONGODB_DB_NAME = 'concierge-cms'
  process.env.CMS_AUDIT_RETENTION_DAYS = '730'

  expect(readRetentionInt('CMS_AUDIT_RETENTION_DAYS', 365)).toBe(730)
})

test('reads positive operational integers with a default when unset', () => {
  delete process.env.CMS_TEST_BATCH_SIZE
  expect(readPositiveInt('CMS_TEST_BATCH_SIZE', 100)).toBe(100)

  process.env.CMS_TEST_BATCH_SIZE = '250'
  expect(readPositiveInt('CMS_TEST_BATCH_SIZE', 100)).toBe(250)
})

test('rejects malformed or zero operational integers instead of silently using defaults', () => {
  process.env.CMS_TEST_BATCH_SIZE = 'garbage'
  expect(() => readPositiveInt('CMS_TEST_BATCH_SIZE', 100)).toThrow(/must be a positive integer/)

  process.env.CMS_TEST_BATCH_SIZE = '0'
  expect(() => readPositiveInt('CMS_TEST_BATCH_SIZE', 100)).toThrow(/must be a positive integer/)
})
