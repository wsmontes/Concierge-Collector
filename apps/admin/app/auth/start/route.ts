import { NextResponse } from 'next/server'
import config from '@payload-config'
import { getPayload } from 'payload'
import { createLoginState, isSafeAdminReturnTo } from '../../../src/auth/cms-session'
import { readEnv } from '../../../src/env'

export async function GET(request: Request): Promise<Response> {
  const returnTo = new URL(request.url).searchParams.get('return_to') || '/admin'
  if (!isSafeAdminReturnTo(returnTo)) return new NextResponse('Invalid return_to', { status: 400 })

  const payload = await getPayload({ config })
  const state = await createLoginState(payload, returnTo)
  const env = readEnv()
  const authorizeUrl = new URL('/api/v3/auth/cms/authorize', env.fastApiBaseUrl)
  authorizeUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set('cms_login_state', state, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}
