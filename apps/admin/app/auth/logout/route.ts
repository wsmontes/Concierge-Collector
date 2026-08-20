import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import config from '@payload-config'
import { getPayload } from 'payload'
import { resolveCmsSession, revokeCmsSession } from '../../../src/auth/cms-session'

export async function POST(): Promise<Response> {
  const cookieStore = await cookies()
  const payload = await getPayload({ config })
  const rawSession = cookieStore.get('cms_session')?.value
  if (rawSession) {
    const session = await resolveCmsSession(payload, `cms_session=${rawSession}`)
    if (session) await revokeCmsSession(payload, session.id)
  }

  const response = NextResponse.redirect(new URL('/admin/login', process.env.CMS_PUBLIC_SERVER_URL || 'http://localhost:3000'))
  response.cookies.delete('cms_session')
  response.cookies.delete('cms_login_state')
  return response
}
