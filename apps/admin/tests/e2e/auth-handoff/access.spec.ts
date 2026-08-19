import { expect, test } from '@playwright/test'

const runLiveHandoff = process.env.CMS_E2E_AUTH_HANDOFF === '1'
const liveHandoff = runLiveHandoff ? test : test.skip

liveHandoff('CMS handoff keeps tokens out of browser state and sets a host-only session cookie', async ({
  baseURL,
  context,
  page,
}) => {
  if (!baseURL) throw new Error('CMS_E2E_BASE_URL is required for the CMS handoff E2E suite')

  const adminOrigin = new URL(baseURL).origin
  const callbackResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.origin === adminOrigin && url.pathname === '/auth/callback'
  })

  await page.goto('/auth/start?return_to=/admin')
  const callback = await callbackResponse
  await page.waitForURL(`${adminOrigin}/admin**`)

  const finalUrl = new URL(page.url())
  expect(finalUrl.origin).toBe(adminOrigin)
  for (const parameter of ['access_token', 'refresh_token', 'token', 'jwt', 'code', 'state']) {
    expect(finalUrl.searchParams.has(parameter)).toBe(false)
  }

  const headers = await callback.allHeaders()
  expect(headers['set-cookie']).toMatch(/cms_session=/)
  expect(headers['set-cookie']).not.toMatch(/(?:^|;)\s*domain=/i)

  const session = (await context.cookies()).find((cookie) => cookie.name === 'cms_session')
  expect(session).toMatchObject({
    domain: new URL(baseURL).hostname,
    httpOnly: true,
    sameSite: 'Lax',
  })

  const localStorageKeys = await page.evaluate(() => Object.keys(localStorage))
  expect(localStorageKeys).not.toContainEqual(expect.stringMatching(/(?:access|refresh)[_-]?token|jwt/i))
})
