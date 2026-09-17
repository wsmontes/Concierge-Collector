/**
 * The Curation list's column vocabulary.
 *
 * The table shows the plan's editorial defaults; every other column is opt-in
 * through the column picker and persisted with the saved view.
 */

/**
 * Não há coluna `entity`: a projeção da linha expõe UM fato da Entity — o
 * `entity_type` — e as duas colunas (`entity` e `type`) renderizavam esse mesmo
 * valor. A identidade da Entity que o operador reconhece é o nome do lugar, que
 * já é a célula primária da Curation; `type` continua sendo o tipo.
 */
export type CurationColumnId =
  | 'curation'
  | 'curator'
  | 'type'
  | 'city'
  | 'concepts'
  | 'collections'
  | 'state'
  | 'updated'
  | 'created'
  | 'curation_id'
  | 'source_count'
  | 'image_count'
  | 'audio_count'
  | 'has_transcript'
  | 'version'

export interface CurationColumn {
  id: CurationColumnId
  label: string
  /** Part of the editorial default set (plan §11). */
  default?: boolean
  /** Always visible: the primary identifier of the row. */
  fixed?: boolean
}

export const CURATION_COLUMNS: readonly CurationColumn[] = [
  { id: 'curation', label: 'Curation', default: true, fixed: true },
  { id: 'curator', label: 'Curator', default: true },
  { id: 'type', label: 'Type', default: true },
  { id: 'city', label: 'City', default: true },
  { id: 'concepts', label: 'Concepts', default: true },
  { id: 'collections', label: 'Collections', default: true },
  { id: 'state', label: 'State', default: true },
  { id: 'updated', label: 'Updated', default: true },
  { id: 'created', label: 'Created' },
  { id: 'curation_id', label: 'Curation ID' },
  { id: 'source_count', label: 'Sources' },
  { id: 'image_count', label: 'Images' },
  { id: 'audio_count', label: 'Audio' },
  { id: 'has_transcript', label: 'Transcript' },
  { id: 'version', label: 'Version' },
]

/** Column ids shown when nothing was chosen: the plan's editorial default set. */
export const DEFAULT_CURATION_COLUMNS: readonly CurationColumnId[] =
  CURATION_COLUMNS.filter((column) => column.default).map((column) => column.id)

const COLUMN_BY_ID: Record<string, CurationColumn | undefined> = Object.fromEntries(
  CURATION_COLUMNS.map((column) => [column.id, column]),
)

export function curationColumn(id: CurationColumnId): CurationColumn {
  const column = COLUMN_BY_ID[id]
  if (!column) throw new Error(`Unknown Curation column: ${id}`)
  return column
}

/** Keeps only known ids, preserving the canonical column order and the fixed column. */
export function normalizeCurationColumns(ids: readonly string[] | null | undefined): CurationColumnId[] {
  const requested = new Set(ids ?? [])
  const chosen = CURATION_COLUMNS
    .filter((column) => column.fixed || requested.has(column.id))
    .map((column) => column.id)
  return chosen.length > 0 ? chosen : [...DEFAULT_CURATION_COLUMNS]
}
