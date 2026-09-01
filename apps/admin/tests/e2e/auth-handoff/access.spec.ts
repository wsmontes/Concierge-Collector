import { expect, test } from '@playwright/test'

const runLiveHandoff = process.env.CMS_E2E_AUTH_HANDOFF === '1'
const liveHandoff = runLiveHandoff ? test : test.skip

liveHandoff('CMS handoff keeps tokens out of browser state and sets a host-only session cookie', async ({
  baseURL,
  context,
  page,
}) => {
  if (!baseURL) throw new Error('CMS_E2E_BASE_URL is required for the CMS handoff E2E suite')

  // Bootstrap da sessão dev no FastAPI (igual ao publish spec): sem o
  // dev-login, o /auth/cms/authorize responde 401 e o handoff nunca chega
  // ao callback. O runbook §2 exige ENVIRONMENT=development exatamente
  // para este fluxo.
  const FASTAPI_URL = process.env.CMS_E2E_FASTAPI_URL || 'http://127.0.0.1:8000'
  const fastApiOrigin = new URL(FASTAPI_URL).origin
  const devLogin = await fetch(`${FASTAPI_URL}/api/v3/auth/dev-login`)
  expect(devLogin.status, 'FastAPI must run in development mode for dev-login').toBe(200)
  const tokens = await devLogin.json() as { access_token?: string; refresh_token?: string }
  expect(tokens.access_token).toBeTruthy()
  await context.addCookies([
    { name: 'access_token', value: tokens.access_token ?? '', domain: new URL(fastApiOrigin).hostname, path: '/' },
    { name: 'refresh_token', value: tokens.refresh_token ?? '', domain: new URL(fastApiOrigin).hostname, path: '/' },
  ])

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

  // Playwright NÃO expõe set-cookie de respostas de redirect (nem em
  // allHeaders() nem em headersArray()) — o browser processa o cookie do
  // redirect mesmo assim. As asserções de cookie abaixo (domain/httpOnly/
  // sameSite) são a prova observável do handoff; o publish spec confirma
  // o mesmo cookie via context.cookies() após o mesmo fluxo.

  const session = (await context.cookies()).find((cookie) => cookie.name === 'cms_session')
  expect(session).toMatchObject({
    domain: new URL(baseURL).hostname,
    httpOnly: true,
    sameSite: 'Lax',
  })

  const localStorageKeys = await page.evaluate(() => Object.keys(localStorage))
  expect(localStorageKeys).not.toContainEqual(expect.stringMatching(/(?:access|refresh)[_-]?token|jwt/i))
})
