# Identidade CMS e Contratos FastAPI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autenticar admins no Payload por handoff one-shot do FastAPI e estabelecer contratos gerados, versionados e testados entre os serviços.

**Architecture:** FastAPI continua autoridade de Users/roles, emite código opaco de uso único e oferece introspecção server-to-server. Payload guarda somente espelho mínimo e uma sessão host-only própria; sua custom auth strategy resolve a sessão e revalida o user no FastAPI em toda request.

**Tech Stack:** FastAPI/Pydantic/PyMongo, Payload custom auth strategy, Next Route Handlers, Web Crypto/Node crypto, Vitest, pytest, OpenAPI 3.1, openapi-typescript 7.13.0.

**Spec:** `docs/superpowers/specs/2026-08-18-collections-payload-cms-design.md`

## Global Constraints

- Não mudar os cookies FastAPI atuais para `Domain=.concierge-collector.com`.
- Nenhum JWT ou refresh token aparece em query/fragment do Admin ou em seu localStorage.
- Payload não recebe `JWT_SIGNING_SECRET`; `CMS_SERVICE_KEY` é uma credencial distinta e rotacionável.
- Callback FastAPI é exato, configurado por ambiente; `return_to` aceita somente path interno iniciado por `/admin`.
- Código de handoff é aleatório (32 bytes), hash-only, audience `cms`, uso único e TTL de 120 segundos.
- Cookies `cms_login_state` e `cms_session` são host-only, `Secure` em produção, `HttpOnly`, `SameSite=Lax`, `Path=/`.
- Toda request Admin e cada checkpoint mutável introspecta o estado atual; sem cache de role na v1.
- O contrato versionado é gerado do FastAPI e o client TS é regenerado deterministicamente; tipos Payload não atravessam a fronteira.
- O service key nunca autoriza consumer distribution nem substitui role do usuário.

---

### Task 1: Persistir e consumir códigos one-shot no FastAPI

**Files:**
- Create: `concierge-api-v3/app/models/cms_auth.py`
- Create: `concierge-api-v3/app/services/cms_auth_service.py`
- Modify: `concierge-api-v3/app/core/config.py`
- Modify: `concierge-api-v3/app/core/index_specs.py`
- Modify: `concierge-api-v3/.env.example`
- Test: `concierge-api-v3/tests/test_cms_auth_service.py`

**Interfaces:**
- Consumes: `users` operacional, `UserRole`, `settings.cms_admin_callback_url`, `settings.cms_service_key`.
- Produces: `load_cms_authorization(db: Database, subject: str) -> CmsAuthorization`; `issue_handoff_code(db: Database, *, subject: str, state: str, target_origin: str, now: datetime) -> str`; `consume_handoff_code(db: Database, *, code: str, state: str, target_origin: str, now: datetime | None = None) -> CmsAuthorization`; TTL index `cms_auth_codes.expires_at`.

- [ ] **Step 1: Escrever os testes de uso único e downgrade**

```python
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException

from app.services.cms_auth_service import consume_handoff_code, issue_handoff_code


def _db(role="admin", authorized=True):
    db = MagicMock()
    db.users.find_one.return_value = {
        "_id": "user-1", "email": "admin@example.com", "name": "Admin",
        "picture": None, "role": role, "authorized": authorized,
    }
    return db


def test_handoff_code_is_hash_only_and_one_time():
    db = _db()
    raw = issue_handoff_code(
        db, subject="admin@example.com", state="state-1",
        target_origin="https://admin.concierge-collector.com",
        now=datetime.now(timezone.utc),
    )
    inserted = db.cms_auth_codes.insert_one.call_args[0][0]
    assert raw not in repr(inserted)
    assert inserted["audience"] == "cms"
    assert inserted["expires_at"] > inserted["created_at"]


def test_exchange_rejects_role_downgrade_before_consumption():
    db = _db(role="curator")
    db.cms_auth_codes.find_one_and_update.return_value = {
        "subject": "admin@example.com", "state": "state-1",
        "target_origin": "https://admin.concierge-collector.com",
        "expires_at": datetime.now(timezone.utc) + timedelta(seconds=30),
    }
    with pytest.raises(HTTPException) as error:
        consume_handoff_code(db, code="raw", state="state-1",
                             target_origin="https://admin.concierge-collector.com")
    assert error.value.status_code == 403
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd concierge-api-v3 && venv/bin/pytest tests/test_cms_auth_service.py -v`

