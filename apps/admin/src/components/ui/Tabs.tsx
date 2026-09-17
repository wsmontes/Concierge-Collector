'use client'

import { useId, useState, type ReactNode } from 'react'

export interface TabSpec {
  id: string
  label: string
  /** Contador opcional mostrado ao lado do rótulo (membros, versões…). */
  count?: number
  content: ReactNode
}

/**
 * Abas. Segue o padrão WAI-ARIA de tablist com ativação por setas (Home/End
 * inclusive), porque um tablist que só responde a clique obriga o operador de
 * teclado a tabular por todas as abas para chegar ao painel.
 *
 * As abas do Payload (`Tabs` de campo) servem ao formulário do documento e não a
 * conteúdo arbitrário — por isso este componente existe, em vez de forçar o
 * formulário nativo a fazer um trabalho que não é dele.
 */
export function Tabs({
  tabs,
  defaultTabId,
  label,
  className = '',
}: {
  tabs: TabSpec[]
  defaultTabId?: string
  label: string
  className?: string
}) {
  const baseId = useId()
  const [activeId, setActiveId] = useState(defaultTabId ?? tabs[0]?.id ?? '')
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  if (tabs.length === 0) return null

  return (
    <div className={`ui-tabs ${className}`.trim()}>
      <div aria-label={label} className="ui-tabs__list" role="tablist">
        {tabs.map((tab) => {
          const selected = tab.id === active.id
          return (
            <button
              aria-controls={`${baseId}-panel-${tab.id}`}
              aria-selected={selected}
              className="ui-tabs__tab"
              id={`${baseId}-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(event) => {
                const index = tabs.findIndex((candidate) => candidate.id === tab.id)
                if (event.key === 'ArrowRight') {
                  event.preventDefault()
                  setActiveId(tabs[(index + 1) % tabs.length].id)
                }
                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  setActiveId(tabs[(index - 1 + tabs.length) % tabs.length].id)
                }
                if (event.key === 'Home') {
                  event.preventDefault()
                  setActiveId(tabs[0].id)
                }
                if (event.key === 'End') {
                  event.preventDefault()
                  setActiveId(tabs[tabs.length - 1].id)
                }
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {tab.label}
              {tab.count !== undefined && <span className="ui-chip__count">{tab.count}</span>}
            </button>
          )
        })}
      </div>
      <div
        aria-labelledby={`${baseId}-tab-${active.id}`}
        className="ui-tabs__panel"
        id={`${baseId}-panel-${active.id}`}
        role="tabpanel"
        tabIndex={0}
      >
        {active.content}
      </div>
    </div>
  )
}
