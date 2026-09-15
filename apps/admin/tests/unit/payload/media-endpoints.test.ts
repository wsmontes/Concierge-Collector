import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AdminHttpError } from '../../../src/http/errors'
import { FastApiEntityImageBytes, mediaEndpoints, type MediaAdapter } from '../../../src/payload/endpoints/media'

const { sessionActor } = vi.hoisted(() => ({
  sessionActor: {
    authz_revision: 'revision-1',
    authorized: true,
    email: 'admin@example.test',
    name: 'Admin',
    picture: null,
    role: 'admin' as const,
    user_id: 'admin-1',
  },
}))

/**
 * Mirrors the real wrapper's one guarantee these routes depend on: the handler
 * runs only behind a proven CMS session, and the actor it receives is never the
 * client's. The wrapper's own status/caching contract is covered by
 * `tests/unit/http/with-admin.test.ts`.
 */
vi.mock('../../../src/http/with-admin', () => ({
  withAdmin: (handler: (request: Request, actor: typeof sessionActor) => Promise<Response>) =>
    async (request: Request) => {
      if (!(request.headers.get('cookie') ?? '').includes('cms_session=')) {
        return Response.json({ error: { code: 'authentication_required' } }, { status: 401 })
      }
      try {
        return await handler(request, sessionActor)
      } catch (error) {
        const known = error as { code?: string; status?: number }
        return Response.json(
          { error: { code: known.code ?? 'service_unavailable' } },
          { status: known.status ?? 503 },
        )
      }
    },
}))

const GALLERY_PATH = '/admin/v1/records/entities/:id/images'
const IMAGE_PATH = '/admin/v1/records/entities/:id/image'
const GALLERY_URL = 'https://admin.example.test/api/admin/v1/records/entities/rest_1/images'
const IMAGE_URL = 'https://admin.example.test/api/admin/v1/records/entities/rest_1/image'
const SESSION = { cookie: 'cms_session=session-1' }

function requestFor(
  url: string,
  init: RequestInit & { routeParams?: Record<string, string> } = {},
) {
  const { routeParams, ...requestInit } = init
  const request = new Request(url, requestInit)
  return Object.assign(request, { routeParams }) as never
}

function handlerFor(path: string, adapter: MediaAdapter) {
  const endpoint = mediaEndpoints(() => adapter).find((entry) => entry.method === 'get' && entry.path === path)
  if (!endpoint) throw new Error(`Missing endpoint ${path}`)
  return endpoint.handler
}