Expected: FAIL com `ModuleNotFoundError: app.services.cms_auth_service`.

- [ ] **Step 3: Implementar modelos e operação atômica**

Em `app/models/cms_auth.py`:

```python
from typing import Literal
from pydantic import BaseModel, EmailStr

class CmsAuthorization(BaseModel):
    user_id: str
    email: EmailStr
    name: str
    picture: str | None = None
    role: Literal["viewer", "curator", "admin"]
    authorized: bool
    authz_revision: str

class CmsExchangeRequest(BaseModel):
    code: str
    state: str
    target_origin: str

class CmsIntrospectionRequest(BaseModel):
    subject: str
```

Em `cms_auth_service.py`, usar `secrets.token_urlsafe(32)`, `hashlib.sha256`, `secrets.compare_digest` e `ReturnDocument.AFTER`. O filtro de consumo deve conter simultaneamente `code_hash`, `audience='cms'`, `state`, `target_origin`, `consumed_at=None` e `expires_at > now`; o update define `consumed_at`. Após o CAS, reler `users` e exigir `authorized is True` e `role == 'admin'`. Calcular `authz_revision` como SHA-256 de `user_id|role|authorized`, sem incluir segredo.

Adicionar ao `INDEX_SPECS`:

```python
("cms_auth_codes", [("code_hash", 1)], {"unique": True, "name": "cms_code_hash_unique"}),
("cms_auth_codes", [("expires_at", 1)], {"expireAfterSeconds": 0, "name": "cms_code_expiry_ttl"}),
```

Adicionar settings `cms_admin_origin`, `cms_admin_callback_url`, `cms_service_key`, `cms_handoff_ttl_seconds=120`; em produção, propriedades de acesso lançam `RuntimeError` quando vazias.

- [ ] **Step 4: Rodar testes do serviço e índices**

Run:

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_cms_auth_service.py tests/test_database_indexes.py -v
```

Expected: PASS; replay faz `find_one_and_update` retornar `None` e produz 401; downgrade produz 403.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app concierge-api-v3/tests/test_cms_auth_service.py concierge-api-v3/.env.example
git commit -m "feat(auth): persistir handoff CMS one-shot"
```

---

### Task 2: Expor authorize, exchange e introspection no FastAPI

**Files:**
- Create: `concierge-api-v3/app/api/cms_auth.py`
- Modify: `concierge-api-v3/main.py`
- Modify: `concierge-api-v3/app/core/security.py`
- Test: `concierge-api-v3/tests/test_cms_auth_api.py`
- Test: `concierge-api-v3/tests/test_cors_config.py`
- Modify: `concierge-api-v3/tests/conftest.py`

**Interfaces:**
- Consumes: Task 1, `verify_auth`, `X-CMS-Service-Key`.
- Produces: `GET /api/v3/auth/cms/authorize?state=...`; `POST /api/v3/auth/cms/exchange`; `POST /api/v3/auth/cms/introspect`; dependency `verify_cms_service(request) -> None`.

- [ ] **Step 1: Escrever testes HTTP negativos e felizes**

