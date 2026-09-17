# Harness E2E de autoração (Collector)

Cobre o que `docs/PENDENCIAS_MELHORIAS.md` registrava como **não verificado ponta
a ponta**: abrir o editor de curadoria → editar → salvar → interromper → retomar
→ sincronizar. É o harness do frontend vanilla (`index.html` + `scripts/`), separado
do Playwright do Admin (`apps/admin/playwright.config.ts` e seus specs não são
tocados por aqui). Sem dependência nova: `@playwright/test` vem do hoist do
workspace (`apps/admin`).

## Stack necessário

1. **Mongo local**
   ```bash
   mongod --dbpath /tmp/cc-e2e-mongo/data --port 27017 --bind_ip 127.0.0.1
   ```

2. **FastAPI apontando para um banco descartável** (`-test`) **no Mongo local**
   ```bash
   cd concierge-api-v3
   MONGODB_URL=mongodb://127.0.0.1:27017 MONGODB_DB_NAME=concierge-collector-test \
     venv/bin/python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
   ```
   > ⚠️ `./run_local.sh --test-db` troca **só** o `MONGODB_DB_NAME` e mantém o
   > `MONGODB_URL` do `.env` — que neste repo aponta para o Atlas de produção.
   > Sem o override acima, o `--test-db` cria um banco `-test` no cluster de
   > produção. Por isso o harness lê o nome do banco de `/api/v3/info` e recusa
   > tudo que não termine em `-test`.
   >
   > `ENVIRONMENT=development` (o default do `.env`) é o que habilita o
   > `/api/v3/auth/dev-login`; nenhuma credencial de produção é usada.

3. **O Collector não precisa de servidor próprio**: o harness sobe
   `python3 -m http.server` na raiz do repo, em `http://127.0.0.1:5500` — o host
   que `scripts/core/config.js` reconhece como local e que o `FRONTEND_URL` do
   FastAPI libera em CORS. O `index.html` carrega Dexie/JSZip/toastify do
   jsdelivr, então o ambiente precisa de rede.

## Rodar

```bash
cd e2e/authoring
npx playwright test --list                 # lista o spec, sem stack
npx playwright test                        # sem COLLECTOR_E2E=1: pula tudo, sai 0
COLLECTOR_E2E=1 npx playwright test        # roda a cadeia (stack de pé)
```

Pela raiz: `npm run test:e2e:authoring`.

### Knobs

| variável | default | uso |
|---|---|---|
| `COLLECTOR_E2E` | — | `1` liga a suíte; sem ela os specs são pulados |
| `COLLECTOR_E2E_BASE_URL` | `http://127.0.0.1:5500` | origem do Collector (o servidor estático é do harness) |
| `COLLECTOR_E2E_API_URL` | `http://127.0.0.1:8000` | FastAPI — usado pelos guardas e pelas verificações do spec. O app em si chama **`http://localhost:8000/api/v3` fixo** (constante do `config.js` para hosts locais), então na prática a API precisa estar nessa porta |
| `COLLECTOR_E2E_MONGO_URL` | `mongodb://127.0.0.1:27017` | usado só pelo seed |

## Guardas (falham antes de abrir qualquer browser)

No `global-setup.ts`, e só com `COLLECTOR_E2E=1`:

1. os dois alvos precisam ser **loopback** (alvo remoto é recusado sem nem
   tentar conectar);
2. o banco que a API **está servindo** (lido de `/api/v3/info`) precisa terminar
   em `-test`;
3. a API precisa liberar **CORS** para a origem do Collector (sem isso o app não
   passa do login — falha nomeando `FRONTEND_URL`/`CORS_ORIGINS`);
4. a fixture do repo é recriada com
   `concierge-api-v3/scripts/seed_e2e_curations.py` (3 Entities + 3 Curations,
   idempotente, e ele mesmo recusa banco que não seja `-test`).

## O que o spec (`authoring-chain.spec.ts`) prova

Todas as ações são de curador (clique em botão, digitação, fechar/abrir a
página); a verificação final é na API, com o token do próprio app.

| passo | observável |
|---|---|
| 1. criar | FAB → Quick actions → Manual entry; nome, descrição, nota pública e um conceito (`+ Add Cuisine`) entram no formulário |
| 2. salvar | o card da Curation aparece na lista; a API devolve a linha com o conceito |
| 3. **reload** | recarga a página: o card continua lá |
| 4. editar + salvar | o editor abre pelo card (id da URL conferido contra o id da API), mostra o valor **persistido**, e a API passa a devolver o texto novo (mesmo `curation_id`, `version` maior) |
| 5. **rascunho sobrevive à interrupção** | digita na nota pública **sem salvar**, espera a janela de autosave (3s), **fecha a página** antes de qualquer sync |
| 6. retomar | nova página → card → editor: a nota **não salva** volta ao campo |
| 7. salvar a retomada | a API passa a devolver exatamente esse texto |
| 8. vincular Entity | card → Link Entity → busca → seleciona a Entity da fixture no seletor local-first; o app confirma na tela (“Review linked to …”) |
| 9. conferir na API | `restaurant_name`, conceito, **provenance** (`sources.manual`), `notes.public` do rascunho retomado, `entity_id` vinculado — e `GET /entities/{id}` devolve a Entity da fixture de verdade |

## O que ele NÃO cobre (e por quê)

- **Captura por device (áudio e foto)** — `test.fixme` no fim do spec com o
  motivo. `#curation-record-review` depende de `getUserMedia`/MediaRecorder
  reais (headless não tem device de entrada; `--use-fake-device-for-media-stream`
  seria mock da captura) e a transcrição sai para o provedor de IA.
  `#take-photo` é input de arquivo com `capture=environment` (câmera do
  aparelho). Consequência: `sources.audio`, `sources.image` e o
  PendingAudioManager não têm cobertura E2E.
- **Import pelo Google Places** — o vínculo é provado pelo caminho local-first
  (Entity já no cache). Buscar/importar do Places depende de chave e rede
  externas e tornaria o spec não determinístico.
- **Deep link em cold boot** — medido, fora do escopo: recarregar com
  `#/curation/<id>/edit` abre o editor **sem** restaurar o rascunho (o wrapper de
  restore instala depois do boot, e o handler de rota do boot chama
  `editCuration` antes disso). O spec retoma pelo card, que é o caminho do
  curador; o deep link fica registrado como comportamento observado, não como
  contrato.
- **O campo Description do editor** — não existe no contrato da API
  (`Curation` não declara `description`; o valor é descartado no upsert), por
  isso a persistência e a retomada são provadas em `notes.public`, que é campo
  do contrato.
- **IA** (transcrição, descrição gerada, conceitos extraídos) — chaves e rede
  externas; o spec adiciona o conceito pelo editor manual.
- **Produção** — `config.js` continua escolhendo o host por hostname; o harness
  só existe contra stack local e recusa qualquer alvo fora de loopback.

## Efeitos colaterais

- Cada execução cria **uma Curation** (nome `E2E Authoring <timestamp>`) no banco
  `-test`; ela serve de evidência e é deixada lá. O banco é descartável.
- Falha de passo grava trace em `e2e/authoring/test-results/` (`npx playwright
  show-trace`).
