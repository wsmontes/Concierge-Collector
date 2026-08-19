# Fundação do Monorepo e Payload CMS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um Admin Payload/Next e um worker separado ao repositório sem mover nem regressar o Collector vanilla ou o FastAPI existentes.

**Architecture:** A raiz passa a ser um npm workspace incremental e continua publicando o Collector estático. `apps/admin` possui o banco lógico `concierge-cms`, rotas Payload e jobs; web e worker compartilham código/lockfile, mas são processos distintos.

**Tech Stack:** Node.js 22, npm 10.9.2 workspaces, Payload 3.86.0, `@payloadcms/next` 3.86.0, `@payloadcms/db-mongodb` 3.86.0, Next.js 16.2.12, React 19.2.6, TypeScript 5.9.3, Vitest 4.1.1, ESLint 9.39.1, MongoDB.

**Spec:** `docs/superpowers/specs/2026-08-18-collections-payload-cms-design.md`

## Global Constraints

- Manter `index.html`, `scripts/`, `styles/`, `tests/`, `capture/` e `concierge-api-v3/` nos caminhos atuais.
- Um único `package-lock.json`, sempre gerado da raiz; nenhum lockfile em `apps/admin`.
- Pin exato e coeso `3.86.0` para todos os pacotes Payload.
- Node `>=22 <23`; não usar a instalação local fora desse intervalo para gerar lockfile.
- Não instalar GraphQL, Lexical, sharp ou storage plugins: a primeira entrega não usa rich text, uploads ou GraphQL.
- Payload conecta somente em `CMS_MONGODB_URL`/`CMS_MONGODB_DB_NAME=concierge-cms`.
- Migrations não executam no boot do web ou worker.
- O `vitest.config.js` da raiz continua restrito ao Collector; Admin usa configs próprias.
- Não criar pacotes ou módulos vazios para recursos futuros.

---

### Task 1: Fixar Node 22 e converter a raiz em npm workspace

**Files:**
- Create: `.nvmrc`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `package-lock.json` (somente via `npm install --package-lock-only`)
- Test: `tests/test_workspace_config.test.js`

**Interfaces:**
- Consumes: scripts legados `test`, `test:watch`, `test:coverage`, `lint` e `lint:fix`.
- Produces: workspaces `apps/*` e `packages/*`; comandos `test:collector`, `lint:collector`, `dev:admin`, `build:admin`, `test:admin`, `typecheck:admin`, `start:admin-worker`.

- [ ] **Step 1: Escrever o teste de configuração que falha**

Criar `tests/test_workspace_config.test.js`:

```javascript
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('workspace root', () => {
  test('preserva Collector e declara o workspace Node 22', () => {
    expect(pkg.private).toBe(true)
    expect(pkg.workspaces).toEqual(['apps/*', 'packages/*'])
    expect(pkg.engines).toMatchObject({ node: '>=22 <23', npm: '>=10 <11' })
    expect(pkg.packageManager).toBe('npm@10.9.2')
    expect(pkg.scripts['test:collector']).toBe('vitest run')
    expect(pkg.scripts['dev:admin']).toContain('--workspace=@concierge/admin')
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npx vitest run tests/test_workspace_config.test.js`

Expected: FAIL em `private`/`workspaces` porque a raiz ainda é um pacote único Node 18+.

- [ ] **Step 3: Aplicar a configuração mínima**

Em `package.json`, preservar dependências e substituir/estender somente os campos abaixo:

```json
{
  "private": true,
  "packageManager": "npm@10.9.2",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "test": "vitest run",
    "test:collector": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui",
    "lint": "eslint scripts/ tests/ eslint.config.mjs",
    "lint:collector": "eslint scripts/ tests/ eslint.config.mjs",
    "lint:fix": "eslint scripts/ tests/ eslint.config.mjs --fix",
    "dev:admin": "npm run dev --workspace=@concierge/admin",
    "build:admin": "npm run build --workspace=@concierge/admin",
    "start:admin": "npm run start --workspace=@concierge/admin",
    "start:admin-worker": "npm run start:worker --workspace=@concierge/admin",
    "test:admin": "npm run test --workspace=@concierge/admin",
    "test:admin:integration": "npm run test:integration --workspace=@concierge/admin",
    "test:e2e": "npm run test:e2e --workspace=@concierge/admin",
    "lint:admin": "npm run lint --workspace=@concierge/admin",
    "typecheck:admin": "npm run typecheck --workspace=@concierge/admin"
  },
  "engines": { "node": ">=22 <23", "npm": ">=10 <11" }
}
```

