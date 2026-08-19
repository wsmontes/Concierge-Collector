# Aplicações Consumidoras e Distribuição — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribuir Collections publicadas por credenciais individuais, paginação assinada e dumps completos, mantendo Curation/Entity live e dados privados fora do contrato.

**Architecture:** Payload administra applications/credentials hash-only no CMS. FastAPI lê essa projeção com credencial Mongo read-only em toda request, resolve membership versionado e hidrata o banco operacional em batches; cursor/dump usam o mesmo DTO allowlisted e archive funciona como kill switch.

**Tech Stack:** Payload, Node crypto, FastAPI/Pydantic/PyMongo, MongoDB, StreamingResponse, zlib gzip, Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-18-collections-payload-cms-design.md`

## Global Constraints

- Consumer key tem 256 bits aleatórios, prefixo identificável e SHA-256 hash; segredo completo é show-once.
- FastAPI não faz cache de credential/allowlist na v1; revogação vale na request seguinte.
- `get_cms_database()` expõe somente leitura (`find_one`, `find`, `aggregate`) e a credencial `CMS_MONGODB_READ_URL` recebe apenas `find` no CMS; FastAPI nunca escreve ou atualiza `lastUsedAt` no CMS.
- `401` credential inválida/revogada/expirada; `404` slug inexistente ou fora do escopo; `410` Collection autorizada archived; `409` cursor inválido/expirado; `429` quota.
- Allowlists são por Collection e abrangem histórico enquanto ativa.
- Exata versão congela membership, nunca conteúdo de Curation/Entity.
- Somente Curation `active` + Entity `active` + DTO válido é distribuída.
- Falha transitória aborta página/stream; não incrementa unavailable.
- Toda response usa `Cache-Control: private, no-store`; sem ETag na v1.
- DTO nunca inclui private notes, transcript, sources/provenance, curator, sync, prompts/IA, embeddings ou credentials.
- Dump canônico é NDJSON streaming com manifest inicial, items e footer count/SHA; sem footer é incompleto.
- Uso de credential é agregado somente no banco operacional; um job Payload sincroniza o máximo `lastUsedAt` por credential de volta ao CMS.

---

### Task 1: Administrar applications e credentials show-once no Payload

**Files:**
- Create: `apps/admin/src/payload/collections/ConsumerApplications.ts`
- Create: `apps/admin/src/payload/collections/ConsumerCredentials.ts`
- Create: `apps/admin/src/applications/types.ts`
- Create: `apps/admin/src/applications/credentials.ts`
- Create: `apps/admin/src/applications/service.ts`
- Create: `apps/admin/src/jobs/syncConsumerUsage.ts`
- Create: `apps/admin/src/payload/endpoints/applications.ts`
- Create: `apps/admin/src/payload/endpoints/credentials.ts`
- Create: `apps/admin/src/migrations/20260818_003_consumers.ts`
- Modify: `apps/admin/src/payload/collections/index.ts`
- Modify: `apps/admin/payload.config.ts`
- Test: `apps/admin/tests/unit/applications/credentials.test.ts`
- Test: `apps/admin/tests/integration/payload/credentials.int.test.ts`
- Test: `apps/admin/tests/unit/jobs/syncConsumerUsage.test.ts`
- Create: `apps/admin/tests/support/consumerCredentials.ts`

**Interfaces:**
- Produces: `issueCredential`, `rotateCredential`, `revokeCredential`; `IssueCredentialResult {credential, secretOnce}`; applications/credentials endpoints.
- Routes: `GET|POST /api/admin/v1/applications`; `PATCH /api/admin/v1/applications/:id`; `POST /api/admin/v1/applications/:id/credentials`; `POST /api/admin/v1/credentials/:id/rotate`; `POST /api/admin/v1/credentials/:id/revoke`.

`apps/admin/tests/support/consumerCredentials.ts` exports `fakeCredentialRepository(seed?: Partial<Credential>) -> FakeCredentialRepository`, `fixedRandom(size: number) -> (n: number) => Buffer`, and `actor: AdminActor`; the credential tests construct `const repo = fakeCredentialRepository()` before every revoke assertion. This prevents helpers in the test sketch from becoming undeclared globals.

- [ ] **Step 1: Escrever teste de segredo hash-only e revogação**

```typescript
test('issue retorna segredo uma vez e repository recebe apenas hash', async () => {
  const repo = fakeCredentialRepository()
  const result = await issueCredential({
    applicationId: 'app-1', name: 'production', scopes: ['collections:read'], expiresAt: null,
  }, repo, fixedRandom(32))
  expect(result.secretOnce).toMatch(/^cck_[a-z0-9]{12}_[A-Za-z0-9_-]+$/)
  expect(repo.created.secretHash).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(repo.created)).not.toContain(result.secretOnce)
})

