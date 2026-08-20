import { expect, test } from '@playwright/test'

/**
 * Curation Explorer keyboard and selection semantics E2E (requires the full
 * local stack):
 *
 *   1. Handoff: seeds a dev FastAPI session, completes the CMS handoff and
 *      asserts the host-only, HttpOnly CMS session cookie.
 *   2. Proves the guarded "a" shortcut: nothing happens while the search input
 *      has focus, and the toolbar button is the visual equivalent that works
 *      when focus leaves editable targets.
 *   3. Proves the loaded-range selection model: Shift-click and the header
 *      checkbox select exactly the loaded rows, the header checkbox exposes
 *      indeterminate partial state, and ArrowUp/Down + Space toggle the active
 *      loaded row without leaving the range.
 *
 * Gate: run only with CMS_E2E_EXPLORER=1 against a stack that provides:
 *   - CMS web server (baseURL) booted with a `-test` CMS database and
 *     CMS_SERVICE_KEY matching FastAPI's; baseURL must equal CMS_PUBLIC_SERVER_URL
 *     because cookie-authenticated writes enforce a same-origin Origin header;
 *   - FastAPI (CMS_E2E_FASTAPI_URL, default http://localhost:8000) in
 *     development mode with CMS_ADMIN_ORIGIN/CMS_ADMIN_CALLBACK_URL pointing
 *     at the CMS web server, the same CMS_SERVICE_KEY, and exactly 3 active
 *     curations seeded in its `-test` database so the loaded page is
 *     deterministic (3 rows, no pagination).
 *
 * Axe: the project does not configure @axe-core/playwright (axe-core is only
 * a transitive eslint dependency), so axe assertions are intentionally absent.
 * Manual axe scans run out of band.
 */
const runLiveExplorer = process.env.CMS_E2E_EXPLORER === '1'
const liveExplorer = runLiveExplorer ? test : test.skip

const FASTAPI_URL = process.env.CMS_E2E_FASTAPI_URL || 'http://localhost:8000'

liveExplorer('keyboard selection: guarded shortcut, indeterminate header, shift range, arrow keys', async ({ baseURL, page }) => {
  if (!baseURL) throw new Error('CMS_E2E_BASE_URL is required for the explorer keyboard E2E suite')
  test.setTimeout(120_000)

  // ---------------------------------------------------------------------------
  // 1. Session bootstrap: dev FastAPI session + CMS handoff.
  // ---------------------------------------------------------------------------
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
  await page.goto('/auth/start?return_to=/admin')
  const callback = await callbackResponse
  expect(callback.status(), 'CMS handoff callback failed — is FastAPI CMS_ADMIN_* configured?').toBeLessThan(400)
  await page.waitForURL(`${new URL(baseURL).origin}/admin**`)
  const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'cms_session')
  expect(sessionCookie).toMatchObject({
    domain: new URL(baseURL).hostname,
    httpOnly: true,
    sameSite: 'Lax',
  })

  // ---------------------------------------------------------------------------
  // 2. Explorer page renders the three seeded rows.
  // ---------------------------------------------------------------------------
  await page.goto('/admin/explorer')
  const table = page.getByRole('table', { name: 'Curations' })
  const status = page.locator('.selection-toolbar').getByRole('status')
  const headerCheckbox = table.getByLabel('Select all loaded Curations')
  const rowCheckboxes = table.locator('.curation-table__row input[type="checkbox"]')
  const search = page.getByLabel('Search Curations')

  await expect(rowCheckboxes).toHaveCount(3, { timeout: 30_000 })
  await expect(status).toContainText('0 Curations selected')
  await expect(status).toHaveAttribute('aria-live', 'polite')

  // ---------------------------------------------------------------------------
  // 3. The "a" shortcut is guarded by isEditableTarget: typing in the search
  //    input must never select anything, while the toolbar button (the visual
  //    equivalent) works when focus leaves editable targets.
  // ---------------------------------------------------------------------------
  await search.focus()
  await page.keyboard.press('a')
  await expect(status).toContainText('0 Curations selected')

  const selectAllMatching = page.getByRole('button', { name: 'Select all matching results' })
  await expect(selectAllMatching).toBeVisible()
  await selectAllMatching.click()
  await expect(status).toContainText('matching Curations selected')
  await expect(selectAllMatching).not.toBeVisible()

  // Back to an explicit empty selection: submitting the search resets it.
  await search.focus()
  await page.keyboard.press('Enter')
  await expect(status).toContainText('0 Curations selected')

  // ---------------------------------------------------------------------------
  // 4. Header checkbox: indeterminate partial state, then the full loaded range.
  // ---------------------------------------------------------------------------
  await rowCheckboxes.nth(0).click()
  await expect(status).toContainText('1 Curations selected')
  await expect(headerCheckbox).toHaveJSProperty('indeterminate', true)

  await rowCheckboxes.nth(1).click()
  await rowCheckboxes.nth(2).click()
  await expect(status).toContainText('3 Curations selected')
  await expect(headerCheckbox).toBeChecked()
  await expect(headerCheckbox).toHaveJSProperty('indeterminate', false)

  await headerCheckbox.click()
  await expect(status).toContainText('0 Curations selected')
  await expect(headerCheckbox).not.toBeChecked()

  // ---------------------------------------------------------------------------
  // 5. Shift-click selects exactly the loaded range (and re-toggling it
  //    deselects the same range).
  // ---------------------------------------------------------------------------
  await rowCheckboxes.nth(0).click()
  await rowCheckboxes.nth(2).click({ modifiers: ['Shift'] })
  await expect(status).toContainText('3 Curations selected')

  await rowCheckboxes.nth(0).click({ modifiers: ['Shift'] })
  await expect(status).toContainText('0 Curations selected')

  // ---------------------------------------------------------------------------
  // 6. Arrow keys move the active row, Space toggles it, both clamped to the
  //    loaded range.
  // ---------------------------------------------------------------------------
  await table.click()
  await table.press('ArrowDown')
  await table.press('ArrowDown')
  await expect(table.locator('[data-active="true"]')).toHaveAttribute('data-index', '1')
  await table.press(' ')
  await expect(status).toContainText('1 Curations selected')

  await table.press('ArrowUp')
  await expect(table.locator('[data-active="true"]')).toHaveAttribute('data-index', '0')
  await table.press(' ')
  await expect(status).toContainText('2 Curations selected')

  await table.press('ArrowUp')
  await expect(table.locator('[data-active="true"]')).toHaveAttribute('data-index', '0')
})
