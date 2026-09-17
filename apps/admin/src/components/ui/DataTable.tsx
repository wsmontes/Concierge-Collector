'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { SkeletonRows } from './Skeleton'

export interface DataTableColumn<Row> {
  key: string
  header: string
  /** Rótulo exibido quando a tabela vira cartão no mobile. */
  label?: string
  align?: 'start' | 'center' | 'end'
  /** Largura CSS da coluna (`12rem`, `minmax(8rem, 1fr)`…). */
  width?: string
  /** `true` esconde a coluna no modo cartão (coluna técnica). */
  hideOnStack?: boolean
  headerHint?: string
  cell: (row: Row, index: number) => ReactNode
}

/**
 * A tabela do Admin — uma só, para toda lista.
 *
 * Antes havia três gramáticas: uma `<table>` semântica em Collections e duas
 * `div[role=table]` virtualizadas em Curations/Entities, com dois vocabulários de
 * coluna (`COLUMN_WIDTH` duplicado) e uma delas renderizando `entity_type` em
 * duas colunas (`entity` e `type`). Aqui a semântica é sempre `<table>` com
 * `<caption>` (que é o nome acessível lido pelos testes e por leitor de tela),
 * cabeçalho com `scope="col"`, e o comportamento de teclado numa implementação:
 * setas movem a linha ativa, `Enter` ativa, `Espaço` alterna a seleção, `Home`
 * e `End` vão aos extremos.
 *
 * Virtualização é do chamador: ele passa a janela visível em `rows` e as alturas
 * já consumidas em `paddingTop`/`paddingBottom`. Assim a lista continua paginando
 * no servidor — o que o Payload faz bem — e a virtualização só evita montar
 * centenas de linhas de uma página grande.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  density = 'comfortable',
  stacked = true,
  selectable = false,
  selectedKeys,
  onToggleRow,
  onToggleAll,
  allSelected = false,
  someSelected = false,
  onActivate,
  loading = false,
  skeletonRows = 8,
  empty,
  footer,
  paddingTop = 0,
  paddingBottom = 0,
  ariaRowCount,
  maxHeight,
  className = '',
  selectAllLabel = 'Select all rows',
  rowSelectLabel,
  labelWhenAllSelected,
}: {
  caption: string
  columns: Array<DataTableColumn<Row>>
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  density?: 'comfortable' | 'compact'
  stacked?: boolean
  selectable?: boolean
  selectedKeys?: ReadonlySet<string>
  onToggleRow?: (key: string, row: Row, modifiers: { shiftKey: boolean }) => void
  onToggleAll?: (selected: boolean) => void
  allSelected?: boolean
  someSelected?: boolean
  onActivate?: (row: Row, index: number) => void
  loading?: boolean
  skeletonRows?: number
  empty?: ReactNode
  footer?: ReactNode
  paddingTop?: number
  paddingBottom?: number
  ariaRowCount?: number
  maxHeight?: string
  className?: string
  /** Nome acessível do checkbox do cabeçalho. Em inglês, como o resto da UI. */
  selectAllLabel?: string
  /** Nome acessível de cada checkbox de linha. */
  rowSelectLabel?: (row: Row, index: number) => string
  labelWhenAllSelected?: string
}) {
  const [focusIndex, setFocusIndex] = useState(-1)
  const bodyRef = useRef<HTMLTableSectionElement | null>(null)
  const allRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someSelected && !allSelected
  }, [allSelected, someSelected])

  // Derivado, não sincronizado por efeito: quando a lista encolhe (novo filtro),
  // o índice ativo apenas cai para a última linha existente. Começa em `-1`
  // (nenhuma linha ativa): é o que faz o primeiro `ArrowDown` ativar a PRIMEIRA
  // linha, em vez de pular para a segunda. Fica declarado antes do handler
  // porque o handler o lê — e antes do `return`, porque a tabela usa o mesmo
  // índice para decidir se ela própria é focável.
  const activeIndex = rows.length === 0 ? -1 : Math.min(focusIndex, rows.length - 1)
  const columnCount = columns.length + (selectable ? 1 : 0)

  /**
   * Move a linha ativa e leva o foco com ela.
   */
  const moveFocus = useCallback(
    (index: number) => {
      if (rows.length === 0) return
      const nextIndex = Math.max(0, Math.min(index, rows.length - 1))
      setFocusIndex(nextIndex)
      const row = bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]')[nextIndex]
      row?.focus()
    },
    [rows.length],
  )

  // O handler mora na tabela, não na linha: o operador foca a tabela (clicando
  // nela ou tabulando) e as setas passam a mover a linha ativa a partir daí.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableElement>) => {
      // O handler mora na tabela, então o `keydown` de um controle aninhado
      // borbulha até aqui: sem esta guarda, Espaço no checkbox de uma linha marca
      // pelo próprio input E alterna de novo pelo handler — dois toggles, e a
      // seleção volta ao estado anterior.
      //
      // A lista é `closest` de uma vez, e não `instanceof` por tipo: `select` e
      // `textarea` ficavam de fora (só input e botão eram testados), então Espaço
      // num select inline abria o dropdown E alternava a linha, e as setas
      // moviam o foco da tabela em vez do cursor. Um seletor só cobre todo
      // controle dentro de célula — checkbox, botão, link, select, editor.
      if (
        event.target instanceof HTMLElement
        && event.target.closest('input, button, select, textarea, a, [contenteditable="true"]') !== null
      ) {
        return
      }
      const current = activeIndex
      const key = event.key
      if (key === 'ArrowDown') {
        event.preventDefault()
        moveFocus(current + 1)
        return
      }
      if (key === 'ArrowUp') {
        event.preventDefault()
        moveFocus(current <= 0 ? 0 : current - 1)
        return
      }
      if (key === 'Home') {
        event.preventDefault()
        moveFocus(0)
        return
      }
      if (key === 'End') {
        event.preventDefault()
        moveFocus(rows.length - 1)
        return
      }
      if (current < 0) return
      const row = rows[current]
      if (row === undefined) return
      if (key === ' ' && selectable) {
        event.preventDefault()
        onToggleRow?.(rowKey(row, current), row, { shiftKey: event.shiftKey })
        return
      }
      if (key === 'Enter' && onActivate) {
        event.preventDefault()
        onActivate(row, current)
      }
    },
    [activeIndex, moveFocus, onActivate, onToggleRow, rowKey, rows, selectable],
  )

  // Derivado, não sincronizado por efeito: quando a lista encolhe (novo filtro),
  // o índice ativo apenas cai para a última linha existente.
  return (
    <div className={`ui-table ${stacked ? 'ui-table--stacked' : ''} ${className}`.trim()} data-density={density}>
      <div className="ui-table__scroll" style={maxHeight ? ({ '--ui-table-max-height': maxHeight } as React.CSSProperties) : undefined}>
        <table
          className="ui-table__table"
          onKeyDown={handleKeyDown}
          tabIndex={activeIndex === -1 ? 0 : -1}
        >
          <caption className="ui-visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {selectable && (
                <th className="ui-table__th ui-table__th--select" scope="col">
                  <input
                    aria-label={
                      allSelected ? (labelWhenAllSelected ?? 'Clear row selection') : selectAllLabel
                    }
                    checked={allSelected}
                    onChange={(event) => onToggleAll?.(event.target.checked)}
                    ref={allRef}
                    type="checkbox"
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  className="ui-table__th"
                  data-align={column.align ?? 'start'}
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  title={column.headerHint}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {paddingTop > 0 && (
              <tr aria-hidden="true" className="ui-table__spacer">
                <td colSpan={columnCount} style={{ height: `${paddingTop}px` }} />
              </tr>
            )}
            {loading &&
              Array.from({ length: skeletonRows }, (_, index) => (
                <tr className="ui-table__row" key={`skeleton-${index}`}>
                  {selectable && <td className="ui-table__td ui-table__td--select" />}
                  <td className="ui-table__td" colSpan={columns.length}>
                    <SkeletonRows rows={1} />
                  </td>
                </tr>
              ))}
            {!loading &&
              rows.map((row, index) => {
                const key = rowKey(row, index)
                const selected = selectedKeys?.has(key) ?? false
                return (
                  <tr
                    aria-rowindex={ariaRowCount ? index + 2 : undefined}
                    aria-selected={selectable ? selected : undefined}
                    className="ui-table__row"
                    data-active={index === activeIndex ? 'true' : 'false'}
                    data-index={index}
                    data-row="true"
                    data-row-key={key}
                    key={key}
                    onClick={onActivate ? () => onActivate(row, index) : undefined}
                    onFocus={() => setFocusIndex(index)}
                    style={onActivate ? { cursor: 'pointer' } : undefined}
                    tabIndex={index === activeIndex ? 0 : -1}
                  >
                    {selectable && (
                      <td className="ui-table__td ui-table__td--select">
                        <input
                          aria-label={rowSelectLabel ? rowSelectLabel(row, index) : `Select row ${index + 1}`}
                          checked={selected}
                          onChange={(event) =>
                            onToggleRow?.(key, row, {
                              shiftKey: (event.nativeEvent as MouseEvent).shiftKey === true,
                            })
                          }
                          onClick={(event) => event.stopPropagation()}
                          type="checkbox"
                        />
                      </td>
                    )}
                    {columns.map((column) => (
                      <td
                        className="ui-table__td"
                        data-align={column.align ?? 'start'}
                        data-label={column.label ?? column.header}
                        key={column.key}
                      >
                        {column.cell(row, index)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            {paddingBottom > 0 && (
              <tr aria-hidden="true" className="ui-table__spacer">
                <td colSpan={columnCount} style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
        </table>
        {!loading && rows.length === 0 && empty}
      </div>
      {footer && <div className="ui-table__footer">{footer}</div>}
    </div>
  )
}