test('revoke é idempotente e incrementa credentialsRevision', async () => {
  const repo = fakeCredentialRepository({ id: 'cred-1', applicationId: 'app-1', status: 'active' })
  const revisionBefore = await repo.applicationRevision('app-1')
  const first = await revokeCredential('cred-1', actor, repo)
  const revisionAfterFirst = await repo.applicationRevision('app-1')
  const retry = await revokeCredential('cred-1', actor, repo)
  const revisionAfterRetry = await repo.applicationRevision('app-1')
  expect(retry.revokedAt).toBe(first.revokedAt)
  expect(revisionAfterFirst).toBe(revisionBefore + 1)
  expect(revisionAfterRetry).toBe(revisionAfterFirst)
  expect(await repo.countAuditEvents('credential.revoked', 'cred-1')).toBe(1)
})
```

- [ ] **Step 2: Rodar e confirmar módulos ausentes**

Run: `npm run test:admin -- --run tests/unit/applications/credentials.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar models e endpoints**

Application: `name`, `owner`, `status active|suspended`, `allowedCollectionIds`, `defaultRequestsPerMinute`, `credentialsRevision`, audit fields. Credential separada: `applicationId`, `name`, `prefix`, `secretHash`, `scopes`, `status`, `createdAt/By`, `expiresAt`, `revokedAt/By`, `lastUsedAt`; nunca campo de segredo raw.

```typescript
export function createOpaqueCredential(randomBytes = crypto.randomBytes): GeneratedCredential {
  const secret = randomBytes(32).toString('base64url')
  const prefix = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 12)
  const raw = `cck_${prefix}_${secret}`
  return { raw, prefix, hash: crypto.createHash('sha256').update(raw).digest('hex') }
}
```

Endpoints admin revalidam role e auditam: create/list/update application, issue, rotate com janela explícita `overlapUntil`, revoke. O JSON de issue/rotate contém `secret_once` somente naquela response e `Cache-Control:no-store`. Migration cria unique `(applicationId,prefix)` e índices hash/status/expiry/allowlist.

`syncConsumerUsage.ts` é job agendado do Payload, registrado em `payload.config.ts` para rodar a cada cinco minutos. Ele lê o checkpoint CMS `consumer_usage_sync_state`, chama `GET {FASTAPI_BASE_URL}/api/v3/internal/consumer-usage?after=<cursor>&limit=500` com `X-CMS-Service-Key: ${CMS_SERVICE_KEY}`, aplica `$max: {lastUsedAt}` por credential e só então avança o checkpoint. Retry da mesma página é seguro por `$max`; 401 ou erro de rede não avança checkpoint nem revoga credencial.

- [ ] **Step 4: Rodar unit/integration e inspeção de DB**

Run:

```bash
CMS_MONGODB_DB_NAME=concierge-cms-test npm run migrate:cms --workspace=@concierge/admin
npm run test:admin -- --run tests/unit/applications
npm run test:integration --workspace=@concierge/admin -- tests/integration/payload/credentials.int.test.ts
npm run test:admin -- --run tests/unit/jobs/syncConsumerUsage.test.ts
```

