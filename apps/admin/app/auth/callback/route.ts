import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import config from '@payload-config'
import { getPayload } from 'payload'
import { completeCmsHandoff } from '../../../src/auth/cms-handoff'
import { readEnv } from '../../../src/env'

function callbackError(message: string, status: number): NextResponse {
  const response = new NextResponse(message, { status })
  response.cookies.delete('cms_login_state')
  return response
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return callbackError('Invalid CMS handoff callback', 400)

  const cookieStore = await cookies()
  try {
    const payload = await getPayload({ config })
    const env = readEnv()
    const handoff = await completeCmsHandoff(payload, {
      code,
      state,
      cookieValue: cookieStore.get('cms_login_state')?.value,
      targetOrigin: new URL(env.publicServerUrl).origin,
    })
    const response = NextResponse.redirect(new URL(handoff.returnTo, env.publicServerUrl))
    response.cookies.set('cms_session', handoff.session, {
      httpOnly: true,
      maxAge: 8 * 60 * 60,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
    response.cookies.delete('cms_login_state')
    return response
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid CMS login state') {
      return callbackError('Invalid CMS login state', 400)
    }
    if (error instanceof Error && error.message === 'CMS admin access is required') {
      return callbackError('CMS admin access is required', 403)
    }
    return callbackError('CMS authorization failed', 401)
  }
}
