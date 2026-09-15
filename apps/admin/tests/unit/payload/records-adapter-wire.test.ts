import { afterEach, describe, expect, test, vi } from 'vitest'
import { AdminHttpError } from '../../../src/http/errors'
import { RecordsAdapter } from '../../../src/records/client'

// The real `@concierge/fastapi-client` stays in the graph: this test asserts the
// URL and the credential that actually leave the Admin BFF. Only the CMS
// environment is doubled, because provisioned credentials are not part of the
// wire contract.
vi.mock('../../../src/env', () => ({
  readEnv: () => ({ fastApiBaseUrl: 'http://api.example.test', cmsServiceKey: 'service-key' }),
}))

function captureFetch(responder: () => Response): Array<{ url: string; headers: Headers }> {
  const calls: Array<{ url: string; headers: Headers }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) })
    return responder()
  }))
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('RecordsAdapter media wire format', () => {
  test('reads the Entity gallery from the boundary with the session actor', async () => {
    const calls = captureFetch(() => Response.json({
      items: [{ rank: 0, source: 'website_og', url: '/api/v3/catalog/entities/rest_1/image?rank=0' }],
    }))

    const page = await new RecordsAdapter().entityImages('rest_1', 'admin-1')

    expect(calls[0].url).toBe('http://api.example.test/api/v3/catalog/entities/rest_1/images')
    expect(calls[0].headers.get('x-cms-service-key')).toBe('service-key')
    expect(calls[0].headers.get('x-cms-actor-id')).toBe('admin-1')
    expect(page.items).toEqual([
      { rank: 0, source: 'website_og', url: '/api/v3/catalog/entities/rest_1/image?rank=0' },
    ])
  })

  test('maps a boundary failure onto the Admin error contract', async () => {
    captureFetch(() => Response.json({ detail: 'nope' }, { status: 404 }))

    const failure = await new RecordsAdapter()
      .entityImages('rest_1', 'admin-1')
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AdminHttpError)
    expect((failure as AdminHttpError).status).toBe(404)
    expect((failure as AdminHttpError).code).toBe('not_found')
  })
})