Criar `.nvmrc` com uma única linha `22`. Acrescentar ao `.gitignore`:

```gitignore
/apps/admin/playwright-report/
/apps/admin/test-results/
```

Com Node 22/npm 10.9.2 ativo, rodar `npm install --package-lock-only` na raiz.

- [ ] **Step 4: Verificar workspace e regressão do Collector**

Run:

```bash
node --version
npm --version
npx vitest run tests/test_workspace_config.test.js
npm run lint:collector
npm run test:collector
```

Expected: Node começa com `v22.`, npm com `10.9.2`, teste novo PASS e suíte Collector permanece verde.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc .gitignore package.json package-lock.json tests/test_workspace_config.test.js
git commit -m "build: preparar npm workspace em Node 22"
```

---

### Task 2: Criar o app Payload/Next mínimo e health check

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/next.config.mjs`
- Create: `apps/admin/payload.config.ts`
- Create: `apps/admin/.env.example`
- Create: `apps/admin/vitest.unit.config.ts`
- Create: `apps/admin/vitest.integration.config.ts`
- Create: `apps/admin/playwright.config.ts`
- Create: `apps/admin/eslint.config.mjs`
- Create: `apps/admin/tests/setup.ts`
- Create: `apps/admin/app/(payload)/layout.tsx`
- Create: `apps/admin/app/(payload)/admin/[[...segments]]/page.tsx`
- Create: `apps/admin/app/(payload)/admin/[[...segments]]/not-found.tsx`
- Create: `apps/admin/app/(payload)/admin/importMap.js`
- Create: `apps/admin/app/(payload)/api/[...slug]/route.ts`
- Create: `apps/admin/app/health/route.ts`
- Create: `apps/admin/src/env.ts`
- Create: `apps/admin/src/payload/generated/payload-types.ts` (via geração)
- Test: `apps/admin/tests/unit/env.test.ts`
- Modify: `package-lock.json` (via npm install na raiz)

**Interfaces:**
- Consumes: workspace `@concierge/admin`, `CMS_MONGODB_URL`, `CMS_MONGODB_DB_NAME`, `PAYLOAD_SECRET`, `CMS_PUBLIC_SERVER_URL`.
- Produces: `GET /health -> {status:'ok', service:'concierge-admin'}`; `env` validado no boot; Admin em `/admin`; API Payload em `/api/*`.

- [ ] **Step 1: Criar package/config e o teste de env que falha**

Criar `apps/admin/package.json`:

```json
{
  "name": "@concierge/admin",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "dev": "next dev",
    "build": "next build --webpack",
    "start": "next start --hostname 0.0.0.0",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run -c vitest.unit.config.ts",
    "test:integration": "vitest run -c vitest.integration.config.ts",
    "test:e2e": "playwright test",
    "generate:types": "payload generate:types",
    "generate:importmap": "payload generate:importmap"
  }
}
```

Criar `apps/admin/tests/unit/env.test.ts`:

```typescript
import { afterEach, describe, expect, test } from 'vitest'
import { readEnv } from '../../src/env'

const original = { ...process.env }
afterEach(() => { process.env = { ...original } })

describe('readEnv', () => {
  test('falha fechado sem os três segredos/configs obrigatórios', () => {
    delete process.env.CMS_MONGODB_URL
    delete process.env.PAYLOAD_SECRET
    delete process.env.CMS_PUBLIC_SERVER_URL
    expect(() => readEnv()).toThrow('CMS_MONGODB_URL')
  })

  test('fixa o banco lógico CMS', () => {
    process.env.CMS_MONGODB_URL = 'mongodb://localhost:27017'
    process.env.CMS_MONGODB_DB_NAME = 'concierge-cms-test'
    process.env.PAYLOAD_SECRET = 'x'.repeat(32)
    process.env.CMS_PUBLIC_SERVER_URL = 'http://localhost:3000'
    expect(readEnv().cmsDatabaseName).toBe('concierge-cms-test')
  })
})
```

