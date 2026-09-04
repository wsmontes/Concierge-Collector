import { expect, test, vi } from 'vitest'
import { AdminHttpError } from '../../../src/http/errors'
import { handleExportSelectionTask } from '../../../src/jobs/exportSelectionTask'

const payload = {} as never
const store = {} as never

test('expired export is already terminal in the domain and completes Payload lifecycle without retry', async () => {
  const run = vi.fn().mockRejectedValue(new AdminHttpError(410, 'export_expired'))

  const result = await handleExportSelectionTask(payload, 'export-expired', {
    run,
    store,
    owner: 'worker-test',
  })

  expect(result).toEqual({ status: 'failed' })
  expect(run).toHaveBeenCalledWith(payload, 'export-expired', 'worker-test', { store })
})

test('transient or unexpected export failures still escape for Payload retry', async () => {
  const serviceUnavailable = new AdminHttpError(503, 'service_unavailable')
  await expect(handleExportSelectionTask(payload, 'export-transient', {
    run: vi.fn().mockRejectedValue(serviceUnavailable), store, owner: 'worker-test',
  })).rejects.toBe(serviceUnavailable)

  const unknown = new Error('storage transport failed')
  await expect(handleExportSelectionTask(payload, 'export-unknown', {
    run: vi.fn().mockRejectedValue(unknown), store, owner: 'worker-test',
  })).rejects.toBe(unknown)
})

test('not-claimed export remains a successful no-op worker lifecycle', async () => {
  const run = vi.fn().mockResolvedValue(null)

  const result = await handleExportSelectionTask(payload, 'export-raced', {
    run, store, owner: 'worker-test',
  })

  expect(result).toEqual({ status: 'not_claimed' })
})