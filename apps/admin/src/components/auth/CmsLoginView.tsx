export function CmsLoginView() {
  return (
    <main className="cms-login" aria-labelledby="cms-login-title">
      <h1 id="cms-login-title">Concierge Admin</h1>
      <p>Entre com sua conta Concierge para administrar Collections.</p>
      <a href="/auth/start?return_to=/admin">Entrar com Concierge</a>
    </main>
  )
}
