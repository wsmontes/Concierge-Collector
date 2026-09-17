'use client'

import { Drawer as PayloadDrawer, useDrawerSlug, useModal } from '@payloadcms/ui'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Gaveta lateral: pré-visualizar um registro sem perder a lista atrás.
 *
 * Envolve o `Drawer` do Payload porque ele já traz a casca certa (camada acima
 * de modal, `inert` no resto, fechamento por `Esc`) e é o mesmo componente que o
 * Admin nativo usa — os três drawers caseiros que existiam aqui divergiam entre
 * si: um deles nem era `position: fixed`, nenhum declarava `aria-modal`.
 *
 * Como no `Dialog`, sem `ModalProvider` (o caso do `jsdom`) o componente desenha
 * a mesma caixa inline: a casca do Payload depende de um contexto que só existe
 * no browser, e um teste de tela não deve virar um teste de provider.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  className = '',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}) {
  const slug = useDrawerSlug('ui-record-drawer')
  const modal = useModal()
  const hasProvider = Boolean(modal && modal.modalState)
  const isOpenNow = hasProvider ? modal.modalState?.[slug]?.isOpen === true : false
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!hasProvider) return
    if (open) modal.openModal(slug)
    else modal.closeModal(slug)
  }, [hasProvider, modal, open, slug])

  // Mesma razão do `Dialog`: fechar por `Esc` acontece dentro do provider e não
  // avisa quem guarda o estado.
  useEffect(() => {
    if (wasOpenRef.current && !isOpenNow) onClose()
    wasOpenRef.current = isOpenNow
  }, [isOpenNow, onClose])

  // Mesma razão do `Dialog`: no caminho sem provider não há quem trate `Esc`.
  useEffect(() => {
    if (!open || hasProvider) return undefined
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hasProvider, onClose, open])

  const header = (
    <header className="ui-drawer__header">
      <h2 className="ui-drawer__title">{title}</h2>
      <button aria-label="Close" className="ui-table__row-action" onClick={onClose} type="button">
        ×
      </button>
    </header>
  )

  if (!open) return null

  if (!hasProvider) {
    return (
      <div
        className={`ui-backdrop ui-drawer-host ${className}`.trim()}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
        role="presentation"
      >
        <div aria-label={title} className="ui-drawer" role="dialog">
          {header}
          {children}
        </div>
      </div>
    )
  }

  return (
    <PayloadDrawer
      className={`ui-drawer-host ${className}`.trim()}
      gutter={false}
      Header={header}
      slug={slug}
      title={title}
    >
      <div className="ui-drawer">{children}</div>
    </PayloadDrawer>
  )
}
