'use client'

import { Button } from '@payloadcms/ui'
import type { ReactNode } from 'react'

/**
 * Falha que impede a tela de mostrar dado. Diferente do aviso: aqui existe uma
 * tentativa de novo, porque a causa mais comum é transitória — o container
 * reiniciando, uma fronteira que não respondeu. Foi exatamente o caso do
 * `/admin/operations` em produção, que caía no error boundary padrão do Next
 * ("This page couldn't load") sem oferecer nada além de recarregar a página.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Tentar de novo',
  children,
}: {
  title: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  children?: ReactNode
}) {
  return (
    <div className="ui-error" role="alert">
      <div>
        <h2 className="ui-error__title">{title}</h2>
        {description && <p className="ui-error__description">{description}</p>}
        {children}
      </div>
      {onRetry && (
        <Button buttonStyle="secondary" onClick={onRetry} size="small" type="button">
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
