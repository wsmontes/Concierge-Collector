'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Card } from '../ui/Card'

/**
 * Entrada do Admin — handoff, não formulário.
 *
 * Não existe campo de e-mail e senha aqui, por decisão de produto: a
 * autenticação do produto é OAuth pelo FastAPI (`/auth/start` →
 * `/auth/cms/authorize` → callback do Admin) e quem prova a identidade é o
 * Concierge. Um par e-mail/senha nesta tela seria uma SEGUNDA identidade, com
 * uma segunda senha para vazar e um segundo caminho de sessão para divergir.
 *
 * A rota do handoff não muda: `/auth/start?return_to=/admin`.
 */
const HANDOFF_URL = '/auth/start?return_to=/admin'

export function CmsLoginView(): ReactNode {
  const [redirecting, setRedirecting] = useState(false)

  return (
    <main className="cms-login" aria-labelledby="cms-login-title">
      <div className="cms-login__brand">
        <span aria-hidden="true" className="cms-login__monogram">CC</span>
        <span className="cms-login__brand-name">Concierge Collector</span>
      </div>
      <h1 className="cms-login__title" id="cms-login-title">Editorial Admin</h1>
      <p className="cms-login__lead">
        Curate the collection, keep entities clean and publish to Concierge.
      </p>
      <a
        className="cms-login__action"
        data-redirecting={redirecting}
        href={HANDOFF_URL}
        aria-busy={redirecting}
        aria-disabled={redirecting || undefined}
        onClick={(event) => {
          // O handoff já está em curso: um segundo clique abriria uma segunda
          // autorização e derrubaria a primeira.
          if (redirecting) {
            event.preventDefault()
            return
          }
          setRedirecting(true)
        }}
      >
        <span>Continue with Concierge</span>
        <span aria-hidden="true" className="cms-login__action-mark">{redirecting ? '···' : '→'}</span>
      </a>
      <p className="cms-login__status" role="status">
        {redirecting ? 'Redirecting to Concierge…' : ''}
      </p>
      <Card title="How sign-in works" tone="plain">
        <ul className="cms-login__steps">
          <li>Your Concierge account is the credential: this Admin never asks for a password.</li>
          <li>You are handed to Concierge, sign in there, and come back to this Admin signed in.</li>
          <li>No Concierge account yet? Ask an operator for an ops-login key.</li>
        </ul>
      </Card>
    </main>
  )
}