- [ ] **Step 2: Instalar pins e confirmar a falha**

Run na raiz:

```bash
npm install --workspace=@concierge/admin --save-exact payload@3.86.0 @payloadcms/next@3.86.0 @payloadcms/db-mongodb@3.86.0 next@16.2.12 react@19.2.6 react-dom@19.2.6
npm install --workspace=@concierge/admin --save-dev --save-exact typescript@5.9.3 vitest@4.1.1 @playwright/test@1.62.1 eslint@9.39.1 eslint-config-next@16.2.12 jsdom@26.1.0 @testing-library/react@16.3.2 @testing-library/dom@10.4.1 @testing-library/jest-dom@6.9.1 @types/node@22.18.0 @types/react@19.2.18 @types/react-dom@19.2.4
npm run test:admin -- --run tests/unit/env.test.ts
```

Expected: FAIL com `Cannot find module '../../src/env'`.

- [ ] **Step 3: Implementar env, Payload e rotas Next mínimas**

Criar `apps/admin/src/env.ts`:

```typescript
export interface AdminEnv {
  cmsMongoUrl: string
  cmsDatabaseName: string
  payloadSecret: string
  publicServerUrl: string
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function readEnv(): AdminEnv {
  return {
    cmsMongoUrl: required('CMS_MONGODB_URL'),
    cmsDatabaseName: process.env.CMS_MONGODB_DB_NAME?.trim() || 'concierge-cms',
    payloadSecret: required('PAYLOAD_SECRET'),
    publicServerUrl: required('CMS_PUBLIC_SERVER_URL'),
  }
}
```

Criar `apps/admin/payload.config.ts`:

```typescript
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig } from 'payload'
import { readEnv } from './src/env'

const env = readEnv()

export default buildConfig({
  serverURL: env.publicServerUrl,
  secret: env.payloadSecret,
  db: mongooseAdapter({ url: env.cmsMongoUrl, dbName: env.cmsDatabaseName }),
  collections: [],
  typescript: { outputFile: './src/payload/generated/payload-types.ts' },
})
```

Criar `apps/admin/app/health/route.ts`:

```typescript
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export function GET() {
  return NextResponse.json({ status: 'ok', service: 'concierge-admin' })
}
```

Criar o layout Payload com o padrão oficial:

```typescript
import type { ServerFunctionClient } from 'payload'
import '@payloadcms/next/css'
import config from '@payload-config'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'
import type { ReactNode } from 'react'
import { importMap } from './admin/importMap.js'

const serverFunction: ServerFunctionClient = async (args) => {
  'use server'
  return handleServerFunctions({ ...args, config, importMap })
}
export default function Layout({ children }: { children: ReactNode }) {
  return <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>{children}</RootLayout>
}
```

Criar a página Admin e REST handler:

```typescript
// app/(payload)/admin/[[...segments]]/page.tsx
import type { Metadata } from 'next'
import config from '@payload-config'
import { generatePageMetadata, RootPage } from '@payloadcms/next/views'
import { importMap } from '../importMap'
type Args = { params: Promise<{ segments: string[] }>; searchParams: Promise<Record<string, string | string[]>> }
export const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams })
export default function Page({ params, searchParams }: Args) {
  return RootPage({ config, params, searchParams, importMap })
}

// app/(payload)/api/[...slug]/route.ts
import config from '@payload-config'
import { handleEndpoints } from 'payload'
import { formatAdminURL } from 'payload/shared'

type RouteContext = { params: Promise<{ slug?: string[] }> }
async function handle(request: Request, { params }: RouteContext): Promise<Response> {
  const awaitedConfig = await config
  const { slug } = await params
  return handleEndpoints({
    config: awaitedConfig,
    request,
    path: formatAdminURL({
      apiRoute: awaitedConfig.routes.api,
      path: slug ? `/${slug.map(encodeURIComponent).join('/')}` : undefined,
    }),
  })
}
export const GET = handle
export const POST = handle
export const DELETE = handle
export const PATCH = handle
export const PUT = handle
export const OPTIONS = handle
```

