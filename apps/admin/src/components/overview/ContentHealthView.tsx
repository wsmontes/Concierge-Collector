'use client'

/**
 * Editorial dashboard: objective content counters (plan §37/§47).
 *
 * Every number is a count the Catalog boundary computed — there is no invented
 * quality score. Each card is a link to the most precise Curations-list query
 * that shows exactly those records; a counter the list cannot express says so
 * in its own copy instead of linking somewhere that silently does not filter.
 */

import { Button } from '@payloadcms/ui'
import { useCallback, useEffect, useState } from 'react'
import { isRecord } from '../../content/value-guards'
import { AdminSection } from '../ui/AdminPage'
import { InlineNotice } from '../ui/InlineNotice'
import { KpiCard } from '../ui/Card'

/** Wire shape of `GET /api/admin/v1/records/content-health`. */
export interface ContentHealth {
  /**
   * Cobertura de mídia de EXIBIÇÃO, contada sobre as Entities. Não confundir com
   * `without_images`, que conta a EVIDÊNCIA da Curation (a foto capturada pelo
   * curador). Eram o mesmo número no painel antes desta separação — e o operador
   * lia o card errado.
   */
  entities_total: number | null
  entities_display_media_resolved: number | null
  entities_no_sources: number | null
  entities_unresolved: number | null
  total: number | null
  unlinked: number | null
  synthetic_drafts: number | null
  without_images: number | null
  without_transcript: number | null
  updated_today: number | null
  /** Null when the membership ledger exceeded the boundary's per-request cap. */
  without_collections: number | null
  /** Curations the CMS membership ledger currently tracks (live memberships). */
  collections_members_tracked: number | null
  /** Why a counter is unavailable, when the BFF had to degrade the answer. */
  degraded: string | null
}

export interface ContentHealthViewProps {
  /** Injected by tests and by a host that already has the counters. */
  loadHealth?: () => Promise<ContentHealth>
}

/** The Admin BFF route this surface reads. */
const HEALTH_PATH = '/api/admin/v1/records/content-health'

/** The Curations list every card deep-links into. */
const CURATIONS_PATH = '/admin/curations'

const NUMBER_FORMAT = new Intl.NumberFormat('en-US')

/**
 * A counter the boundary did not report stays unknown: rendering it as `0`
 * would state a fact nobody measured.
 */
function countText(count: number | null): string {
  return count === null ? '—' : NUMBER_FORMAT.format(count)
}

/**
 * One advanced-filter clause, serialized the way the frozen `where` contract
 * expects: a repeated query parameter holding URL-encoded JSON. The list
 * decodes it back into this exact object, so the dashboard and the filter UI
 * cannot drift apart.
 */
function whereHref(clause: { field: string; op: string; value?: string }, prefix = ''): string {
  return `${CURATIONS_PATH}?${prefix}where=${encodeURIComponent(JSON.stringify(clause))}`
}

type HealthCardId =
  | 'total'
  | 'unlinked'
  | 'synthetic_drafts'
  | 'without_images'
  | 'without_transcript'
  | 'updated_today'
  | 'without_collections'

interface HealthCardLink {
  href: string
  /** What the link really does — read by hover and by assistive tech. */
  title: string
}

const CARD_ORDER: readonly HealthCardId[] = [
  'total',
  'unlinked',
  'synthetic_drafts',
  'without_images',
  'without_transcript',
  'updated_today',
  'without_collections',
]

const CARD_LABEL: Record<HealthCardId, string> = {
  total: 'Curations',
  unlinked: 'Unlinked',
  synthetic_drafts: 'Synthetic drafts',
  without_images: 'Without evidence media',
  without_transcript: 'Without transcript',
  updated_today: 'Updated today',
  without_collections: 'Without Collections',
}

/**
 * Where each counter sends the operator. Every href is a query the Curations
 * list actually honours — the flat `unlinked`, `status` and `sort` filters plus
 * the advanced `where` contract (the list model owns the spelling of all
 * three). A counter without an addressable query keeps the plain list and says
 * so in its own copy.
 */
const CARD_LINK: Record<HealthCardId, HealthCardLink> = {
  total: {
    href: CURATIONS_PATH,
    title: 'Every stored Curation, in catalog order.',
  },
  unlinked: {
    href: `${CURATIONS_PATH}?unlinked=true`,
    title: 'Curations with no linked Entity.',
  },
  synthetic_drafts: {
    href: whereHref({ field: 'curator_type', op: 'equals', value: 'synthetic' }, 'status=draft&'),
    title: 'Draft Curations authored by the synthetic curator.',
  },
  without_images: {
    href: whereHref({ field: 'sources.image', op: 'is_empty' }),
    title: 'Curations whose stored image list is empty or missing.',
  },
  without_transcript: {
    href: whereHref({ field: 'transcript', op: 'is_empty' }),
    title: 'Curations whose stored transcript is empty or missing.',
  },
  updated_today: {
    href: `${CURATIONS_PATH}?sort=updated_at_desc`,
    title:
      'Counts Curations updated in the last 24 hours. The list has no updated-after parameter yet: this opens every Curation newest-first, so the most recently updated are at the top.',
  },
  without_collections: {
    href: `${CURATIONS_PATH}?without_collections=true`,
    title: 'Curations the CMS membership ledger does not track in any Collection.',
  },
}

