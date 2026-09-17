'use client'

import { Modal, useModal } from '@payloadcms/ui'
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'

/**
 * Diálogo. Envolve o `Modal` do Payload (faceless-ui) de propósito: ele já
 * entrega o item de modal com focus trap, `Esc`, bloqueio de rolagem do corpo e
 * fechamento por clique fora. Antes havia 7 diálogos caseiros com 4 backdrops
 * copiados, 3 deles sem `aria-modal` e nenhum com foco preso — o teclado
 * escapava para a página atrás.
 *
 * ## Por que existe um caminho sem provider
 *
 * O `Modal` do Payload só funciona sob o `ModalProvider` do `RootProvider`, que
 * existe no browser mas NÃO em `jsdom` — um teste unitário de tela com diálogo
 * não tem provider nenhum, e `modalState` fica `undefined`. Em vez de obrigar
 * cada teste a montar o provider (que não é a mesma instância de contexto que o
 * bundle do Payload usa), o componente detecta a ausência e desenha a mesma
 * caixa inline, com o `.ui-backdrop` do kit. Assim: no browser, o comportamento
 * é o do Payload (foco preso, `Esc`, clique fora); sem provider, a caixa e o
 * conteúdo continuam verificáveis.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = '34rem',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const generatedId = useId()
  const slug = `ui-dialog-${generatedId}`
  const titleId = `${slug}-title`
  const modal = useModal()
  const hasProvider = Boolean(modal && modal.modalState)
  const isOpenNow = hasProvider ? modal.modalState?.[slug]?.isOpen === true : false
  const wasOpen = useRef(false)

  // `Esc` e clique fora fecham o modal DENTRO do faceless-ui, sem passar pelo
  // `onClose` da prop — ele vai parar no DOM, não no shell. Sem observar o
  // estado do próprio slug, o chamador continuaria achando que o diálogo está
  // aberto (e reabrir na mesma linha não funcionaria, porque o estado não mudou).
  useEffect(() => {
    if (wasOpen.current && !isOpenNow) onClose()
    wasOpen.current = isOpenNow
  }, [isOpenNow, onClose])

  // No caminho sem provider não existe quem trate `Esc` (o faceless-ui é quem o
  // faz quando há provider). Sem isto, "Esc fecha" só valeria em browser — e um
  // teste de tela não teria como provar o gesto. O listener vive enquanto o
  // diálogo está aberto e sai com ele.
  useEffect(() => {
    if (!open || hasProvider) return undefined
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hasProvider, onClose, open])

  if (!open) return null

  const box = (
    <div
      aria-labelledby={titleId}
      aria-modal={hasProvider ? 'true' : undefined}
      className="ui-dialog"
      role="dialog"
      style={{ '--ui-dialog-width': width } as CSSProperties}
    >
      <header className="ui-dialog__header">
        <h2 className="ui-dialog__title" id={titleId}>
          {title}
        </h2>
        {description && <p className="ui-dialog__description">{description}</p>}
      </header>
      <div className="ui-dialog__body">{children}</div>
      {footer && <div className="ui-dialog__footer">{footer}</div>}
    </div>
  )

  if (!hasProvider) {
    return (
      <div
        className="ui-backdrop ui-dialog-host"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
        role="presentation"
      >
        {box}
      </div>
    )
  }

  return (
    <Modal
      className="ui-dialog-host"
      closeOnBlur
      htmlElement="div"
      lockBodyScroll
      onClose={onClose}
      openOnInit
      slug={slug}
      trapFocus
    >
      {box}
    </Modal>
  )
}