Em Payload 3.86.0, não importar `@payloadcms/next/routes`: o barrel reexporta o handler GraphQL e força o peer `graphql` durante o build. O handler acima usa apenas as APIs públicas REST de `payload` e `payload/shared`, preservando a proibição de GraphQL desta fase.

Criar o `not-found.tsx` no mesmo contrato gerado pelo Payload:

```typescript
import type { Metadata } from 'next'
import config from '@payload-config'
import { NotFoundPage, generatePageMetadata } from '@payloadcms/next/views'
import { importMap } from '../importMap.js'

type Args = {
  params: Promise<{ segments: string[] }>
  searchParams: Promise<Record<string, string | string[]>>
}
export const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams })
export default function NotFound({ params, searchParams }: Args) {
  return NotFoundPage({ config, params, searchParams, importMap })
}
```

`importMap.js` começa com `/** @type {import('payload').ImportMap} */ export const importMap = {}` e passa a ser regenerado por `npm run generate:importmap --workspace=@concierge/admin`. Configurar `next.config.mjs` explicitamente:

```javascript
import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {}
export default withPayload(nextConfig)
```

Criar `tsconfig.json` com `strict: true`, `noEmit: true`, `moduleResolution: 'bundler'`, alias `@payload-config -> ./payload.config.ts` e includes `app/**/*.ts(x)`, `src/**/*.ts(x)`, `payload.config.ts`. Rodar `generate:types` e `generate:importmap`; manter ambos os arquivos gerados versionados.

`vitest.unit.config.ts` usa jsdom, `tests/setup.ts` importa `@testing-library/jest-dom/vitest` e inclui `tests/unit/**/*.test.ts(x)`. A config integration inclui somente `tests/integration/**/*.int.test.ts`; Playwright usa `tests/e2e`, `baseURL=http://127.0.0.1:3000`, trace `retain-on-failure`; ESLint usa `eslint-config-next` para `app/src/tests`. Fixar `build` em `next build --webpack`: na combinação Next 16.2.12/Payload 3.86.0, Turbopack pode travar durante a compilação de produção; Webpack conclui e mantém a rota de produção suportada.

O `.env.example` contém apenas nomes não secretos:

```dotenv
CMS_MONGODB_URL=mongodb://127.0.0.1:27017
CMS_MONGODB_DB_NAME=concierge-cms
PAYLOAD_SECRET=replace-with-at-least-32-random-characters
CMS_PUBLIC_SERVER_URL=http://localhost:3000
```

- [ ] **Step 4: Rodar unit, tipos e build**

Run:

```bash
npm run test:admin -- --run tests/unit/env.test.ts
npm run generate:types --workspace=@concierge/admin
npm run generate:importmap --workspace=@concierge/admin
npm run typecheck:admin
npm run build:admin
npm run test:collector
```

Expected: todos PASS; build expõe `/admin`, `/api/[...slug]` e `/health`; Collector continua verde.

- [ ] **Step 5: Commit**

```bash
git add apps/admin package.json package-lock.json
git commit -m "feat(cms): criar app Payload isolado"
```

---

### Task 3: Adicionar CMS Users, shell white-label e access deny-by-default

**Files:**
- Create: `apps/admin/src/payload/collections/CmsUsers.ts`
- Create: `apps/admin/src/payload/collections/index.ts`
- Create: `apps/admin/src/auth/access.ts`
- Create: `apps/admin/src/components/shell/CmsNav.tsx`
- Create: `apps/admin/src/styles/admin.css`
- Modify: `apps/admin/payload.config.ts`
- Modify: `apps/admin/app/(payload)/layout.tsx`
- Test: `apps/admin/tests/unit/auth/access.test.ts`
- Test: `apps/admin/tests/unit/payload/navigation.test.ts`