Expected: PASS; busca textual no banco de teste não encontra `secretOnce`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat(distribution): administrar consumer credentials"
```

---

### Task 2: Conectar FastAPI ao CMS read-only e autenticar consumer

**Files:**
- Create: `concierge-api-v3/app/core/cms_database.py`
- Create: `concierge-api-v3/app/services/cms_projection_service.py`
- Create: `concierge-api-v3/app/services/consumer_auth_service.py`
- Create: `concierge-api-v3/app/services/consumer_rate_limit.py`
- Create: `concierge-api-v3/app/services/consumer_usage_service.py`
- Create: `concierge-api-v3/app/api/internal_consumer_usage.py`
- Modify: `concierge-api-v3/app/core/config.py`
- Modify: `concierge-api-v3/app/core/lifespan.py`
- Modify: `concierge-api-v3/app/core/index_specs.py`
- Modify: `concierge-api-v3/main.py`
- Modify: `concierge-api-v3/.env.example`
- Test: `concierge-api-v3/tests/test_cms_database.py`
- Test: `concierge-api-v3/tests/test_consumer_auth.py`
- Test: `concierge-api-v3/tests/test_consumer_rate_limit.py`
- Test: `concierge-api-v3/tests/test_consumer_usage.py`
- Create: `concierge-api-v3/tests/fixtures/cms_projection.py`
- Create: `concierge-api-v3/tests/fixtures/distribution.py`
- Modify: `concierge-api-v3/tests/conftest.py`

**Interfaces:**
- Produces: `get_cms_database`; `authenticate_consumer(cms_db,bearer)->ConsumerPrincipal`; `authorize_collection`; Mongo fixed-window quota e uso agregado no banco operacional; `GET /internal/consumer-usage` exclusivo do job Payload.

- [ ] **Step 1: Escrever testes de read-only/revoke/allowlist/quota**

```python
def test_revoked_credential_is_rejected_without_cache(cms_db, seeded_consumer_credential):
    raw = seeded_consumer_credential.raw
    assert authenticate_consumer(cms_db, raw).application_id
    # setup escreve por client privilegiado de fixture, nunca pela fachada app.
    seeded_consumer_credential.writer.consumer_credentials.update_one(
        {"_id": seeded_consumer_credential.id}, {"$set": {"status": "revoked"}}
    )
    with pytest.raises(HTTPException) as error:
        authenticate_consumer(cms_db, raw)
    assert error.value.status_code == 401

def test_out_of_scope_slug_is_indistinguishable_from_missing(cms_db, consumer_principal):
    principal = consumer_principal(allowed_collection_ids=["collection-a"])
    with pytest.raises(HTTPException) as error:
        authorize_collection(cms_db, principal, slug="collection-b")
    assert error.value.status_code == 404

def test_cms_database_exposes_no_write_methods(cms_db):
    credentials = cms_db.collection("consumer_credentials")
    assert callable(credentials.find_one)
    assert not hasattr(credentials, "insert_one")
    assert not hasattr(credentials, "update_one")
    with pytest.raises(ValueError):
        credentials.aggregate([{"$out": "forbidden"}])

def test_quota_success_and_rejection_expose_the_same_rate_headers(rate_limit_service):
    first = rate_limit_service.consume("cred-1", limit=2, now=MINUTE)
    second = rate_limit_service.consume("cred-1", limit=2, now=MINUTE)
    rejected = rate_limit_service.consume("cred-1", limit=2, now=MINUTE)
    for result in (first, second, rejected):
        assert set(result.headers) >= {"X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"}
    assert rejected.status_code == 429
    assert rejected.headers["Retry-After"] == "60"

def test_internal_usage_returns_operational_max_and_never_touches_cms(
    client, operational_db, cms_writer, monkeypatch,
):
    record_consumer_usage(operational_db, ConsumerPrincipal(credential_id="cred-1", application_id="app-1"), MINUTE)
    record_consumer_usage(operational_db, ConsumerPrincipal(credential_id="cred-1", application_id="app-1"), MINUTE + timedelta(seconds=5))
    response = client.get("/api/v3/internal/consumer-usage", headers={"X-CMS-Service-Key": "test-cms-key"})
    assert response.status_code == 200
    assert response.json()["items"] == [{"credentialId": "cred-1", "lastUsedAt": "2026-08-18T12:00:05+00:00"}]
    assert cms_writer.consumer_credentials.count_documents({}) == 0
