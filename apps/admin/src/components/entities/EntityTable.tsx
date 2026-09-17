'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { EntityRow } from '../../content/record-types'
import { Chip } from '../ui/Chip'
import { DataTable, type DataTableColumn } from '../ui/DataTable'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

/**
 * Acima deste tamanho a lista entra em janela virtual; abaixo, renderiza a
 * página inteira.
 *
 * O BFF pagina em blocos pequenos (`ENTITY_PAGE_LIMIT`), então na prática toda
 * lista real cabe no DOM — e é o que se quer: com todas as linhas montadas a
 * navegação por seta percorre a página toda e, no mobile, o cartão empilhado
 * mede a própria altura. A janela continua existindo para o caso patológico
 * (uma página gigante), que é o que mantém o DOM limitado a algumas dezenas de
 * linhas.
 */
const FULL_RENDER_LIMIT = 120

/** Linhas extras montadas acima e abaixo da janela visível. */
const OVERSCAN = 12

/** Um `entity_id` estreito ou ausente: o cartão tem que caber sem rolagem lateral. */
const COLUMN_WIDTH: Record<EntityColumnId, string> = {
  entity: '38%',
  type: '10%',
  city: '14%',
  status: '10%',
  curations: '9%',
  collections: '9%',
  updated: '10%',
}

export type EntityColumnId = 'entity' | 'type' | 'city' | 'status' | 'curations' | 'collections' | 'updated'

/**
 * Default column set of the Entity list (plan §20).
 *
 * `Collections` counts the Collections holding any of the Entity's Curations:
 * the membership ledger lives on the Payload side, so the BFF joins it onto
 * the page (one ledger read per page) and the column renders whatever it
 * reports.
 */
const COLUMNS: readonly EntityColumnId[] = ['entity', 'type', 'city', 'status', 'curations', 'collections', 'updated']

/** `City` is derived from the stored `data`, never presented as canonical. */
const COLUMN_LABEL: Record<EntityColumnId, string> = {
  entity: 'Entity',
  type: 'Type',
  city: 'City (derived)',
  status: 'Status',
  curations: 'Curations',
  collections: 'Collections',
  updated: 'Updated',
}

/**
 * The tooltip of each header, where the label alone would be ambiguous — in
 * particular `Entity`, whose thumbnail is the Entity's **display media** (what
 * the Collector card shows), never the curation evidence a curator captured.
 */
const COLUMN_HINT: Record<EntityColumnId, string> = {
  entity: 'Name, Entity id and the Entity display media the Collector card shows',
  type: 'Entity type, from the field registry',
  city: 'Derived from the Entity data — not a canonical field',
  status: 'Entity status',
  curations: 'Curations stored about this Entity',
  collections: 'Collections holding any of this Entity\'s Curations',
  updated: 'Last write to the Entity record',
}

export interface EntityTableProps {
  height: number
  /** Injected navigation, so the surface stays router-agnostic. */
  navigate: (href: string) => void
  onOpenRow: (row: EntityRow) => void
  rowHeight: number
  rows: EntityRow[]
  /** Primeira leitura: a tabela desenha esqueleto em vez de um texto de espera. */
  loading?: boolean
  empty?: ReactNode
  footer?: ReactNode
}

/** A missing value is always an em dash — never blank, never an invented zero. */
function missing(): ReactNode {
  return <span className="entity-table__missing" title="Not available">—</span>
}

function timestampCell(value: string | null): ReactNode {
  if (!value) return missing()
  const absolute = formatAbsoluteDate(value)
  return <time dateTime={value} title={absolute ?? undefined}>{formatRelativeDate(value)}</time>
}

/**
 * The Entity's **display media**, at list size: the top-ranked image the domain
 * boundary resolved from the Entity's own website/Place — what the Collector card
 * shows for this Entity. It is never curation evidence (`sources.image` of a
 * Curation), which is what the curator captured.
 *
 * A row without display media renders nothing rather than a frame: the list is
 * for scanning, and a broken/empty box per row would be noise. The image comes
 * from the Admin BFF (session cookie in, service key never out) and the route
 * defaults to the hero, so the list does not need to know a rank.
 *
 * No request is made for a row that is not rendered: below the window threshold
 * rows are mounted in full, but `loading="lazy"` keeps the browser from fetching
 * what is off-screen.
 */
function EntityRowThumb({ entityId }: { entityId: string }): ReactNode {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      alt=""
      className="ui-table__thumb"
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
      src={`/api/admin/v1/records/entities/${encodeURIComponent(entityId)}/image`}
    />
  )
}

/** Name is the editorial identity; `entity_id` follows as secondary technical text. */
function identityCell(row: EntityRow): ReactNode {
  return (
    <span className="entity-table__identity">
      {row.entity_id && <EntityRowThumb entityId={row.entity_id} />}
      <span className="ui-table__cell-stack">
        <span className="ui-table__primary">{row.name}</span>
        {row.entity_id && <span className="ui-table__mono">{row.entity_id}</span>}
      </span>
    </span>
  )
}