**Interfaces:**
- Consumes: `req.user` futuro com `role`, `authorized`; Payload Admin config.
- Produces: collection slug `cms-users`/db `cms_users`; `isAuthenticated`, `isAuthorizedAdmin`; grupos Overview, Content, Distribution, Operations, Administration.

- [ ] **Step 1: Escrever os testes de access e navegação**

```typescript
import { describe, expect, test } from 'vitest'
import { isAuthorizedAdmin } from '../../../src/auth/access'
import { CMS_NAV_GROUPS } from '../../../src/components/shell/CmsNav'

describe('CMS foundation access', () => {
  test('somente admin autorizado passa', () => {
    expect(isAuthorizedAdmin({ role: 'admin', authorized: true })).toBe(true)
    expect(isAuthorizedAdmin({ role: 'curator', authorized: true })).toBe(false)
    expect(isAuthorizedAdmin({ role: 'admin', authorized: false })).toBe(false)
    expect(isAuthorizedAdmin(null)).toBe(false)
  })

  test('nav não antecipa módulos vazios', () => {
    expect(CMS_NAV_GROUPS.map((group) => group.label)).toEqual([
      'Overview', 'Content', 'Distribution', 'Operations', 'Administration',
    ])
    expect(JSON.stringify(CMS_NAV_GROUPS)).not.toContain('Entities')
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm run test:admin -- --run tests/unit/auth/access.test.ts tests/unit/payload/navigation.test.ts`

Expected: FAIL porque `access.ts` e `CmsNav.tsx` ainda não existem.

- [ ] **Step 3: Implementar access, user mirror e shell**

Criar `apps/admin/src/auth/access.ts`:

```typescript
export interface CmsAuthView { role?: string; authorized?: boolean }
export const isAuthenticated = (user: unknown): boolean => Boolean(user)
export const isAuthorizedAdmin = (user: CmsAuthView | null | undefined): boolean =>
  user?.role === 'admin' && user.authorized === true
```

Criar `CmsUsers.ts` com `auth.disableLocalStrategy=true`, `admin.useAsTitle='email'`, `dbName='cms_users'`, campos `fastapiUserId` unique/read-only, `email`, `name`, `picture`, `role`, `authorized`, `authzRevision`, `lastIntrospectedAt`; negar `create/update/delete` externos e permitir `read` somente ao próprio user autenticado. Exportar `CMS_NAV_GROUPS` exatamente como no teste; inicialmente cada grupo aponta apenas para rotas reais (`/admin`, `/admin/collections` quando existir) e exibe estado vazio acessível para grupos sem recurso.

Em `payload.config.ts`, registrar `CmsUsers`, definir `admin.user='cms-users'`, `admin.meta.titleSuffix='— Concierge'`, logo/ícone e CSS customizado. Em `admin.css`, mapear limestone/olive para variáveis Payload e manter contraste WCAG AA, `:focus-visible` de 2px e touch target mínimo de 40px.

- [ ] **Step 4: Verificar access, tipos e build**

Run:

```bash
npm run test:admin -- --run tests/unit/auth/access.test.ts tests/unit/payload/navigation.test.ts
npm run typecheck:admin
npm run build:admin
```

Expected: PASS; não existe login local por senha e nenhum módulo legado aparece na nav.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src apps/admin/payload.config.ts apps/admin/app
git commit -m "feat(cms): adicionar shell e identidade deny-by-default"
```

---

### Task 4: Configurar Payload Jobs e heartbeat do worker separado

**Files:**
- Create: `apps/admin/src/payload/collections/WorkerHeartbeats.ts`
- Create: `apps/admin/src/jobs/recordWorkerHeartbeat.ts`
- Create: `apps/admin/app/health/worker/route.ts`
- Modify: `apps/admin/src/payload/collections/index.ts`
- Modify: `apps/admin/payload.config.ts`
- Modify: `apps/admin/package.json`
- Test: `apps/admin/tests/integration/worker/heartbeat.int.test.ts`

**Interfaces:**
- Consumes: Payload Local API `payload.jobs.queue()`/`payload.jobs.runByID()` e banco CMS de teste.
- Produces: task slug `record-worker-heartbeat`, queue `maintenance`, collection oculta `worker-heartbeats`, `GET /health/worker`; comando `npm run start:worker --workspace=@concierge/admin`.

- [ ] **Step 1: Escrever o teste de job persistido**

```typescript
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '../../../payload.config'

