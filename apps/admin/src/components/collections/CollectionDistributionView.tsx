'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createCollectionDistributionClient,
  type CollectionConsumerApplication,
  type CollectionDistributionClient,
} from '../../collections/distribution-client'
import { AdminSection } from '../ui/AdminPage'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { InlineNotice } from '../ui/InlineNotice'
import { SkeletonRows } from '../ui/Skeleton'

/**
 * Distribution of one Collection: which consumer applications currently allow it,
 * and what archiving does to that access.
 *
 * The list is a read of the applications BFF; when it fails the panel says so and
 * offers the retry, instead of leaving an empty list that reads as "nobody has
 * access".
 */
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
  const [error, setError] = useState<string | null>(null)
  // `loaded` marca a CHAVE (collection + tentativa) que já respondeu: enquanto a
  // chave atual não for a carregada, a seção está carregando. O efeito, assim, só
  // escreve estado quando a resposta chega — nada de `setLoading(true)` síncrono
  // no corpo do efeito, que dispara render em cascata.
  //
  // A tentativa entra na chave porque a recarga é um contador: `loadedId ===
  // collectionId` continuava verdadeiro depois de `reloadKey++`, então o Retry
  // não mostrava carregamento nenhum e a mensagem de erro antiga ficava na tela
  // durante toda a nova requisição.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)

  // A recarga é um contador, e o carregamento é derivado dele: o efeito só
  // escreve estado QUANDO a resposta chega (dentro do callback), nunca de forma
  // síncrona no próprio corpo — é o que a regra do compilador do React pede, e o
  // efeito colateral é o certo: nada renderiza em cascata antes da resposta.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  // Depois de `reloadKey`: fora de ordem isto é dead zone temporal no render.
  const requestKey = `${collectionId}:${reloadKey}`

  useEffect(() => {
    let active = true
    void api.applicationsForCollection(collectionId).then(
      (items) => {
        if (!active) return
        setApplications(items)
        setError(null)
        setLoadedKey(requestKey)
      },
      (cause: unknown) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : 'request_failed')
        setLoadedKey(requestKey)
      },
    )
    return () => { active = false }
  }, [api, collectionId, requestKey])

  const loading = loadedKey !== requestKey

  return (
    <AdminSection
      action={(
        <Link className="collections-link-button" href="/admin/applications">
          Manage Applications
        </Link>
      )}
      description={currentPublishedVersion
        ? `Published version ${currentPublishedVersion} is the externally addressable Collection version.`
        : 'This Collection has not been published yet.'}
      title="Distribution"
    >
      <div className="collection-distribution">
        {lifecycle === 'archived' && (
          <InlineNotice tone="warning">
            <p>
              This Collection is archived: public Collection reads return 410 while application allowlists
              are preserved for restore.
            </p>
          </InlineNotice>
        )}

        {loading && <SkeletonRows rows={2} />}

        {!loading && error && (
          <ErrorState
            description={error}
            onRetry={reload}
            retryLabel="Try again"
            title="Distribution administration is unavailable"
          />
        )}

        {!loading && !error && applications.length === 0 && (
          <EmptyState
            description="No Application currently has this Collection in its allowlist."
            title="No Application yet"
          />
        )}

        {!loading && !error && applications.length > 0 && (
          <ul className="collection-distribution__applications">
            {applications.map((application) => (
              <li key={application.id}>
                <Card title={application.name} tone="quiet">
                  <p>{application.owner} · {application.status} · {application.defaultRequestsPerMinute}/min</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminSection>
  )
}