```

Fixtures de suporte são concretos e compartilhados somente pelo `conftest.py`:

| Arquivo | Export exato | Comportamento obrigatório |
|---|---|---|
| `tests/fixtures/cms_projection.py` | `SeededConsumerCredential(id: str, raw: str, writer: Database)` | Dataclass; writer privilegiado existe somente no teste. |
| mesmo | `cms_writer() -> Database` | Fixture limpa `concierge-cms-test` antes/depois. |
| mesmo | `cms_db(cms_writer) -> CmsReadOnlyDatabase` | Envolve o DB na mesma façade read-only usada pelo app. |
| mesmo | `seeded_consumer_credential(cms_writer) -> SeededConsumerCredential` | Insere application + hash/prefix, retorna raw somente ao teste. |
| `tests/fixtures/distribution.py` | `operational_db(test_db) -> Database` | Alias hermético do DB operacional de teste. |
| mesmo | Fixture `consumer_principal() -> ConsumerPrincipalFactory`; o protocol define `__call__(*, allowed_collection_ids: list[str] | None = None, credential_id: str = 'cred-1', application_id: str = 'app-1') -> ConsumerPrincipal` | Factory de principal com defaults e overrides explícitos. |
| mesmo | `consumer_headers(seeded_consumer_credential) -> dict[str,str]` | Header Bearer da credential de teste. |
| mesmo | `distribution_client(client,cms_writer,operational_db) -> DistributionClient` | Client que semeia cenários somente pelas fixtures autorizadas. |
| mesmo | `rate_limit_service(operational_db) -> ConsumerRateLimitService` | Instância real sobre Mongo de teste. |
| mesmo | `MINUTE: datetime` | Valor fixo `2026-08-18T12:00:00Z`. |
| mesmo | `verify_logical_sha(records: list[dict]) -> bool` | Recalcula o digest canônico do dump. |
| mesmo | `consume_partial_stream(client,headers) -> list[dict]` | Consome chunks válidos até a falha simulada. |
| mesmo | `fail_on_second_batch() -> Callable[[Database,list[str]],HydrationBatch]` | Fixture-factory devolve callable stateful: primeiro batch válido, segundo lança `DistributionDependencyError`. |

`tests/conftest.py` declara `pytest_plugins = ("tests.fixtures.cms_projection", "tests.fixtures.distribution")`. O módulo distribution importa `active_curation`/`active_entity` de `tests.factories`, sem criar uma segunda definição. `cms_writer` usa `CMS_MONGODB_TEST_URL`/`CMS_MONGODB_TEST_DB_NAME=concierge-cms-test`; é o único fixture com permissão CMS de escrita. `operational_db` é alias do `test_db` hermético existente.

`DistributionClient` has the concrete test-only signatures `get(path: str, *, headers: dict[str, str] | None = None) -> Response` and `request_case(case: Literal["missing_key", "bad_key", "out_of_scope", "missing_slug", "archived", "foreign_cursor"]) -> Response`; it seeds the matching CMS/operational records through `cms_writer`/`operational_db`, then makes an HTTP request through `client`.

- [ ] **Step 2: Rodar e confirmar imports ausentes**

Run: `cd concierge-api-v3 && venv/bin/pytest tests/test_cms_database.py tests/test_consumer_auth.py tests/test_consumer_rate_limit.py -v`

Expected: FAIL.

- [ ] **Step 3: Implementar segundo client e rate limit distribuído**

`cms_database.py` tem `_cms_client` separado, usa `CMS_MONGODB_READ_URL` e `CMS_MONGODB_DB_NAME`, testa `ping`, expõe `get_cms_database() -> CmsReadOnlyDatabase` e `close_cms_mongo_connection()` e nunca chama `_ensure_indexes`. `CmsReadOnlyDatabase.collection(name)` aceita somente a allowlist `collections`, `collection_versions`, `collection_memberships`, `consumer_applications`, `consumer_credentials`; devolve `CmsReadOnlyCollection` sem `insert_one`, `update_one`, `delete_one`, `bulk_write` ou `create_index`, delegando só `find_one`, `find` e `aggregate`. O usuário Mongo dessa URL recebe apenas `find`; portanto há prova por API, teste e privilégio de banco de que FastAPI não escreve CMS nem lê jobs/audit fora do boundary. Lifespan conecta/fecha ambos independentemente e readiness reporta cada dependência.

```python
class CmsReadOnlyCollection:
    def __init__(self, collection: Collection): self._collection = collection
    def find_one(self, *args, **kwargs): return self._collection.find_one(*args, **kwargs)
    def find(self, *args, **kwargs): return self._collection.find(*args, **kwargs)
    def aggregate(self, pipeline, **kwargs):
        if any('$out' in stage or '$merge' in stage for stage in pipeline):
            raise ValueError('write stage forbidden on CMS projection')
        return self._collection.aggregate(pipeline, **kwargs)