/** A count the BFF did not join is unknown; a real zero is a zero. */
function countCell(value: number | null | undefined): ReactNode {
  if (typeof value !== 'number') return missing()
  return <Chip size="sm" tone={value === 0 ? 'muted' : 'neutral'}>{value.toLocaleString()}</Chip>
}

/**
 * A non-zero Curation count links to the Entity record that holds the Curations,
 * and the opening of the preview is the row's action — following this link is
 * not.
 */
function curationsCell(row: EntityRow, navigate: (href: string) => void): ReactNode {
  if (typeof row.curations_count !== 'number') return missing()
  if (row.curations_count === 0) return countCell(0)
  const href = `/admin/entities/${encodeURIComponent(row.id)}`
  return (
    <a
      className="entity-table__link"
      href={href}
      onClick={(event) => {
        event.stopPropagation()
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(href)
      }}
    >
      <Chip size="sm" tone="accent">{row.curations_count.toLocaleString()}</Chip>
    </a>
  )
}

function cellFor(column: EntityColumnId, row: EntityRow, navigate: (href: string) => void): ReactNode {
  switch (column) {
    case 'entity':
      return identityCell(row)
    case 'type':
      return row.type || missing()
    case 'city':
      return row.city ?? missing()
    case 'status':
      return <StatusPill status={row.status} />
    case 'curations':
      return curationsCell(row, navigate)
    case 'collections':
      // Collections holding this Entity's Curations, joined by the BFF: `null`
      // is unknown and renders as an em dash; `0` is a real zero.
      return countCell(row.collections_count)
    case 'updated':
      return timestampCell(row.updated_at)
  }
}

function columnsFor(navigate: (href: string) => void): Array<DataTableColumn<EntityRow>> {
  return COLUMNS.map((column) => ({
    key: column,
    header: COLUMN_LABEL[column],
    // O mesmo rótulo vira o cabeçalho do campo no cartão empilhado do mobile.
    label: COLUMN_LABEL[column],
    width: COLUMN_WIDTH[column],
    align: column === 'curations' || column === 'collections' ? 'end' : 'start',
    headerHint: COLUMN_HINT[column],
    cell: (row) => cellFor(column, row, navigate),
  }))
}

/**
 * The Entity list, on the shared table.
 *
 * Before this there were three table grammars in the Admin and two of them were
 * `div[role=table]`; the Entity list was one of the two, with its own
 * `COLUMN_WIDTH` vocabulary. Here the semantic table, the keyboard contract and
 * the mobile card come from `DataTable`, and this file only decides what each
 * column says.
 *
 * Windowing is the caller's job by design: the table mounts what it is given and
 * reserves the rest through `paddingTop`/`paddingBottom`, so the list keeps
 * paginating on the server. The kit owns the scrollport (`--ui-table-max-height`),
 * which is why the virtualizer reads it back from the table.
 */
export function EntityTable({
  height,
  navigate,
  onOpenRow,
  rowHeight,
  rows,
  loading = false,
  empty,
  footer,
}: EntityTableProps): ReactNode {
  const columns = useMemo(() => columnsFor(navigate), [navigate])
  const hostRef = useRef<HTMLDivElement | null>(null)
  const windowed = rows.length > FULL_RENDER_LIMIT

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualization deliberately owns scroll measurements.
  const virtualizer = useVirtualizer({
    count: windowed ? rows.length : 0,
    getScrollElement: () => hostRef.current?.querySelector('.ui-table__scroll') ?? null,
    estimateSize: () => rowHeight,
    initialRect: { height, width: 1000 },
    overscan: OVERSCAN,
  })

  // JSDOM e o primeiro frame de layout do browser reportam um scroll rect de
  // zero. Sem janela medida, monta a primeira fatia que caberia na viewport.
  const virtualItems = virtualizer.getVirtualItems()
  const slots = virtualItems.length > 0
    ? virtualItems.map((item) => ({ index: item.index, start: item.start, size: item.size }))
    : Array.from({ length: Math.ceil(height / rowHeight) + OVERSCAN }, (_, index) => ({
        index,
        start: index * rowHeight,
        size: rowHeight,
      }))

  const first = windowed ? slots[0] : undefined
  const last = windowed ? slots[slots.length - 1] : undefined
  const windowRows = windowed ? rows.slice(first?.index ?? 0, (last?.index ?? -1) + 1) : rows
  const paddingTop = first?.start ?? 0
  const paddingBottom = windowed && last !== undefined
    ? Math.max(0, virtualizer.getTotalSize() - (last.start + last.size))
    : 0

  return (
    <div className="entity-table" ref={hostRef}>
      <DataTable<EntityRow>
        ariaRowCount={windowed ? undefined : rows.length}
        caption="Entities"
        columns={columns}
        empty={empty}
        footer={footer}
        loading={loading}
        maxHeight={`${height}px`}
        onActivate={(row) => onOpenRow(row)}
        paddingBottom={paddingBottom}
        paddingTop={paddingTop}
        rowKey={(row) => row.id}
        rows={windowRows}
      />
    </div>
  )
}
