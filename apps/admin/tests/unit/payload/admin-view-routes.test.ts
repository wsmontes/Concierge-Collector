import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Registration of the custom Admin views, asserted against the REAL Payload
 * config and Payload's own route matcher.
 *
 * This is the surface where the previous bugs lived: a route file under
 * `app/(payload)/admin/collections/[id]` shadowed `/admin/collections/<slug>`,
 * and `/admin/curations/<id>` only works because the list view is registered
 * `exact`. Reproducing the matcher here — rather than reading the config object
 * back — is what actually catches a shadowing regression.
 */
const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = {
    ...originalEnv,
    CMS_MONGODB_URL: 'mongodb://localhost:27017',
    CMS_SERVICE_KEY: 'test-cms-service-key',
    FASTAPI_BASE_URL: 'https://api.example.test',
    PAYLOAD_SECRET: 'x'.repeat(32),
    CMS_PUBLIC_SERVER_URL: 'https://admin.example.test',
    CMS_COLLECTOR_ORIGINS: 'https://concierge-collector.com',
  }
})

afterEach(() => {
  process.env = { ...originalEnv }
})

async function views() {
  const { default: pendingConfig } = await import('../../../payload.config')
  const config = await pendingConfig
  return config.admin?.components?.views ?? {}
}

/**
 * Payload's own matcher, loaded through its dist file.
 *
 * `@payloadcms/next` exposes only its public entry points from `exports`, so a
 * deep subpath import is rejected by the resolver. Loading the real file (not a
 * re-implementation) is the point: the assertion must fail if Payload's
 * matching semantics change under us.
 */
async function isPathMatchingRoute(): Promise<(input: {
  currentRoute: string
  exact?: boolean
  path?: string
}) => boolean> {
  const matcher = await import(
    /* @vite-ignore */ '../../../../../node_modules/@payloadcms/next/dist/views/Root/isPathMatchingRoute.js'
  ) as {
    isPathMatchingRoute: (input: { currentRoute: string; exact?: boolean; path?: string }) => boolean
  }
  return matcher.isPathMatchingRoute
}

/** The view key whose `path` matches `route`, exactly as `getCustomViewByRoute` finds it. */
async function matchedViewKey(route: string): Promise<string | null> {
  const matches = await isPathMatchingRoute()
  const registered = await views()

  for (const [key, view] of Object.entries(registered)) {
    const definition = view as { path?: string; exact?: boolean }
    if (matches({ currentRoute: route, exact: definition.exact, path: definition.path })) return key
  }
  return null
}

describe('custom Admin view routes', () => {
  test('serves each content surface from a root view', async () => {
    expect(await matchedViewKey('/curations')).toBe('curationsWorkspace')
    expect(await matchedViewKey('/curations/507fd0a1c9e07f22be2c1d34')).toBe('curationRecord')
    expect(await matchedViewKey('/explorer')).toBe('curationExplorer')
    expect(await matchedViewKey('/entities/ent_1')).toBe('entityRecord')
    expect(await matchedViewKey('/operations')).toBe('operationsWorkspace')
    expect(await matchedViewKey('/applications')).toBe('consumerApplications')
  })

  test('does not let the Curations list swallow its own record route', async () => {
    // `exact` on the list is what leaves `/curations/<id>` to the record view.
    expect(await matchedViewKey('/curations/507fd0a1c9e07f22be2c1d34/versions')).toBeNull()
    expect(await matchedViewKey('/entities/ent_1/curations')).toBeNull()
  })

  test('keeps collection sub-routes out of the collection detail view', async () => {
    const { default: pendingConfig } = await import('../../../payload.config')
    const config = await pendingConfig
    const collectionViews = config.collections.find((collection) => collection.slug === 'collections')
      ?.admin?.components?.views as Record<string, { path?: string; exact?: boolean }> | undefined
    const matches = await isPathMatchingRoute()

    const workspace = collectionViews?.workspace
    expect(workspace?.path).toBe('/:id')

    const matchWorkspace = (route: string) => matches({
      currentRoute: route,
      exact: workspace?.exact,
      path: `/collections/collections${workspace?.path ?? ''}`,
    })

    expect(matchWorkspace('/collections/collections/507f1f77bcf86cd799439011')).toBe(true)
    // Native version history must stay reachable: the workspace view does not own it.
    expect(matchWorkspace('/collections/collections/507f1f77bcf86cd799439011/versions')).toBe(false)
  })

  test('registers the list override for the collections collection', async () => {
    const { default: pendingConfig } = await import('../../../payload.config')
    const config = await pendingConfig
    const list = config.collections.find((collection) => collection.slug === 'collections')
      ?.admin?.components?.views?.list as { Component?: string } | undefined

    expect(list?.Component).toBe('/src/components/shell/CmsAdminViews#CollectionsAdminView')
  })

  test('marks every root view exact so sibling routes keep Payload auth redirects', async () => {
    const registered = await views()
    const rootViews = Object.entries(registered).filter(([key]) => key !== 'curationExplorer')

    // `collections`/`globals` are built-in prefixes; the rest are ours.
    for (const [key, view] of rootViews) {
      expect((view as { exact?: boolean }).exact, `${key} must be exact`).toBe(true)
    }
  })
})