class CmsReadOnlyDatabase:
    def __init__(self, database: Database): self._database = database
    def collection(self, name: str) -> CmsReadOnlyCollection:
        return CmsReadOnlyCollection(self._database[name])
```

`authenticate_consumer` parseia formato/prefix, calcula SHA-256 e consulta credential ativa por prefix+hash+expiry, depois application ativa; nenhuma cache module/global. `authorize_collection` resolve slug e compara ID allowlisted em constant semantics; archived conhecido retorna 410 somente após scope confirmado.

Quota usa collection operacional `consumer_rate_limit_windows` e `$inc` atômico por `(credentialId, minuteWindow)`, TTL 10 minutos. Toda response de distribution, inclusive 200/401/404/410/409 quando o principal já foi autenticado, inclui `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset` (epoch no fim da janela); acima do limite inclui também `Retry-After` e retorna 429. Adicionar somente esse TTL ao `INDEX_SPECS` operacional.

Após autenticar com sucesso, `consumer_usage_service.record_consumer_usage(operational_db, principal, now)` faz `update_one({"credentialId": principal.credential_id}, {"$max": {"lastUsedAt": now}, "$set": {"applicationId": principal.application_id, "updatedAt": now}, "$inc": {"requestCount": 1}}, upsert=True)`. `GET /api/v3/internal/consumer-usage?after=<opaque-cursor>&limit=500` usa o mesmo `X-CMS-Service-Key` rotacionável do boundary Payload→FastAPI, com comparação constante, consulta somente essa collection operacional por `(updatedAt,_id)` e devolve `{items,next_cursor}` sem hash/segredo. Não aceita consumer credential e é registrado com `include_in_schema=False`. Adicionar índice operacional `(updatedAt,_id)`; `consumer_credential_usage` não tem TTL, pois é fonte do sync de last use.

Adicionar ao `Settings` e a `.env.example`: `CMS_MONGODB_READ_URL`, `CMS_MONGODB_DB_NAME=concierge-cms`, `CMS_MONGODB_TEST_URL`, `CMS_MONGODB_TEST_DB_NAME=concierge-cms-test` e `DISTRIBUTION_JSON_MAX_SELECTED=5000` (positivo, fail-closed quando ausente/inválido em production). `CMS_SERVICE_KEY` já foi criado na fase 02 e é reutilizado, não duplicado. Não registrar URL CMS de teste fora do perfil de teste.

- [ ] **Step 4: Rodar testes e readiness**

Run:

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_cms_database.py tests/test_consumer_auth.py tests/test_consumer_rate_limit.py tests/test_consumer_usage.py tests/test_system.py -v
```

Expected: PASS; mock comprova nenhuma chamada write no CMS; quota funciona entre duas instâncias de service.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app concierge-api-v3/tests concierge-api-v3/.env.example
git commit -m "feat(distribution): autenticar consumers pela projecao CMS"
```

---

### Task 3: Fechar DTO público e hidratação live em batches

**Files:**
- Modify: `concierge-api-v3/app/models/distribution.py`
- Modify: `concierge-api-v3/app/services/distribution_service.py`
- Modify: `concierge-api-v3/app/api/internal_curations.py`
- Create: `contracts/json-schema/distribution-item.v1.schema.json`
- Create: `concierge-api-v3/scripts/export_distribution_schema.py`
- Modify: `contracts/openapi/fastapi-admin-internal.v1.json` (gerado)
- Test: `concierge-api-v3/tests/test_distribution_dto.py`
- Test: `concierge-api-v3/tests/test_distribution_hydration.py`

**Interfaces:**
- Produces: `PublicCurationItemV1`, `hydrate_public_batch(db, ids) -> HydrationBatch`, schema JSON determinístico; mesmo DTO para page/dump/admin export.

- [ ] **Step 1: Escrever teste allowlist por dados proibidos sentinela**

```python
def test_public_dto_never_leaks_private_fields():
    curation = active_curation(
        transcript="SENTINEL_TRANSCRIPT", sources=[{"secret": "SENTINEL_SOURCE"}],
        notes={"public": "Wheelchair access", "private": "SENTINEL_PRIVATE"},
        embeddings=[{"vector": [0.1]}], curator={"email": "SENTINEL_CURATOR"},
    )
    entity = active_entity(data={"name": "Place", "sync": {"token": "SENTINEL_SYNC"}})
    serialized = PublicCurationItemV1.from_documents(curation, entity).model_dump_json()
    assert "Wheelchair access" in serialized
    for sentinel in ["SENTINEL_TRANSCRIPT", "SENTINEL_SOURCE", "SENTINEL_PRIVATE",
                     "SENTINEL_CURATOR", "SENTINEL_SYNC"]:
        assert sentinel not in serialized
