'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react'
import { curationColumn, type CurationColumnId } from '../../content/curation-columns'
import type { AdminCurationRow } from '../../explorer/types'
import { Chip } from '../ui/Chip'
import { DataTable, type DataTableColumn } from '../ui/DataTable'
import { StatusPill } from '../ui/StatusPill'
import { formatAbsoluteDate, formatRelativeDate } from '../ui/format-relative-date'

/**
 * Altura de uma linha, espelhando `--cms-row-height` e
 * `--cms-row-height-compact` do tema: o virtualizador calcula deslocamentos em
 * PIXEL, então ele precisa do número, enquanto o CSS precisa do token. As duas
 * cópias vivem lado a lado de propósito — mudar o tema sem mudar esta tabela
 * desalinha a janela virtual.
 */
export const CURATION_ROW_HEIGHT = { comfortable: 52, compact: 36 } as const

export type CurationDensity = keyof typeof CURATION_ROW_HEIGHT

/** Conceitos além deste tanto viram um único marcador `+N` em vez de chips. */
const CONCEPT_CHIP_LIMIT = 3

/** Linhas montadas acima e abaixo da janela, para a rolagem não piscar vazio. */
const VIEWPORT_OVERSCAN = 12

/**
 * Abaixo de 900px o `DataTable` vira cartão e cada linha passa a ter altura
 * própria: virtualizar por uma altura fixa mentiria, então a lista deixa de
 * virtualizar e a página inteira rola.
 */
const STACKED_MEDIA_QUERY = '(max-width: 900px)'

/** Teclas que movem a linha ativa (as mesmas que o `DataTable` trata). */
const NAVIGATION_KEYS: Record<string, true> = { ArrowDown: true, ArrowUp: true, Home: true, End: true }

const MISSING = '—'

interface CurationColumnSpec {
  /**
   * Largura da coluna. Só tem efeito porque esta tabela fixa
   * `table-layout: fixed` — `minmax()` (usado nas telas irmãs) é inválido em
   * `width` e o navegador descarta a declaração.
   */
  width: string
  align?: 'start' | 'end'
  cell: (row: AdminCurationRow) => ReactNode
}

function countCell(value: number | null | undefined): ReactNode {
  return typeof value === 'number' ? <span className="ui-table__num">{value.toLocaleString('en-US')}</span> : MISSING
}

function timestampCell(value: string | null | undefined): ReactNode {
  if (!value) return MISSING
  const absolute = formatAbsoluteDate(value)
  return <time className="ui-table__num" dateTime={value} title={absolute ?? undefined}>{formatRelativeDate(value)}</time>
}

/**
 * Conceitos da Curation como chips. A célula mostra os primeiros e resume o
 * resto em `+N`: a lista é para varredura, não para ler o vocabulário inteiro.
 */
function conceptCell(values: readonly string[] | null | undefined): ReactNode {
  if (!values || values.length === 0) return MISSING
  const visible = values.slice(0, CONCEPT_CHIP_LIMIT)
  const hidden = values.length - visible.length
  return (
    <span className="curations-table__chips">
      {visible.map((value) => <Chip key={value} size="sm">{value}</Chip>)}
      {hidden > 0 && <Chip size="sm" title={`${hidden} more concepts`}>{`+${hidden}`}</Chip>}
    </span>
  )
}

/**
 * A identidade editorial da linha: o nome do lugar que o curador reconhece,
 * seguido do estado. O id técnico tem coluna própria (mono).
 */
function identityCell(row: AdminCurationRow): ReactNode {
  return (
    <span className="curations-table__identity">
      <span className="curations-table__name">{row.restaurant_name ?? row.curation_id}</span>
      <StatusPill status={row.status} />
    </span>
  )
}

/**
 * Uma célula por coluna configurada. Um campo que a linha não carrega aparece
 * como ausente — a tabela nunca inventa um valor.
 */
