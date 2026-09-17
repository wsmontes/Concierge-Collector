import { act, cleanup, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { CmsLoginView } from '../../../../src/components/auth/CmsLoginView'

/**
 * A tela de entrada tem um contrato só: ela entrega o operador ao handoff do
 * Concierge. O que se prova aqui é o que um operador observa — a rota do
 * handoff, a ausência de um segundo caminho de credencial e o estado visível
 * enquanto o redirecionamento está em curso.
 */

// O clique num `<a href>` faz o jsdom tentar navegar (não implementado) e poluir
// a saída. Um listener de janela cancela a ação padrão no FIM do caminho; o de
// documento roda antes dele e DEPOIS do React, então registra o que o próprio
// componente cancelou — é esse sinal que o teste do segundo clique lê.
let cancelledByComponent = false

function rememberCancellation(event: MouseEvent): void {
  cancelledByComponent = event.defaultPrevented
}

function stopNavigation(event: MouseEvent): void {
  event.preventDefault()
}

beforeAll(() => {
  document.addEventListener('click', rememberCancellation)
  window.addEventListener('click', stopNavigation)
})

afterAll(() => {
  document.removeEventListener('click', rememberCancellation)
  window.removeEventListener('click', stopNavigation)
})

afterEach(cleanup)

/** Clica e responde se o COMPONENTE cancelou o clique. */
function clickLink(link: HTMLElement): boolean {
  cancelledByComponent = false
  act(() => {
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  return cancelledByComponent
}

describe('CmsLoginView', () => {
  test('hands the operator over through /auth/start and offers no password field', () => {
    render(<CmsLoginView />)

    expect(screen.getByRole('link', { name: /Continue with Concierge/ })).toHaveAttribute(
      'href',
      '/auth/start?return_to=/admin',
    )
    // A autenticação é OAuth pelo FastAPI: um campo de senha aqui seria uma
    // segunda identidade, e é isso que este teste impede de voltar.
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Editorial Admin' })).toBeVisible()
  })

  test('shows the redirecting state and never restarts the handoff on a second click', () => {
    render(<CmsLoginView />)
    const action = screen.getByRole('link', { name: /Continue with Concierge/ })
    expect(screen.queryByText('Redirecting to Concierge…')).toBeNull()

    // O primeiro clique é do handoff: o componente não o cancela.
    expect(clickLink(action)).toBe(false)

    expect(screen.getByRole('status')).toHaveTextContent('Redirecting to Concierge…')
    expect(action).toHaveAttribute('data-redirecting', 'true')
    expect(action).toHaveAttribute('aria-busy', 'true')

    // Um segundo clique abriria uma segunda autorização e derrubaria a primeira.
    expect(clickLink(action)).toBe(true)
  })
})