```

- [ ] **Step 2: Rodar e confirmar DTO incompleto**

Run:

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_distribution_dto.py tests/test_distribution_hydration.py -v
```

Expected: FAIL porque DTO v1 completo/export de schema não existem.

- [ ] **Step 3: Implementar allowlist e batch resolver**

Declarar Pydantic models `PublicAddress`, `PublicCoordinates`, `PublicContact`, `PublicHours`, `PublicMedia`, `PublicEntity`, `PublicCuration`, `PublicCurationItemV1` com `extra='forbid'`. Mapear explicitamente IDs, nome/tipo, address/geo/contact/hours/media, conceitos/categories, description/strength/public notes e timestamps/revisions públicos. Não usar `Curation.model_dump()` nem spread de `data` Mongo.

```python
class PublicCurationItemV1(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    curation: PublicCuration
    entity: PublicEntity

    @classmethod
    def from_documents(cls, curation: dict, entity: dict) -> "PublicCurationItemV1":
        return cls(
            curation=PublicCuration(
                id=curation["curation_id"],
                description=(curation.get("notes") or {}).get("public"),
            ),
            entity=PublicEntity(id=entity["entity_id"], name=entity["name"], type=entity["type"]),
        )
```

`hydrate_public_batch` aceita até 500 IDs, faz duas queries `$in`, preserva ordem técnica dos IDs, chama predicado único e retorna items/reasons. `export_distribution_schema.py` usa `model_json_schema`, sort keys + newline e `--check`.

- [ ] **Step 4: Rodar todos reason codes e schema check**

Run:

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_distribution_service.py tests/test_distribution_dto.py tests/test_distribution_hydration.py -v
venv/bin/python scripts/export_distribution_schema.py
venv/bin/python scripts/export_distribution_schema.py --check
```

Expected: PASS para cada reason code e falha transitória; nenhum sentinel no JSON/schema.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app concierge-api-v3/scripts concierge-api-v3/tests contracts
git commit -m "feat(distribution): fechar DTO publico v1"
```

---

### Task 4: Implementar paginação current/exact e histórico

**Files:**
- Create: `concierge-api-v3/app/models/distribution_api.py`
- Create: `concierge-api-v3/app/services/distribution_cursor.py`
- Create: `concierge-api-v3/app/api/distribution.py`
- Modify: `concierge-api-v3/app/core/config.py`
- Modify: `concierge-api-v3/main.py`
- Test: `concierge-api-v3/tests/test_distribution_api.py`
- Test: `concierge-api-v3/tests/test_distribution_cursor.py`

**Interfaces:**
- Produces: cinco rotas distribution da spec; cursor signed; `CollectionDistributionEnvelopeV1` com counts e next cursor.

Routes e cursor são deliberadamente distintos:

```text
GET /api/v3/distribution/collections/{slug}                         # versão current resolvida nesta request
GET /api/v3/distribution/collections/{slug}/versions                # histórico paginado por version_cursor
GET /api/v3/distribution/collections/{slug}/versions/{version}      # membership da versão path, item_cursor somente dessa versão
GET /api/v3/distribution/collections/{slug}/dump                    # dump inteiro da versão current resolvida nesta request
GET /api/v3/distribution/collections/{slug}/versions/{version}/dump # dump inteiro da versão path
```

