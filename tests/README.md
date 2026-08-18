# Suíte de Testes — Frontend (vitest)

Testes do frontend vanilla (raiz do repo): vitest + jsdom + fake-indexeddb.
As outras duas suítes do projeto vivem em `concierge-api-v3/tests/` (pytest,
hermético em banco `-test` via conftest) e `scripts/python-tools/tests/`
(pipeline, fakes em memória).

## Números

- **Arquivos**: ~54 (ver `npx vitest run` para o total vivo)
- **Testes**: ~820+ passando (contagem atualizada a cada ciclo; o CI foi
  removido em 2026-08-14 — os testes rodam LOCALMENTE e são a barra de
  qualidade)
- **Skips**: honestos — testes de integração indisponíveis chamam
  `t.skip(motivo)` e APARECEM como skipped (não "passam" silenciosamente)
- **Coverage**: thresholds 70/60/70/70 (`npm run test:coverage`)

## Como rodar

```bash
# Suíte completa (raiz do repo)
npm test

# Arquivo único / teste único
npx vitest run tests/<arquivo>.test.js
npx vitest run tests/<arquivo>.test.js -t "nome do teste"

# Watch e cobertura
npm run test:watch
npm run test:coverage
```

## Integração com a API real — banco de TESTE obrigatório

Os 3 arquivos de integração (`test_apiService`, `test_api_integration`,
`test_integration`) escrevem na API local (localhost:8000). A API usa o
`.env` do backend — que aponta para o **Atlas de produção**. Para os
testes nunca sujarem produção:

1. **Suba a API com banco descartável:**
   ```bash
   cd concierge-api-v3 && ./run_local.sh --test-db
   ```
2. O guard de `tests/helpers.js` consulta o `/info` da API (campo
   `database`, 2026-08-18) e **só libera a integração quando o banco
   termina em `-test`**. Com a API apontando para produção, os testes
   aparecem como **skipped** com o motivo no warn do beforeAll.
3. Opt-in de emergência (cria resíduo no banco alvo — limpar depois):
   `TEST_API_ALLOW_PROD=1 npm test`.

Sem API de pé: tudo skipped com motivo. Nenhum teste de integração
"passa" sem API.

### Teardown por registro (não por varredura)

Os testes **registram** o que criam e o `afterAll` deleta por id:

```javascript
import { trackTestEntity, trackTestCuration, cleanupRegisteredTestData } from './helpers.js';

test('cria entity', async () => {
  const created = await post(...);
  trackTestEntity(created.entity_id);   // ← obrigatório após cada criação
});

afterAll(async () => { await cleanupRegisteredTestData(); });
```

O sweep antigo varria a primeira página do servidor e filtava por
substring "test" — perdia `entity_lifecycle_*`, `entity_conflict_*` e
tudo além da página 1, e o resíduo se acumulava no Atlas de produção
(incidente recorrente até 2026-08-18).

## Convenções dos arquivos de teste

- Header comentando propósito, regressão coberta e dependências
  (mesma regra dos módulos de produção)
- Harness sem bundler: `readFileSync` + `new Function('window', src)`
  para carregar o módulo sob teste (padrão ModuleWrapper)
- Limpar `window.*` e `document.body` no `afterEach`
- Unit = sem rede; integração = API real (com o guard acima)
- Nada de mock/fake/sample data de produção; falha de teste = bug a
  investigar, não expectativa a afrouxar

## Estrutura

```
tests/
├── conftest.js                  # jsdom + fake-indexeddb + globals
├── helpers.js                   # fixtures, guard de produção, registro de teardown
├── test_*.test.js               # ~50 arquivos: um por módulo/regressão
│   ├── test_apiService.test.js        # integração — camada API (60)
│   ├── test_api_integration.test.js   # integração — CRUD real (12)
│   ├── test_integration.test.js       # integração — fluxos completos (8)
│   ├── test_uiManager/syncManager/ogImage/...  # unit das regressões de UX
│   └── ...
```

## Troubleshooting

- **"Integration tests skipped: API local usa o banco 'concierge-collector'..."**
  → a API subiu contra produção. Suba com `./run_local.sh --test-db`.
- **"API local indisponível em http://localhost:8000"** → suba a API
  (`cd concierge-api-v3 && ./run_local.sh --test-db`).
- **`API_SECRET_KEY not found`** → o helpers.js lê
  `concierge-api-v3/.env`; verifique se a chave existe lá.