async function failureCode(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null
  const code = body?.error?.code
  return typeof code === 'string' && code.length > 0 ? code : `http_${response.status}`
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Missing counters stay null; the renderer decides how to show an unknown. */
function toContentHealth(value: unknown): ContentHealth {
  const body = isRecord(value) ? value : {}
  return {
    total: asCount(body.total),
    unlinked: asCount(body.unlinked),
    synthetic_drafts: asCount(body.synthetic_drafts),
    without_images: asCount(body.without_images),
    without_transcript: asCount(body.without_transcript),
    updated_today: asCount(body.updated_today),
    without_collections: asCount(body.without_collections),
    collections_members_tracked: asCount(body.collections_members_tracked),
    entities_total: asCount(body.entities_total),
    entities_display_media_resolved: asCount(body.entities_display_media_resolved),
    entities_no_sources: asCount(body.entities_no_sources),
    entities_unresolved: asCount(body.entities_unresolved),
    degraded: typeof body.degraded === 'string' && body.degraded.length > 0 ? body.degraded : null,
  }
}

/** The default loader: the Admin BFF route, same-origin with the CMS session. */
export const loadContentHealth: () => Promise<ContentHealth> = async () => {
  let response: Response
  try {
    response = await fetch(HEALTH_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new Error('network_error')
  }
  if (!response.ok) throw new Error(await failureCode(response))
  return toContentHealth(await response.json())
}

/** One read, reduced to what the view renders: the counters or the failure code. */
async function readHealth(loadHealth: () => Promise<ContentHealth>): Promise<{ health: ContentHealth | null; error: string | null }> {
  try {
    return { health: await loadHealth(), error: null }
  } catch (cause) {
    return { health: null, error: cause instanceof Error ? cause.message : 'request_failed' }
  }
}

/**
 * Cobertura de mídia de exibição — o outro lado do par.
 *
 * Estes três contadores não têm link porque a lista de Entities ainda não sabe
 * filtrar por estado de mídia; um link para um filtro que não existe seria pior
 * que a ausência dele. Eles existem para responder a pergunta que o contador de
 * evidência NÃO responde: "os cards vão conseguir mostrar foto?".
 */
function ContentHealthMediaGroup({ health }: { health: ContentHealth }) {
  return (
    <AdminSection
      description="Which Entities can show a photo in the Collector. A durable fact counts only while it is inside its validity window and the Entity still has a source to resolve from."
      title="Entity display media"
    >
      <div className="ui-kpi-grid">
        <KpiCard label="With a display image" value={countText(health.entities_display_media_resolved)} />
        <KpiCard
          hint="No website and no Places id: there is nothing to resolve."
          label="No source at all"
          value={countText(health.entities_no_sources)}
        />
        <KpiCard
          hint="Missing, failed, or past its validity — these are the cards the enrichment queue still has to cover."
          label="Not yet resolved"
          value={countText(health.entities_unresolved)}
        />
        <KpiCard label="Entities" value={countText(health.entities_total)} />
      </div>
    </AdminSection>
  )
}


export function ContentHealthView({ loadHealth = loadContentHealth }: ContentHealthViewProps) {
  const [health, setHealth] = useState<ContentHealth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await readHealth(loadHealth)
    setHealth(result.health)
    setError(result.error)
    setLoading(false)
  }, [loadHealth])

  useEffect(() => {
    let active = true
    void readHealth(loadHealth).then((result) => {
      if (!active) return
      setHealth(result.health)
      setError(result.error)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [loadHealth])

  return (
    <AdminSection
      title="Curations"
      description="Counters over the stored Curations (evidence captured by curators), each one an entry point into the list."
      className="content-health"
      action={loading || !health ? undefined : (
        <Button size="small" onClick={() => void reload()}>Refresh</Button>
      )}
    >
      {error && (
        <InlineNotice tone="error" action={<Button onClick={() => void reload()}>Retry</Button>}>
          {`Could not load content health: ${error}`}
        </InlineNotice>
      )}
      {health?.degraded && <InlineNotice tone="warning">{health.degraded}</InlineNotice>}
      {loading && !health && !error && (
        <p className="ui-page__description" role="status">Loading content health…</p>
      )}
      {health && (
        <div className="ui-kpi-grid">
          {CARD_ORDER.map((id) => (
            <KpiCard
              hint={
                id === 'without_collections'
                  ? `Counted from the CMS membership ledger, which tracks ${countText(health.collections_members_tracked)} Curations. The list applies the same predicate.`
                  : undefined
              }
              href={CARD_LINK[id].href}
              key={id}
              label={CARD_LABEL[id]}
              title={CARD_LINK[id].title}
              value={countText(health[id])}
            />
          ))}
        </div>
      )}
      {health && (
        <ContentHealthMediaGroup health={health} />
      )}
    </AdminSection>
  )
}