describe('Entity media endpoints', () => {
  test('serves the gallery with BFF paths and the actor the session proved', async () => {
    const images = vi.fn().mockResolvedValue({
      items: [
        { rank: 0, source: 'website_og', url: '/api/v3/catalog/entities/rest_1/image?rank=0' },
        { rank: 1, source: 'google_places', url: '/api/v3/catalog/entities/rest_1/image?rank=1' },
      ],
    })
    const image = vi.fn()
    const handler = handlerFor(GALLERY_PATH, { images, image })

    const response = await handler(requestFor(GALLERY_URL, {
      headers: SESSION,
      routeParams: { id: 'rest_1' },
    }))

    expect(response.status).toBe(200)
    expect(images).toHaveBeenCalledWith('rest_1', 'admin-1')
    // The browser can only fetch this BFF, so the boundary path the gallery
    // arrived with is never what the browser receives back.
    await expect(response.json()).resolves.toEqual({
      items: [
        { rank: 0, source: 'website_og', url: '/api/admin/v1/records/entities/rest_1/image?rank=0' },
        { rank: 1, source: 'google_places', url: '/api/admin/v1/records/entities/rest_1/image?rank=1' },
      ],
    })
  })

  test('returns an empty gallery when the Entity has no image', async () => {
    const images = vi.fn().mockResolvedValue({ items: [] })
    const handler = handlerFor(GALLERY_PATH, { images, image: vi.fn() })

    const response = await handler(requestFor(GALLERY_URL, {
      headers: SESSION,
      routeParams: { id: 'rest_1' },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
  })

  test('propagates the adapter failure through the session wrapper', async () => {
    // What the boundary client throws once it has mapped an upstream status; the
    // endpoint must not swallow or re-shape it.
    const images = vi.fn().mockRejectedValue(new AdminHttpError(404, 'not_found'))
    const handler = handlerFor(GALLERY_PATH, { images, image: vi.fn() })

    const response = await handler(requestFor(GALLERY_URL, {
      headers: SESSION,
      routeParams: { id: 'rest_1' },
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_found' } })
  })

  test('refuses a request without the CMS session before the boundary is reached', async () => {
    const images = vi.fn()
    const handler = handlerFor(GALLERY_PATH, { images, image: vi.fn() })

    const response = await handler(requestFor(GALLERY_URL, { routeParams: { id: 'rest_1' } }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: { code: 'authentication_required' } })
    expect(images).not.toHaveBeenCalled()
  })

  test('streams the image bytes through without buffering them', async () => {
    const upstream = new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
      headers: { 'content-type': 'image/jpeg' },
    })
    const image = vi.fn().mockResolvedValue(upstream)
    const handler = handlerFor(IMAGE_PATH, { images: vi.fn(), image })

    const response = await handler(requestFor(IMAGE_URL, {
      headers: SESSION,
      routeParams: { id: 'rest_1' },
    }))

    expect(image).toHaveBeenCalledWith('rest_1', 0, 'admin-1')
    // The very same body object: the proxy hands over the upstream stream
    // instead of reading the JPEG into the Admin's memory first.
    expect(response.body).toBe(upstream.body)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer)
  })

  test('passes a requested rank through and refuses one outside the ceiling', async () => {
    const image = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }),
    )
    const handler = handlerFor(IMAGE_PATH, { images: vi.fn(), image })

    const ranked = await handler(requestFor(`${IMAGE_URL}?rank=3`, {
      headers: SESSION,
      routeParams: { id: 'rest_1' },
    }))
    expect(ranked.status).toBe(200)
    expect(image).toHaveBeenCalledWith('rest_1', 3, 'admin-1')

    for (const invalid of ['8', '-1', 'hero']) {
      const response = await handler(requestFor(`${IMAGE_URL}?rank=${invalid}`, {
        headers: SESSION,
        routeParams: { id: 'rest_1' },
      }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_request' } })
    }
    expect(image).toHaveBeenCalledTimes(1)
  })

  test('treats an address with no Entity id as absent rather than a lookup', async () => {
    const image = vi.fn()
    const handler = handlerFor(IMAGE_PATH, { images: vi.fn(), image })

    const response = await handler(requestFor(IMAGE_URL, { headers: SESSION }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: { code: 'not_found' } })
    expect(image).not.toHaveBeenCalled()
  })
})

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = {
    ...originalEnv,
    CMS_MONGODB_URL: 'mongodb://localhost:27017',
    CMS_SERVICE_KEY: 'test-cms-service-key',
    FASTAPI_BASE_URL: 'https://api.example.test',
    PAYLOAD_SECRET: 'x'.repeat(32),
    CMS_PUBLIC_SERVER_URL: 'https://admin.example.test',
  }
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
})

describe('FastApiEntityImageBytes', () => {
  test('streams the boundary image with the service key the browser never holds', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xd8]), { headers: { 'content-type': 'image/jpeg' } }),
    )
    vi.stubGlobal('fetch', fetcher)

    await new FastApiEntityImageBytes().image('rest_1', 0, 'admin-1')
    await new FastApiEntityImageBytes().image('rest_1', 3, 'admin-1')

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      // Rank 0 is the boundary's default hero; a real rank is spelled out.
      'https://api.example.test/api/v3/catalog/entities/rest_1/image',
      'https://api.example.test/api/v3/catalog/entities/rest_1/image?rank=3',
    ])
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      cache: 'no-store',
      headers: {
        'X-CMS-Actor-Id': 'admin-1',
        'X-CMS-Service-Key': 'test-cms-service-key',
      },
    })
  })

  test.each([
    [404, 404, 'not_found'],
    [403, 403, 'authorization_revoked'],
    [400, 400, 'invalid_request'],
    [500, 503, 'service_unavailable'],
  ])('maps a boundary %i onto %i without leaking the upstream body', async (upstream, status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      Response.json({ detail: 'internal detail' }, { status: upstream }),
    ))

    const failure = await new FastApiEntityImageBytes()
      .image('rest_1', 0, 'admin-1')
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AdminHttpError)
    expect((failure as AdminHttpError).status).toBe(status)
    expect((failure as AdminHttpError).code).toBe(code)
  })

  test('reports an unreachable boundary as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const failure = await new FastApiEntityImageBytes()
      .image('rest_1', 0, 'admin-1')
      .catch((error: unknown) => error)

    expect((failure as AdminHttpError).status).toBe(503)
  })
})
