/**
 * Precondições do harness de autoração do Collector.
 *
 * Nada aqui abre browser: os guardas rodam no globalSetup, então um banco que
 * não é descartável ou um alvo fora de loopback FALHAM antes do Chromium
 * subir. O seed é o script do próprio repo (`concierge-api-v3/scripts/
 * seed_e2e_curations.py`), que já recusa por conta própria qualquer banco cujo
 * nome não termine em `-test`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { APIRequestContext } from '@playwright/test'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Porta que o `config.js` do Collector (e o FRONTEND_URL do FastAPI) trata como local. */
export const DEFAULT_COLLECTOR_URL = 'http://127.0.0.1:5500'
export const DEFAULT_API_URL = 'http://127.0.0.1:8000'
export const DEFAULT_MONGO_URL = 'mongodb://127.0.0.1:27017'

/**
 * Fixture criada pelo seed do repo (3 Entities + 3 Curations vinculadas).
 * O spec vincula a curadoria autoral a esta Entity porque o seletor de vínculo
 * é local-first: uma Entity já no cache local é vinculável sem rede e sem
 * Google Places.
 */
export const SEEDED_ENTITY_ID = 'baseline_e2e_entity_1'
export const SEEDED_ENTITY_NAME = 'Baseline E2E Restaurant 1'

export const CONCEPT_CATEGORY = 'Cuisine'
export const CONCEPT_VALUE = 'Contemporary Brazilian'

export const isEnabled = (): boolean => process.env.COLLECTOR_E2E === '1'

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

export const apiBaseUrl = (): string => stripTrailingSlash(process.env.COLLECTOR_E2E_API_URL || DEFAULT_API_URL)
export const collectorBaseUrl = (): string => stripTrailingSlash(process.env.COLLECTOR_E2E_BASE_URL || DEFAULT_COLLECTOR_URL)

const LOOPBACK_HOSTS: Record<string, true> = {
    '127.0.0.1': true,
    localhost: true,
    '::1': true,
    '[::1]': true,
}

export function parseLoopbackUrl(rawUrl: string, label: string): URL {
    let url: URL
    try {
        url = new URL(rawUrl)
    } catch {
        throw new Error(`${label} não é uma URL válida: ${rawUrl}`)
    }
    if (LOOPBACK_HOSTS[url.hostname] !== true) {
        throw new Error(
            `${label} precisa apontar para loopback (recebido: ${url.hostname}). ` +
                'Este harness recusa qualquer alvo remoto antes de abrir o browser.'
        )
    }
    return url
}

export interface DisposableStack {
    api: string
    collectorOrigin: string
    database: string
}

/**
 * Exige loopback nos dois alvos e um banco cujo nome termine em `-test`,
 * lido do próprio `/api/v3/info` (o nome real que o processo está usando, não
 * o que o .env promete).
 */
export async function assertDisposableStack(): Promise<DisposableStack> {
    const apiUrl = parseLoopbackUrl(apiBaseUrl(), 'COLLECTOR_E2E_API_URL')
    const collectorUrl = parseLoopbackUrl(collectorBaseUrl(), 'COLLECTOR_E2E_BASE_URL')
    const collectorOrigin = collectorUrl.origin
    const infoUrl = `${stripTrailingSlash(apiUrl.origin)}/api/v3/info`

    let response: Response
    try {
        response = await fetch(infoUrl, { headers: { origin: collectorOrigin } })
    } catch (error) {
        throw new Error(
            `API inalcançável em ${infoUrl} (${(error as Error).message}). ` +
                'Suba o FastAPI local antes de rodar o harness.'
        )
    }
    if (!response.ok) {
        throw new Error(`GET ${infoUrl} respondeu ${response.status}. O FastAPI local não está saudável.`)
    }

    const info = (await response.json()) as { database?: string }
    const database = String(info.database || '')
    if (!database.endsWith('-test')) {
        throw new Error(
            `Recusado: a API em ${apiUrl.origin} está servindo o banco "${database}", que não termina em "-test". ` +
                'Aponte o stack para um banco descartável (MONGODB_URL local + MONGODB_DB_NAME=concierge-collector-test).'
        )
    }

    // O Collector é servido de outra origem (127.0.0.1:5500) e fala com a API
    // por fetch: sem CORS liberado o app nem sai do login. Em development o
    // FastAPI libera o FRONTEND_URL — este guarda nomeia a causa quando não.
    const allowedOrigin = response.headers.get('access-control-allow-origin')
    if (allowedOrigin !== collectorOrigin) {
        throw new Error(
            `A API em ${apiUrl.origin} não libera a origem ${collectorOrigin} ` +
                `(access-control-allow-origin=${allowedOrigin ?? 'ausente'}). ` +
                'Em development a API libera o FRONTEND_URL (default http://127.0.0.1:5500): ' +
                'sirva o Collector nessa origem ou inclua a sua em CORS_ORIGINS.'
        )
    }

    return { api: apiUrl.origin, collectorOrigin, database }
}

/**
 * Recria a fixture do repo no banco de teste. Idempotente (upsert) e barato.
 */
export function seedFixtures(database: string): string {
    const script = path.join(REPO_ROOT, 'concierge-api-v3', 'scripts', 'seed_e2e_curations.py')
    if (!existsSync(script)) {
        throw new Error(`Seed do repo não encontrado: ${script}`)
    }
    const venvPython = path.join(REPO_ROOT, 'concierge-api-v3', 'venv', 'bin', 'python3')
    const python = existsSync(venvPython) ? venvPython : 'python3'

    const result = spawnSync(python, [script], {
        cwd: path.join(REPO_ROOT, 'concierge-api-v3'),
        env: {
            ...process.env,
            MONGODB_TEST_URL: process.env.COLLECTOR_E2E_MONGO_URL || DEFAULT_MONGO_URL,
            MONGODB_TEST_DB_NAME: database,
        },
        encoding: 'utf8',
    })

    if (result.status !== 0) {
        throw new Error(
            `Seed falhou (${python} ${script}): ${result.stderr || result.stdout || `exit ${result.status}`}`
        )
    }
    return (result.stdout || '').trim()
}

/**
 * Login sem Google para o Collector: o token vira `oauth_access_token` no
 * localStorage (as chaves que o app lê e que `cleanupBrowserData` preserva).
 * Só existe em `ENVIRONMENT=development` — em qualquer outro ambiente a API
 * responde 403 e o harness falha alto.
 */
export async function devLoginToken(request: APIRequestContext): Promise<string> {
    const url = `${apiBaseUrl()}/api/v3/auth/dev-login`
    const response = await request.get(url)
    if (!response.ok()) {
        throw new Error(
            `dev-login respondeu ${response.status()} em ${url}. ` +
                'O login sem Google só existe no FastAPI local (ENVIRONMENT=development) — ' +
                'credencial de produção nunca é usada por este harness.'
        )
    }
    const body = (await response.json()) as { access_token?: string }
    if (!body.access_token) {
        throw new Error(`dev-login não devolveu access_token em ${url}`)
    }
    return body.access_token
}