```python
@pytest.fixture
def admin_auth_headers(test_db):
    test_db.users.delete_many({"email": "cms-admin-test@example.com"})
    test_db.users.insert_one({
        "_id": "cms-admin-test", "google_id": "cms-admin-test",
        "email": "cms-admin-test@example.com", "name": "CMS Admin",
        "authorized": True, "role": "admin",
    })
    token = create_access_token({"sub": "cms-admin-test@example.com", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def curator_auth_headers(test_db):
    test_db.users.delete_many({"email": "cms-curator-test@example.com"})
    test_db.users.insert_one({
        "_id": "cms-curator-test", "google_id": "cms-curator-test",
        "email": "cms-curator-test@example.com", "name": "CMS Curator",
        "authorized": True, "role": "curator",
    })
    token = create_access_token({"sub": "cms-curator-test@example.com", "role": "curator"})
    return {"Authorization": f"Bearer {token}"}

def test_cms_authorize_redirects_only_to_fixed_callback(client, admin_auth_headers, monkeypatch):
    monkeypatch.setattr("app.api.cms_auth.issue_handoff_code", lambda **_: "one-shot")
    response = client.get(
        "/api/v3/auth/cms/authorize?state=opaque-state",
        headers=admin_auth_headers,
        follow_redirects=False,
    )
    assert response.status_code == 307
    assert response.headers["location"].startswith(
        "https://admin.concierge-collector.com/auth/callback?"
    )
    assert "state=opaque-state" in response.headers["location"]


def test_cms_exchange_requires_distinct_service_key(client):
    response = client.post("/api/v3/auth/cms/exchange", json={
        "code": "x", "state": "s",
        "target_origin": "https://admin.concierge-collector.com",
    })
    assert response.status_code == 401


def test_cms_authorize_rejects_curator(client, curator_auth_headers):
    response = client.get(
        "/api/v3/auth/cms/authorize?state=s", headers=curator_auth_headers,
        follow_redirects=False,
    )
    assert response.status_code == 403
```

Antes de importar `main`/`settings`, `tests/conftest.py` também fixa `CMS_SERVICE_KEY=test-cms-key`, `CMS_ADMIN_ORIGIN=https://admin.concierge-collector.com` e o callback exato de teste. Os fixtures acima removem seus users no teardown e nunca dependem de uma credencial produtiva.

- [ ] **Step 2: Rodar e confirmar 404/falhas**

Run: `cd concierge-api-v3 && venv/bin/pytest tests/test_cms_auth_api.py -v`

Expected: FAIL/404 porque o router ainda não está registrado.

- [ ] **Step 3: Implementar router e service-key dependency**

Criar router `APIRouter(prefix='/auth/cms', tags=['cms-auth'])`. `authorize` usa `Depends(verify_auth)`, aceita somente `method in {'jwt','cookie'}` com subject presente (API key administrativa não cria sessão humana), recarrega o user com `load_cms_authorization`, emite código e constrói a URL somente a partir de `settings.cms_admin_callback_url`. `exchange` e `introspect` usam:

```python
def verify_cms_service(x_cms_service_key: str | None = Header(None)) -> None:
    expected = settings.cms_service_key_value
    if not x_cms_service_key or not secrets.compare_digest(x_cms_service_key, expected):
        raise HTTPException(status_code=401, detail="Invalid CMS service credential")
```

`introspect` recebe `CmsIntrospectionRequest`, relê o user e devolve `CmsAuthorization`; nunca aceita role/email enviados pelo CMS como autoridade. Registrar `cms_auth.router` antes de `auth.router` em `main.py`. Incluir a origem Admin explicitamente em `CORS_ORIGINS`; nenhum wildcard.

- [ ] **Step 4: Rodar auth/CORS/unit completo**

Run:

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_cms_auth_api.py tests/test_auth.py tests/test_verify_auth.py tests/test_cors_config.py -v
venv/bin/pytest -m "not integration and not external_api and not mongo and not openai" -q
```

Expected: todos PASS; callback arbitrário nunca é refletido; service key não aparece em responses/logs.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app concierge-api-v3/main.py concierge-api-v3/tests
git commit -m "feat(api): expor handoff e introspeccao CMS"
```

---

### Task 3: Criar sessão host-only e custom auth strategy no Payload

**Files:**
- Create: `apps/admin/src/payload/collections/CmsLoginStates.ts`
- Create: `apps/admin/src/payload/collections/CmsSessions.ts`
- Create: `apps/admin/src/auth/fastapi-authz-client.ts`
- Create: `apps/admin/src/auth/cms-session.ts`
- Create: `apps/admin/src/auth/cms-strategy.ts`
- Create: `apps/admin/src/auth/require-current-admin.ts`
- Create: `apps/admin/src/components/auth/CmsLoginView.tsx`
- Create: `apps/admin/app/auth/start/route.ts`
- Create: `apps/admin/app/auth/callback/route.ts`
- Create: `apps/admin/app/auth/logout/route.ts`
- Modify: `apps/admin/src/payload/collections/CmsUsers.ts`
- Modify: `apps/admin/src/payload/collections/index.ts`
- Modify: `apps/admin/src/env.ts`
- Modify: `apps/admin/payload.config.ts`
- Create: `apps/admin/src/migrations/20260818_000_auth.ts`
- Test: `apps/admin/tests/unit/auth/session.test.ts`
- Test: `apps/admin/tests/integration/auth/handoff.int.test.ts`

