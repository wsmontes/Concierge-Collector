import { expect, test, type Page } from '@playwright/test'

const live = process.env.CMS_E2E_COLLECTIONS_UI === '1' ? test : test.skip
const FASTAPI_URL = process.env.CMS_E2E_FASTAPI_URL || 'http://localhost:8000'

async function completeAdminHandoff(page: Page, baseURL: string) {
  const fastApiOrigin = new URL(FASTAPI_URL).origin
  const devLogin = await fetch(`${FASTAPI_URL}/api/v3/auth/dev-login`)
  expect(devLogin.status, 'FastAPI must run in development mode for dev-login').toBe(200)
  const tokens = await devLogin.json() as { access_token?: string; refresh_token?: string }
  expect(tokens.access_token).toBeTruthy()

  await page.context().addCookies([
    { name: 'access_token', value: tokens.access_token ?? '', domain: new URL(fastApiOrigin).hostname, path: '/' },
    { name: 'refresh_token', value: tokens.refresh_token ?? '', domain: new URL(fastApiOrigin).hostname, path: '/' },
  ])

  const callbackResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.origin === new URL(baseURL).origin && url.pathname === '/auth/callback'
  })
  await page.goto('/auth/start?return_to=/admin/collections')
  const callback = await callbackResponse
  expect(callback.status()).toBeLessThan(400)
  await page.waitForURL(`${new URL(baseURL).origin}/admin/collections**`)
}

async function enqueueOneCuration(page: Page, collectionId: string): Promise<string> {
  return page.evaluate(async ({ collectionId: id }) => {
    const search = await fetch('/api/admin/v1/curations?status=active&limit=1', { credentials: 'same-origin' })
    if (!search.ok) throw new Error(`curation search failed: ${search.status}`)
    const searchBody = await search.json() as { items?: Array<{ curation_id?: string }> }
    const curationId = searchBody.items?.[0]?.curation_id
    if (!curationId) throw new Error('seed at least one active Curation for Collections UI E2E')

    const currentResponse = await fetch(`/api/admin/v1/collections/${id}`, { credentials: 'same-origin' })
    if (!currentResponse.ok) throw new Error(`collection read failed: ${currentResponse.status}`)
    const current = await currentResponse.json() as { draftRevision: number }
    const requestId = crypto.randomUUID()
    const operation = await fetch(`/api/admin/v1/collections/${id}/draft/operations`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
        'X-Request-Id': requestId,
        'If-Match': String(current.draftRevision),
      },
      body: JSON.stringify({
        action: 'add',
        mode: 'explicit',
        curation_ids: [curationId],
        draft_revision: current.draftRevision,
      }),
    })
    if (!operation.ok) throw new Error(`draft operation enqueue failed: ${operation.status}`)
    const body = await operation.json() as { id?: string }
    if (!body.id) throw new Error('draft operation returned no id')
    return body.id
  }, { collectionId })
}

async function waitForOperation(page: Page, operationId: string) {
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    const status = await page.evaluate(async (id) => {
      const response = await fetch(`/api/admin/v1/operations/${id}`, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`operation read failed: ${response.status}`)
      return (await response.json() as { status?: string }).status ?? 'unknown'
    }, operationId)
    if (status === 'committed') return
    if (['completed_with_skips', 'failed', 'cancelled', 'stale', 'conflicted', 'authorization_revoked'].includes(status)) {
      throw new Error(`draft operation reached terminal status ${status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error('draft operation did not commit before timeout')
}

live('creates, edits, publishes, archives/restores and targets Explorer through the Admin UI', async ({ baseURL, page }) => {
  if (!baseURL) throw new Error('CMS_E2E_BASE_URL is required')
  test.setTimeout(600_000)
  await completeAdminHandoff(page, baseURL)

  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible()
  await page.getByRole('button', { name: 'New Collection' }).click()

  const stamp = Date.now()
  const title = `E2E Admin UI ${stamp}`
  const updatedTitle = `${title} Updated`
  await page.getByRole('dialog', { name: 'New Collection' }).getByLabel('Title').fill(title)
  await page.getByRole('dialog', { name: 'New Collection' }).getByLabel('Slug').fill(`e2e-admin-ui-${stamp}`)
  await page.getByRole('dialog', { name: 'New Collection' }).getByLabel('Description').fill('Created by the Collections Admin UI E2E.')
  await page.getByRole('button', { name: 'Create Collection' }).click()

  await page.waitForURL(/\/admin\/collections\/[a-f0-9]{24}$/i)
  const collectionId = new URL(page.url()).pathname.split('/').pop()
  if (!collectionId) throw new Error('Collection id missing from detail URL')
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  await page.getByRole('button', { name: 'Edit metadata' }).click()
  const metadataDialog = page.getByRole('dialog', { name: 'Edit Collection metadata' })
  await metadataDialog.getByLabel('Title').fill(updatedTitle)
  await metadataDialog.getByRole('button', { name: 'Save metadata' }).click()
  await expect(page.getByText('Collection metadata updated.')).toBeVisible()
  await expect(page.getByRole('heading', { name: updatedTitle })).toBeVisible()

  const operationId = await enqueueOneCuration(page, collectionId)
  await waitForOperation(page, operationId)
  await page.reload()
  await expect(page.getByText('1 selected')).toBeVisible()

  await page.getByRole('button', { name: 'Publish new version' }).click()
  const publishDialog = page.getByRole('dialog', { name: 'Publish Collection' })
  await expect(publishDialog.getByText('First publish → Version 1')).toBeVisible()
  await expect(publishDialog.getByText('1 selected')).toBeVisible()
  const unavailableConfirmation = publishDialog.getByRole('checkbox', { name: /Publish with .* unavailable/ })
  if (await unavailableConfirmation.count()) await unavailableConfirmation.check()
  await publishDialog.getByRole('button', { name: 'Publish Collection now' }).click()
  await expect(page.getByText('Published version 1.')).toBeVisible({ timeout: 180_000 })

  await page.getByRole('button', { name: 'Archive collection' }).click()
  await page.getByRole('dialog', { name: 'Archive Collection' }).getByRole('button', { name: 'Confirm archive' }).click()
  await expect(page.getByText('Collection archived.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore collection' })).toBeVisible()

  await page.getByRole('button', { name: 'Restore collection' }).click()
  await page.getByRole('dialog', { name: 'Restore Collection' }).getByRole('button', { name: 'Confirm restore' }).click()
  await expect(page.getByText('Collection restored.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish new version' })).toBeVisible()

  await page.getByRole('link', { name: 'Add Curations' }).click()
  await page.waitForURL(new RegExp(`/admin/explorer\\?collection=${collectionId}$`))
  await expect(page.getByRole('heading', { name: 'Curation Explorer' })).toBeVisible()
  await expect(page.getByLabel('Target Collection')).toBeVisible()
  await page.getByRole('link', { name: 'Back to Collection' }).click()
  await page.waitForURL(new RegExp(`/admin/collections/${collectionId}$`))
  await expect(page.getByRole('heading', { name: updatedTitle })).toBeVisible()
})