const CELLS: Record<CurationColumnId, CurationColumnSpec> = {
  curation: { width: '20rem', cell: identityCell },
  curator: { width: '13rem', cell: (row) => row.curator_name ?? row.curator_id ?? MISSING },
  type: { width: '8rem', cell: (row) => row.entity_type ?? MISSING },
  city: { width: '10rem', cell: (row) => row.city ?? MISSING },
  concepts: { width: '17rem', cell: (row) => conceptCell(row.concepts) },
  collections: { align: 'end', width: '7rem', cell: (row) => countCell(row.collections_count) },
  state: { width: '9rem', cell: (row) => <StatusPill status={row.status} /> },
  updated: { align: 'end', width: '11rem', cell: (row) => timestampCell(row.updated_at) },
  created: { align: 'end', width: '11rem', cell: (row) => timestampCell(row.created_at) },
  curation_id: { width: '14rem', cell: (row) => <span className="ui-table__mono">{row.curation_id}</span> },
  source_count: { align: 'end', width: '6rem', cell: (row) => countCell(row.source_count) },
  image_count: { align: 'end', width: '6rem', cell: (row) => countCell(row.image_count) },
  audio_count: { align: 'end', width: '6rem', cell: (row) => countCell(row.audio_count) },
  has_transcript: {
    width: '7rem',
    cell: (row) => (typeof row.has_transcript === 'boolean' ? (row.has_transcript ? 'Yes' : 'No') : MISSING),
  },
  version: { align: 'end', width: '6rem', cell: (row) => (typeof row.version === 'number' ? String(row.version) : MISSING) },
}

export interface CurationTableProps {
  columns: readonly CurationColumnId[]
  density?: CurationDensity
  /** Altura da janela de rolagem, em pixels. */
  height: number
  isSelected?: (row: AdminCurationRow) => boolean
  /** Um clique na linha, ou `Enter` na linha ativa, abre a prévia. */
  onOpenRow?: (row: AdminCurationRow) => void
  onToggle?: (row: AdminCurationRow, index: number, shiftKey: boolean) => void
  onToggleAllLoaded?: (selectAll: boolean) => void
  rows: readonly AdminCurationRow[]
  /** O checkbox do cabeçalho age só sobre a faixa carregada; fica inerte enquanto uma intenção "all matching" está ativa. */
  selectAllDisabled?: boolean
  loading?: boolean
  empty?: ReactNode
  footer?: ReactNode
}