**Interfaces:**
- Consumes: FastAPI routes da Task 2; cookie `cms_login_state`; collection `cms-users`.
- Produces: cookie `cms_session`; `FastApiAuthzClient.exchangeCmsCode()`; `introspectSubject()`; `cmsSessionStrategy`; `requireCurrentAdmin(headers) -> Promise<CmsIdentity>`.

- [ ] **Step 1: Escrever testes de cookie/state/replay**

```typescript
import { describe, expect, test, vi } from 'vitest'
import { consumeLoginState, createSessionToken } from '../../../src/auth/cms-session'

describe('CMS session', () => {
  test('state só é consumido quando cookie e hash persistido coincidem', async () => {
    const repo = {
      consumeStateHash: vi.fn().mockResolvedValue({ returnTo: '/admin/collections' }),
    }
    await expect(consumeLoginState(repo, 'raw-state', 'raw-state')).resolves.toEqual({
      returnTo: '/admin/collections',
    })
    expect(repo.consumeStateHash).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/))
  })

  test('cookie trocado é rejeitado antes do exchange', async () => {
    await expect(consumeLoginState({ consumeStateHash: vi.fn() }, 'a', 'b'))
      .rejects.toThrow('Invalid login state')
  })

  test('session persiste apenas hash', () => {
    const value = createSessionToken()
    expect(value.raw).not.toBe(value.hash)
    expect(value.hash).toMatch(/^[a-f0-9]{64}$/)
  })
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm run test:admin -- --run tests/unit/auth/session.test.ts`

Expected: FAIL com módulo de sessão ausente.

- [ ] **Step 3: Implementar handoff e strategy**

`/auth/start` valida `return_to` por `/^\/admin(?:\/|$)/`, gera 32 bytes, grava somente SHA-256 com expiração de 10 minutos em `cms-login-states`, seta cookie transient e redireciona para `FASTAPI_BASE_URL/api/v3/auth/cms/authorize?state=...`.

`/auth/callback` exige query `code/state`, cookie igual em constant time e CAS do state persistido; chama:

```typescript
export class FastApiAuthzClient {
  constructor(private readonly baseUrl: string, private readonly serviceKey: string) {}

  async exchangeCmsCode(input: { code: string; state: string; targetOrigin: string }): Promise<CmsIdentity> {
    return this.post<CmsIdentity>('/api/v3/auth/cms/exchange', input)
  }

  async introspectSubject(subject: string): Promise<CmsIdentity> {
    return this.post<CmsIdentity>('/api/v3/auth/cms/introspect', { subject })
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-CMS-Service-Key': this.serviceKey },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`FastAPI authz failed: ${response.status}`)
    return response.json() as Promise<T>
  }
}
```

Upsert `cms-users`, gerar session raw/hash, persistir `cms-sessions` com `user`, `subject`, expiração de 8 horas, setar cookie host-only e apagar `cms_login_state`. A custom strategy segue a interface oficial:

```typescript
export const cmsSessionStrategy = {
  name: 'cms-session',
  authenticate: async ({ payload, headers }) => {
    const session = await resolveCmsSession(payload, headers.get('cookie') || '')
    if (!session) return { user: null }
    const identity = await authzClient().introspectSubject(session.subject)
    if (!identity.authorized || identity.role !== 'admin') {
      await revokeCmsSession(payload, session.id)
      return { user: null }
    }
    const user = await mirrorCmsUser(payload, identity)
    return { user: { collection: 'cms-users', ...user } }
  },
}
```

