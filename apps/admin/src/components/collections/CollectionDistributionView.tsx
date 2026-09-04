'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  createCollectionDistributionClient,
  type CollectionConsumerApplication,
  type CollectionDistributionClient,
} from '../../collections/distribution-client'

export function CollectionDistributionView({
  collectionId,
  lifecycle,
  currentPublishedVersion,
  client,
}: {
  collectionId: string
  lifecycle: 'draft' | 'published' | 'archived'
  currentPublishedVersion?: number | null
  client?: CollectionDistributionClient
}) {
  const api = useMemo(() => client ?? createCollectionDistributionClient(), [client])
  const [applications, setApplications] = useState<CollectionConsumerApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void api.applicationsForCollection(collectionId).then(
      (items) => {
        if (!active) return
        setApplications(items)
        setLoading(false)
        setError(null)
      },
      (cause) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : 'request_failed')
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [api, collectionId])

  return <section className="collection-distribution" aria-labelledby="collection-distribution-title">
    <header>
      <h2 id="collection-distribution-title">Distribution</h2>
      {currentPublishedVersion ? (
        <p>Published version {currentPublishedVersion} is the externally addressable Collection version.</p>
      ) : (
        <p>This Collection has not been published yet.</p>
      )}
      {lifecycle === 'archived' && (
        <p role="status">
          This Collection is archived: public Collection reads return 410 while application allowlists are preserved for restore.
        </p>
      )}
    </header>

    <div className="collection-distribution__heading">
      <h3>Consumer applications</h3>
      <a href="/admin/applications">Manage consumer applications</a>
    </div>

    {loading && <p role="status">Loading consumer access…</p>}
    {error && <p role="alert">Distribution administration is unavailable: {error}</p>}
    {!loading && !error && applications.length === 0 && (
      <p>No consumer application currently has this Collection in its allowlist.</p>
    )}
    {!loading && !error && applications.length > 0 && (
      <ul className="collection-distribution__applications">
        {applications.map((application) => <li key={application.id}>
          <h3>{application.name}</h3>
          <p>{application.owner} · {application.status} · {application.defaultRequestsPerMinute}/min</p>
        </li>)}
      </ul>
    )}
  </section>
}