`GET current` não aceita `version`; na primeira página fixa a versão current resolvida no cursor. `GET exact` exige inteiro positivo no path e rejeita cursor cuja `publishedVersion` não seja exatamente o path. `GET /versions` usa `version_cursor` com `purpose="version-list"`, `lastVersion` e não aceita `item_cursor`; as rotas de items usam `cursor` com `purpose="collection-items"` e nunca aceitam `version_cursor`. Dumps não aceitam cursor: percorrem a membership completa da versão resolvida. Cursor de application, collection, versão, filtros, purpose ou schema diferentes retorna 409.

- [ ] **Step 1: Escrever matriz 401/404/410/409 e cursor binding**

```python
@pytest.mark.parametrize("case,status", [
    ("missing_key", 401), ("bad_key", 401), ("out_of_scope", 404),
    ("missing_slug", 404), ("archived", 410), ("foreign_cursor", 409),
])
def test_distribution_error_semantics(case, status, distribution_client):
    response = distribution_client.request_case(case)
    assert response.status_code == status

def test_exact_version_keeps_membership_but_hydrates_live(distribution_client, operational_db):
    before = distribution_client.get('/collections/sushi/versions/1').json()
    operational_db.curations.update_one({"curation_id": "c1"}, {"$set": {"notes.public": "new live"}})
    after = distribution_client.get('/collections/sushi/versions/1').json()
    assert before["collection"]["version"] == after["collection"]["version"] == 1
    assert after["items"][0]["curation"]["description"] == "new live"
```

- [ ] **Step 2: Rodar e confirmar 404/router ausente**

Run: `cd concierge-api-v3 && venv/bin/pytest tests/test_distribution_api.py tests/test_distribution_cursor.py -v`

Expected: FAIL.

- [ ] **Step 3: Implementar membership scan, counts e cursor**

Resolver Collection/version metadata no CMS. Query de membership em batches por interval:

```python
{"collectionId": collection_id,
 "addedInVersion": {"$lte": version},
 "$or": [{"removedInVersion": None}, {"removedInVersion": {"$gt": version}}]}
```

Ordenar `curationId`, nunca posição. Para cada page, caminhar memberships após cursor até reunir `limit<=200` items disponíveis; cursor guarda último ID visitado. Em passe batched separado, calcular `available/unavailable` exatos para a versão live; `selected` vem da versão imutável. Benchmark da fase 07 valida custo antes de produção.

Cursor usa segredo `DISTRIBUTION_CURSOR_SECRET`, TTL 15 minutos e payload `{purpose,applicationId,collectionId,publishedVersion,schemaVersion,filtersHash,lastCurationId,exp}`; para histórico substitui `publishedVersion/lastCurationId` por `lastVersion`. HMAC/tamper/expiry/mismatch retorna 409. Todas responses incluem no-store e os headers de quota definidos na Task 2.

- [ ] **Step 4: Rodar APIs, cursor e arquivo/restore**

Run:

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_distribution_api.py tests/test_distribution_cursor.py tests/test_consumer_auth.py -v
```

Expected: PASS; archived current/exact/versions retorna 410, restore expõe a mesma current version; out-of-scope continua 404.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app concierge-api-v3/tests
git commit -m "feat(distribution): paginar Collections publicadas"
```

---

### Task 5: Streaming NDJSON/gzip, JSON bounded e Admin Distribution UI

**Files:**
- Modify: `concierge-api-v3/app/api/distribution.py`
- Create: `concierge-api-v3/app/services/distribution_dump.py`
- Create: `concierge-api-v3/tests/test_distribution_dump.py`
- Create: `apps/admin/src/components/applications/ApplicationViews.tsx`
- Create: `apps/admin/src/components/credentials/CredentialRevealDialog.tsx`
- Create: `apps/admin/tests/unit/components/credential-reveal.test.tsx`
- Create: `apps/admin/tests/e2e/credentials/lifecycle.spec.ts`
- Modify: `apps/admin/src/components/collections/CollectionViews.tsx`

**Interfaces:**
- Consumes: page DTO/hydration e application endpoints.
- Produces: NDJSON manifest/item/footer, gzip negotiation, JSON cap `DISTRIBUTION_JSON_MAX_SELECTED=5000`, UI create/show-once/rotate/revoke.