Registrar em `CmsUsers.auth.strategies`, mantendo `disableLocalStrategy: true`. `requireCurrentAdmin` chama a mesma resolução/introspecção e lança 401/403; não confia no espelho.

`CmsLoginView.tsx` substitui a view de login Payload por título Concierge, explicação curta e link server-controlled `/auth/start?return_to=/admin`; nenhum campo de email/senha. Registrar a view em `admin.components.views.login.Component`. A migration cria unique em `stateHash`/`sessionHash` e TTL absoluto nos respectivos `expiresAt`; `CmsSessions` nunca expõe token raw.

- [ ] **Step 4: Verificar fluxo completo e casos negativos**

Run:

```bash
npm run test:admin -- --run tests/unit/auth/session.test.ts
npm run test:integration --workspace=@concierge/admin -- tests/integration/auth/handoff.int.test.ts
npm run typecheck:admin
npm run build:admin
```

Expected: PASS para sucesso; testes cobrem replay, state ausente/trocado, expiry, callback/return path adulterado e role downgrade entre emissão/troca.

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat(cms): autenticar Admin por handoff FastAPI"
```

---

### Task 4: Versionar OpenAPI e gerar o client TypeScript

**Files:**
- Create: `contracts/openapi/fastapi-admin-internal.v1.json`
- Create: `concierge-api-v3/scripts/export_admin_openapi.py`
- Create: `concierge-api-v3/tests/test_admin_openapi_contract.py`
- Create: `packages/fastapi-client/package.json`
- Create: `packages/fastapi-client/scripts/generate.mjs`
- Create: `packages/fastapi-client/src/generated.ts`
- Create: `packages/fastapi-client/src/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `packages/fastapi-client/tests/contract.test.ts`

**Interfaces:**
- Consumes: FastAPI `app.openapi()` e somente paths `/auth/cms/*`, `/catalog/*`, `/internal/curations/hydrate`, `/curations/{curation_id}/collections`.
- Produces: package `@concierge/fastapi-client`; `FastApiAdminClient`; comando root `generate:contracts`; snapshot OpenAPI canônico.

- [ ] **Step 1: Escrever o teste que exige paths e schemas**

```python
import json
from pathlib import Path

CONTRACT = Path(__file__).parents[2] / "contracts/openapi/fastapi-admin-internal.v1.json"

def test_admin_contract_contains_auth_boundary():
    doc = json.loads(CONTRACT.read_text())
    assert "/api/v3/auth/cms/exchange" in doc["paths"]
    assert "/api/v3/auth/cms/introspect" in doc["paths"]
    assert "CmsAuthorization" in doc["components"]["schemas"]
    assert not any("distribution" in path for path in doc["paths"])
```

- [ ] **Step 2: Rodar e confirmar arquivo ausente**

Run: `cd concierge-api-v3 && venv/bin/pytest tests/test_admin_openapi_contract.py -v`

Expected: FAIL com `FileNotFoundError`.

- [ ] **Step 3: Implementar export determinístico e package gerado**

`export_admin_openapi.py` importa `main.app.openapi()`, filtra allowlist de prefixes exata, mantém apenas schemas alcançáveis, ordena chaves e grava JSON com indent 2 + newline. O script aceita `--check`: gera em memória e retorna exit 1 se divergir do arquivo versionado.

Criar package:

```json
{
  "name": "@concierge/fastapi-client",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": {
    "generate": "node scripts/generate.mjs",
    "check": "node scripts/generate.mjs --check",
    "test": "vitest run"
  },
  "devDependencies": { "openapi-typescript": "7.13.0", "vitest": "4.1.1" }
}
```

`generate.mjs` chama `openapi-typescript` sobre o snapshot e grava `src/generated.ts`; `--check` compara bytes. `src/index.ts` exporta `paths`, `components` e um `FastApiAdminClient` que injeta base URL/service key e usa os DTOs gerados, sem `any`.

Na raiz:

```json
{
  "scripts": {
    "generate:contracts": "cd concierge-api-v3 && venv/bin/python scripts/export_admin_openapi.py && cd .. && npm run generate --workspace=@concierge/fastapi-client",
    "check:contracts": "cd concierge-api-v3 && venv/bin/python scripts/export_admin_openapi.py --check && cd .. && npm run check --workspace=@concierge/fastapi-client"
  }
}
```