let payload: Payload
beforeAll(async () => { payload = await getPayload({ config }) })
afterAll(async () => { await payload.destroy() })

describe('worker heartbeat', () => {
  test('job executado grava heartbeat consultável', async () => {
    const job = await payload.jobs.queue({
      task: 'record-worker-heartbeat',
      queue: 'maintenance',
      input: { workerId: 'integration-worker' },
    })
    await payload.jobs.runByID({ id: job.id })
    const rows = await payload.find({
      collection: 'worker-heartbeats',
      where: { workerId: { equals: 'integration-worker' } },
      limit: 1,
    })
    expect(rows.docs[0]?.observedAt).toBeTruthy()
  })
})
```

O teste de integração deve validar a configuração antes de importar `payload.config`: exige `CMS_MONGODB_URL` e `CMS_MONGODB_DB_NAME` terminado em `-test`, mais `PAYLOAD_SECRET` e `CMS_PUBLIC_SERVER_URL` efêmeros. Sem essa configuração, deve falhar com mensagem explícita; `CMS_SKIP_MONGO_INTEGRATION=1` é o único skip permitido, para ambientes que deliberadamente não forneçam Mongo. Nunca conectar a um banco sem o sufixo `-test`.

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/heartbeat.int.test.ts`

Expected: FAIL porque o script/config/task `record-worker-heartbeat` não existe.

- [ ] **Step 3: Implementar collection, task e processo oficial**

Criar `recordWorkerHeartbeat.ts`:

```typescript
import type { TaskConfig } from 'payload'

export const recordWorkerHeartbeat: TaskConfig<'record-worker-heartbeat'> = {
  slug: 'record-worker-heartbeat',
  inputSchema: [{ name: 'workerId', type: 'text', required: true }],
  outputSchema: [{ name: 'observedAt', type: 'date', required: true }],
  schedule: [{ cron: '* * * * *', queue: 'maintenance' }],
  handler: async ({ input, req }) => {
    const observedAt = new Date().toISOString()
    await req.payload.create({
      collection: 'worker-heartbeats',
      data: { workerId: input.workerId, observedAt },
      overrideAccess: true,
    })
    return { output: { observedAt } }
  },
}
```

`WorkerHeartbeats` é oculta, deny-all no REST, com unique em `workerId` somente se a task fizer upsert; caso mantenha histórico, indexar `(workerId, observedAt desc)` e TTL de 7 dias via migration da fase 07. Registrar `jobs.tasks=[recordWorkerHeartbeat]`, `processingOrder='createdAt'` e negar execução do endpoint de jobs a browsers.

Adicionar scripts:

```json
{
  "test:integration": "vitest run -c vitest.integration.config.ts",
  "start:worker": "payload jobs:run --cron \"* * * * *\" --all-queues --handle-schedules"
}
```

`GET /health/worker` consulta o último heartbeat; retorna 200 quando tem menos de 180 segundos e 503 caso contrário, sem iniciar jobs no processo web.

- [ ] **Step 4: Rodar integração e regressão completa da fase**

Run:

```bash
npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/heartbeat.int.test.ts
npm run test:admin
npm run typecheck:admin
npm run build:admin
npm run test:collector
```

Expected: todos PASS; o teste usa `concierge-cms-test`; nenhum job conecta no banco operacional.

- [ ] **Step 5: Commit**

```bash
git add apps/admin package.json package-lock.json
git commit -m "feat(cms): configurar worker Payload separado"
```

## Gate da fase

```bash
npm ci
npm run lint:collector
npm run test:collector
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run typecheck:admin
npm run build:admin
```

Expected: todos os comandos terminam com exit 0; `npm ls payload @payloadcms/next @payloadcms/db-mongodb` mostra `3.86.0`; não existe lockfile fora da raiz.
