export interface CollectionConsumerApplication {
  id: string
  name: string
  owner: string
  status: 'active' | 'suspended'
  defaultRequestsPerMinute: number
}

export interface CollectionDistributionClient {
  applicationsForCollection(collectionId: string): Promise<CollectionConsumerApplication[]>
}

type ApplicationListRecord = CollectionConsumerApplication & {
  allowedCollectionIds: string[]
}

async function json<T>(fetcher: typeof fetch, path: string): Promise<T> {
  const response = await fetcher(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null
    throw new Error(typeof body?.error?.code === 'string' ? body.error.code : `http_${response.status}`)
  }
  return response.json() as Promise<T>
}

export function createCollectionDistributionClient(fetcher: typeof fetch = fetch): CollectionDistributionClient {
  return {
    async applicationsForCollection(collectionId) {
      const response = await json<{ items: ApplicationListRecord[] }>(fetcher, '/api/admin/v1/applications')
      return response.items
        .filter((application) => application.allowedCollectionIds.includes(collectionId))
        .map(({ id, name, owner, status, defaultRequestsPerMinute }) => ({ id, name, owner, status, defaultRequestsPerMinute }))
    },
  }
}
