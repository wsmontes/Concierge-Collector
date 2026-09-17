'use client'

import type { ReactNode } from 'react'

/**
 * Barra de ferramentas: uma faixa só para busca, filtros e ações da lista.
 * Antes cada tela empilhava caixas — filtros, depois ordenação, depois colunas,
 * depois views salvas — cada uma com sua moldura, e a tabela começava abaixo da
 * dobra. Aqui tudo que age sobre a lista divide a mesma faixa.
 */
export function Toolbar({
  children,
  className = '',
  bare = false,
  label,
}: {
  children: ReactNode
  className?: string
  /** Sem moldura: para quando a barra vive dentro de um cartão. */
  bare?: boolean
  label?: string
}) {
  return (
    <div
      className={`ui-toolbar ${bare ? 'ui-toolbar--bare' : ''} ${className}`.trim()}
      aria-label={label}
    >
      {children}
    </div>
  )
}

export function ToolbarGroup({ children, end = false }: { children: ReactNode; end?: boolean }) {
  return <div className={`ui-toolbar__group ${end ? 'ui-toolbar__group--end' : ''}`.trim()}>{children}</div>
}

/**
 * Campo de busca da barra. O rótulo é sempre visível para leitor de tela e o
 * botão de limpar aparece só com conteúdo — antes havia oito implementações de
 * `<input type="search">` com par rótulo/controle reinventado em cada tela.
 */
export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
  name = 'search',
  autoFocus = false,
  onKeyDown,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  name?: string
  autoFocus?: boolean
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const inputId = `ui-search-${name}`
  return (
    <div className="ui-search">
      <label className="ui-visually-hidden" htmlFor={inputId}>
        {label}
      </label>
      <span aria-hidden="true" className="ui-search__icon">
        <svg fill="none" height="14" viewBox="0 0 16 16" width="14">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
        </svg>
      </span>
      <input
        autoComplete="off"
        autoFocus={autoFocus}
        id={inputId}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {value.length > 0 && (
        <button
          aria-label={`Clear ${label.toLocaleLowerCase()}`}
          className="ui-table__row-action"
          onClick={() => onChange('')}
          type="button"
        >
          ×
        </button>
      )}
    </div>
  )
}
