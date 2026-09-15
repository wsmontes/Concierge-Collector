import { withPayload } from '@payloadcms/next/withPayload'

/**
 * O stack de qualificação usa `127.0.0.1` como origem — `CMS_ADMIN_ORIGIN`,
 * `CMS_ADMIN_CALLBACK_URL` e o default de `CMS_E2E_BASE_URL` — enquanto o dev
 * server (Turbopack) se considera `localhost`. Ele recusa recursos de dev de
 * origem cruzada, e o sintoma é traiçoeiro: o SSR entrega a página inteira, o
 * cliente nunca hidrata (sem erro de console, sem request falhando) e as telas
 * que carregam dados no cliente ficam permanentemente vazias. Loopback é
 * confiável por definição, então as duas formas entram na allowlist.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
}

export default withPayload(nextConfig)