- [ ] **Step 4: Gerar duas vezes e verificar diff zero**

Run:

```bash
npm install
npm run generate:contracts
npm run check:contracts
git diff --exit-code contracts/openapi packages/fastapi-client/src/generated.ts
cd concierge-api-v3 && venv/bin/pytest tests/test_admin_openapi_contract.py -v
```

Expected: geração determinística; pytest PASS; segundo run não altera bytes.

- [ ] **Step 5: Commit**

```bash
git add contracts packages/fastapi-client concierge-api-v3/scripts concierge-api-v3/tests package.json package-lock.json
git commit -m "build(contracts): gerar client FastAPI versionado"
```

---

### Task 5: Aplicar revalidação a toda superfície administrativa

**Files:**
- Create: `apps/admin/src/http/with-admin.ts`
- Create: `apps/admin/src/http/errors.ts`
- Modify: `apps/admin/payload.config.ts`
- Modify: `apps/admin/src/auth/access.ts`
- Test: `apps/admin/tests/unit/http/with-admin.test.ts`
- Test: `apps/admin/tests/e2e/auth-handoff/access.spec.ts`

**Interfaces:**
- Consumes: `requireCurrentAdmin(headers)` e `ActorAuthorization`.
- Produces: `withAdmin(handler)` para todo endpoint `/api/admin/v1`; mapping único 401/403/409/412/423/503; `request.actor` autoritativo.

- [ ] **Step 1: Escrever o teste de downgrade por request**

```typescript
import { describe, expect, test, vi } from 'vitest'
import { withAdmin } from '../../../src/http/with-admin'

test('não chama handler quando introspection revoga admin', async () => {
  const handler = vi.fn()
  const guarded = withAdmin(handler, {
    requireCurrentAdmin: vi.fn().mockRejectedValue({ status: 403, code: 'authorization_revoked' }),
  })
  const response = await guarded(new Request('https://admin.test/api/admin/v1/collections'))
  expect(response.status).toBe(403)
  expect(handler).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm run test:admin -- --run tests/unit/http/with-admin.test.ts`

Expected: FAIL porque `withAdmin` não existe.

- [ ] **Step 3: Implementar wrapper e access comum**

```typescript
export function withAdmin(
  handler: (request: Request, actor: CmsIdentity) => Promise<Response>,
  deps = { requireCurrentAdmin },
) {
  return async (request: Request): Promise<Response> => {
    try {
      const actor = await deps.requireCurrentAdmin(request.headers)
      return await handler(request, actor)
    } catch (error) {
      return adminErrorResponse(error)
    }
  }
}
```

Todas as access functions Payload chamam `req.user` somente para esconder/mostrar UI; operações sensíveis usam `withAdmin` e revalidação server-side. Configurar `csrf`/`cors` exclusivamente para o próprio Admin e origins Collector aprovadas; mutações futuras do Collector usam Bearer introspectado, não cookie CMS.

- [ ] **Step 4: Rodar unit, E2E auth e gates de contrato**

Run:

```bash
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run test:e2e --workspace=@concierge/admin -- tests/e2e/auth-handoff/access.spec.ts
npm run check:contracts
cd concierge-api-v3 && venv/bin/pytest tests/test_cms_auth_api.py tests/test_cms_auth_service.py -v
```

Expected: todos PASS; DevTools E2E não encontra JWT em URL/localStorage; cookies não têm atributo `Domain`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin contracts packages/fastapi-client
git commit -m "feat(cms): revalidar admin em toda request"
```

## Gate da fase

```bash
npm run check:contracts
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run typecheck:admin
npm run build:admin
cd concierge-api-v3
venv/bin/pytest tests/test_cms_auth_service.py tests/test_cms_auth_api.py tests/test_admin_openapi_contract.py -v
venv/bin/pytest -m "not integration and not external_api and not mongo and not openai" -q
```

Expected: exit 0 em todos; replay/state adulterado/expiry/downgrade são rejeitados e client gerado está limpo no `git diff`.
