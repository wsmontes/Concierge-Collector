import config from '@payload-config'
import { handleEndpoints } from 'payload'
import { formatAdminURL } from 'payload/shared'

type RouteContext = {
  params: Promise<{ slug?: string[] }>
}

async function handle(request: Request, { params }: RouteContext): Promise<Response> {
  const awaitedConfig = await config
  const { slug } = await params
  const path = formatAdminURL({
    apiRoute: awaitedConfig.routes.api,
    path: slug ? `/${slug.map(encodeURIComponent).join('/')}` : undefined,
  })

  return handleEndpoints({ config: awaitedConfig, request, path })
}

export const GET = handle
export const POST = handle
export const DELETE = handle
export const PATCH = handle
export const PUT = handle
export const OPTIONS = handle