/** `true` quando a casca está no modo cartão (a tabela deixa de ser virtualizada). */
function useStackedLayout(): boolean {
  // O valor inicial sai do próprio media query: sincronizar por efeito seria um
  // segundo render só para dizer o que o primeiro já podia saber.
  const [stacked, setStacked] = useState(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(STACKED_MEDIA_QUERY).matches,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(STACKED_MEDIA_QUERY)
    const onChange = (event: MediaQueryListEvent) => setStacked(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return stacked
}

/**
 * A lista de Curations sobre o `DataTable` do kit.
 *
 * A virtualização continua sendo desta tabela — o kit só desenha a janela que
 * recebe (`rows` + `paddingTop`/`paddingBottom`) — porque a paginação é do
 * servidor: uma página grande monta só as linhas visíveis, sem perder o
 * cursor da página. A rolagem acontece dentro do `__scroll` do `DataTable`
 * (é o que faz o cabeçalho ficar preso) e é o elemento que o virtualizador
 * mede.
 */
export function CurationTable({
  columns,
  density = 'comfortable',
  height,
  isSelected,
  onOpenRow,
  onToggle,
  onToggleAllLoaded,
  rows,
  selectAllDisabled = false,
  loading = false,
  empty,
  footer,
}: CurationTableProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stacked = useStackedLayout()
  const rowHeight = CURATION_ROW_HEIGHT[density]

  // eslint-disable-next-line react-hooks/incompatible-library -- a virtualização mede o elemento de rolagem do kit de propósito.
  const virtualizer = useVirtualizer({
    count: stacked ? 0 : rows.length,
    getScrollElement: () => hostRef.current?.querySelector<HTMLElement>('.ui-table__scroll') ?? null,
    estimateSize: () => rowHeight,
    initialRect: { height, width: 1000 },
    overscan: VIEWPORT_OVERSCAN,
  })

  const tableColumns = useMemo<Array<DataTableColumn<AdminCurationRow>>>(
    () => columns.map((id) => {
      const spec = CELLS[id]
      const { label } = curationColumn(id)
      return { key: id, header: label, label, align: spec.align, width: spec.width, cell: spec.cell }
    }),
    [columns],
  )

  const indexByKey = useMemo(
    () => new Map(rows.map((row, index) => [row.curation_id, index] as const)),
    [rows],
  )

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>()
    if (isSelected) for (const row of rows) if (isSelected(row)) keys.add(row.curation_id)
    return keys
  }, [isSelected, rows])

  // JSDOM e o primeiro quadro do navegador medem uma viewport de rolagem zero:
  // até o virtualizador medir, a janela é a fatia que cabe na altura pedida.
  const virtualItems = virtualizer.getVirtualItems()
  const visible = virtualItems.length > 0
    ? virtualItems
    : (stacked ? [] : rows.slice(0, Math.ceil(height / rowHeight) + VIEWPORT_OVERSCAN)
      .map((_row, index) => ({ index, size: rowHeight, start: index * rowHeight })))
  const first = visible[0]
  const last = visible[visible.length - 1]
  const windowRows = visible.map((item) => rows[item.index]).filter((row): row is AdminCurationRow => row !== undefined)
  const paddingTop = first ? first.start : 0
  const paddingBottom = last ? Math.max(0, virtualizer.getTotalSize() - (last.start + last.size)) : 0

  /**
   * A janela virtual é menor que a página: quando o teclado chega à borda, o
   * `DataTable` não tem linha seguinte para focar. Aqui a janela acompanha o
   * índice ativo — o `scrollToIndex` de uma linha já visível não faz nada, e a
   * de uma linha fora da janela a traz para o próximo passo.
   */
  function followActiveRow(event: React.KeyboardEvent<HTMLDivElement>) {
    if (stacked || !NAVIGATION_KEYS[event.key]) return
    const active = hostRef.current?.querySelector<HTMLElement>('.ui-table__row[data-active="true"]')
    const index = Number(active?.dataset.index)
    if (Number.isFinite(index)) virtualizer.scrollToIndex(index)
  }

  /**
   * `Espaço` num checkbox da tabela pertence ao próprio checkbox. O handler de
   * teclado mora na `<table>`, então sem esta captura a mesma tecla chegaria
   * duas vezes: o checkbox marcaria e o handler marcaria de novo — a seleção
   * voltaria ao ponto de partida. (O `DataTable` antigo guardava isso na
   * linha; a guarda viva hoje é esta.)
   */
  function keepRowControlKeysFromTable(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === ' ' && event.target instanceof HTMLInputElement) event.stopPropagation()
  }

  return (
    <div className="curations-table" onKeyDown={followActiveRow} onKeyDownCapture={keepRowControlKeysFromTable} ref={hostRef}>
      <DataTable
        allSelected={rows.length > 0 && selectedKeys.size === rows.length}
        caption="Curations"
        columns={tableColumns}
        density={density}
        empty={empty}
        footer={footer}
        labelWhenAllSelected="Clear selection of loaded Curations"
        loading={loading}
        maxHeight={`${height}px`}
        onActivate={onOpenRow ? (row) => onOpenRow(row) : undefined}
        onToggleAll={selectAllDisabled ? undefined : onToggleAllLoaded}
        onToggleRow={(key, row, modifiers) => onToggle?.(row, indexByKey.get(key) ?? 0, modifiers.shiftKey)}
        paddingBottom={paddingBottom}
        paddingTop={paddingTop}
        rowKey={(row) => row.curation_id}
        rowSelectLabel={(row) => `Select ${row.restaurant_name ?? row.curation_id}`}
        rows={windowRows}
        selectAllLabel="Select all loaded Curations"
        selectable
        selectedKeys={selectedKeys}
        someSelected={selectedKeys.size > 0 && selectedKeys.size < rows.length}
      />
    </div>
  )
}
