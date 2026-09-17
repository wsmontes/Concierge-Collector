'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from './ErrorState'

/**
 * Fronteira de erro de um painel.
 *
 * Existe porque a alternativa observada em produção era pior: quando uma leitura
 * do `/admin/operations` falhava, o erro subia até a fronteira do Next e a tela
 * inteira virava "This page couldn't load" — sem o menu, sem o resto do Admin e
 * sem dizer o que falhou. Aqui o que quebra é o painel, e o operador fica com o
 * resto da tela, uma mensagem legível e um botão de tentar de novo.
 *
 * É um class component de propósito: `componentDidCatch` não tem equivalente em
 * hooks.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; title?: string; onRetry?: () => void },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode; title?: string; onRetry?: () => void }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Sem serviço de telemetria no Admin: o console é a superfície que existe e
    // é a que o operador consegue copiar. O texto do erro NÃO vai para a tela.
    console.error('[admin] panel failed to render', error, info.componentStack)
  }

  render() {
    if (this.state.error === null) return this.props.children
    return (
      <ErrorState
        description="The panel failed to render. Nothing was changed — this is a display failure only."
        onRetry={() => {
          this.setState({ error: null })
          this.props.onRetry?.()
        }}
        title={this.props.title ?? 'This panel could not be displayed'}
      />
    )
  }
}