- [ ] **Step 1: Escrever teste de footer e stream interrompido**

```python
def test_ndjson_has_manifest_items_and_valid_footer(client, consumer_headers):
    response = client.get('/api/v3/distribution/collections/sushi/dump?format=ndjson',
                          headers=consumer_headers)
    records = [json.loads(line) for line in response.text.splitlines()]
    assert records[0]["record_type"] == "manifest"
    assert records[-1]["record_type"] == "footer"
    assert records[-1]["available_count"] == len(records) - 2
    assert verify_logical_sha(records)

def test_transient_failure_ends_without_footer(client, consumer_headers, monkeypatch):
    monkeypatch.setattr('app.services.distribution_dump.hydrate_public_batch', fail_on_second_batch)
    records = consume_partial_stream(client, consumer_headers)
    assert not any(record.get("record_type") == "footer" for record in records)
```

- [ ] **Step 2: Rodar e confirmar dump ausente/incompleto**

Run: `cd concierge-api-v3 && venv/bin/pytest tests/test_distribution_dump.py -v`

Expected: FAIL.

- [ ] **Step 3: Implementar stream bounded-memory e UI show-once**

`iter_ndjson_dump` emite manifest com generated_at/version/selection hash, cada item compact JSON e footer com selected/available/unavailable/reason counts/SHA-256 dos records lógicos. Usa batches 500 e `StreamingResponse(application/x-ndjson)`. Para `Accept-Encoding:gzip`, envolver iterator com `zlib.compressobj(wbits=31)` e flush final; nunca montar o dump inteiro.

```python
def iter_ndjson_dump(context: DistributionContext) -> Iterator[bytes]:
    digest = hashlib.sha256()
    yield encode_logical_record({"record_type": "manifest", **context.manifest})
    for batch in iter_membership_batches(context.version, batch_size=500):
        hydrated = hydrate_public_batch(context.operational_db, batch)
        for item in hydrated.items:
            line = encode_logical_record({"record_type": "item", "item": item.model_dump(mode="json")})
            digest.update(line)
            yield line
    yield encode_logical_record({"record_type": "footer", "sha256": digest.hexdigest(), **context.counts})

def gzip_iter(chunks: Iterator[bytes]) -> Iterator[bytes]:
    compressor = zlib.compressobj(wbits=31)
    for chunk in chunks:
        out = compressor.compress(chunk)
        if out: yield out
    tail = compressor.flush()
    if tail: yield tail
```

`format=json` só funciona quando `selected_count <= settings.distribution_json_max_selected`; configurar `DISTRIBUTION_JSON_MAX_SELECTED=5000` em `.env.example`, com default 5000 e validação `ge=1` no `Settings`. Acima retorna 413 com URL equivalente `format=ndjson`. Admin UI copia/download secret somente enquanto dialog de issue está aberto, impede reabertura após close e orienta rotação; application view edita allowlist e rate limit e exibe last use sincronizado, versões autorizadas e exemplos `curl` sem secret real.

- [ ] **Step 4: Rodar dump/E2E credential/revoke imediato**

Run:

```bash
cd concierge-api-v3 && venv/bin/pytest tests/test_distribution_dump.py tests/test_distribution_api.py -v
cd ..
npm run test:admin -- --run tests/unit/components/credential-reveal.test.tsx
npm run test:e2e --workspace=@concierge/admin -- tests/e2e/credentials/lifecycle.spec.ts
```

Expected: PASS; revoke faz a próxima request retornar 401; stream interrompido não tem footer; gzip descomprime para o mesmo SHA lógico.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app concierge-api-v3/tests apps/admin
git commit -m "feat(distribution): entregar dumps e gestao de credentials"
```

## Gate da fase

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_consumer_auth.py tests/test_consumer_rate_limit.py tests/test_distribution_service.py tests/test_distribution_dto.py tests/test_distribution_hydration.py tests/test_distribution_api.py tests/test_distribution_cursor.py tests/test_distribution_dump.py -v
cd ..
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run test:e2e --workspace=@concierge/admin -- tests/e2e/credentials
npm run check:contracts
```

Expected: exit 0; nenhum campo proibido aparece em page/dump/export; archive/revoke têm efeito imediato.
