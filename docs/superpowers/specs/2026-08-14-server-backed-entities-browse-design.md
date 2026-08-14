# Design — Browse server-backed das Entities no Collector

**Data:** 2026-08-14
**Status:** aprovado pelo usuário (segue implementação)
**Escopo:** aba Entities do Collector passa a navegar o acervo completo do servidor com busca/filtros server-side, sem baixar o catálogo para o celular.

## Contexto e problema

O acervo tem ~21,6k entities no MongoDB (OSM/Overture/Michelin/Google Places) e as curations vão crescer para dezenas de milhares. Hoje a aba Entities lê **apenas** o IndexedDB local, que só contém entities ligadas a curations locais (design anterior, offline-first) — visão parcial inaceitável. Ao mesmo tempo, baixar 21k entities para o celular é inviável ("saber e ter acesso não significa baixar todas").

As curations já resolveram esse problema: `CurationBrowser` + `GET /curations/search` (q/city/type/status, cursor/offset, `/cities` para dropdown). Este design faz as entities alcançarem o mesmo padrão (abordagem A — ver decisões).

## Requisitos

1. **Ver tudo:** a aba Entities navega o acervo completo do servidor (busca por nome, filtro de tipo e cidade).
2. **Não entupir o celular:** paginação server-side; nenhuma entidade é baixada além da página exibida (25/page).
3. **Offline-first preservado (requisito do usuário):** criar/popular curations offline continua funcionando integralmente — gravar review, edições, tudo pendente até voltar a rede. A aba Entities, sem rede, cai para as entities locais com aviso discreto.
4. **Cota do Atlas respeitada:** nenhum índice novo, nenhuma migração de dados.

## Decisões

- **Abordagem A** (EntityBrowser server-backed espelhando CurationBrowser), sobre B (Atlas Search — custo de índice/storage desnecessário para 21k docs) e C (cache de metadados ~2MB no cliente — mecanismo extra, desatualização; fica documentada como evolução futura).
- **Filtro de cidade via regex sem índice** no `data.address.street` (campo city do bulk é vazio; cidade vive no street) — scan de ~21k docs é ~100ms. Sem backfill/índice para proteger a cota de storage.
- **Busca textual = regex no nome** (`q` alias de `name`), consistente com o `/curations/search`.
- **Sem ordenação nova** (ordem `_id` atual); YAGNI — busca/filtros estreitam o conjunto.
- Cidade nas entities é **texto livre** (input), espelhando o filtro de cidade já existente na aba Curations.

## Design

### 1. Backend — `concierge-api-v3/app/api/entities.py`

`list_entities` ganha dois parâmetros de query, sem mudar paginação (cursor/offset existentes) e sem índice novo:

- `city: Optional[str]` — regex case-insensitive escapado (`re.escape`) em `$or`: `data.address.street` e `data.address.city` (cobre os dois formatos de entity).
- `q: Optional[str]` — regex case-insensitive no `name`; `name` continua aceito (compat).

Quando `city` combina com outros filtros, o `$or` entra como chave top-level do query Mongo (`$and` implícito) — sem conflito.

### 2. Serviço novo — `scripts/services/entityBrowser.js`

Classe espelhando `CurationBrowser` (mesmo estilo: classe pura, injeção de `apiService`, sem ModuleWrapper — como o curationBrowser):

- `constructor({ apiService, pageSize = 25 })`
- `openScope({ type, city, q })` — reseta cursor/items/total quando o scope muda
- `nextPage()` — página seguinte por `after_id` (cursor)
- `openPage(pageNumber)` — página arbitrária por `offset` (prev/next), com total real
- `items`, `total` (-1 = desconhecido em modo cursor), `done`, `loading`
- Mapeia params para `ApiService.listEntities({ limit, after_id | offset, type, city, q })`

`ApiService.listEntities` (apiService.js) ganha repasse de `city` e `q` no URLSearchParams.

### 3. UI — `uiManager.js` + `index.html`

- A aba Entities passa a usar o `EntityBrowser` (instanciado no uiManager, como o CurationBrowser).
- Search input (`#entity-search`): debounce 300ms → `q`.
- Filtro de tipo (`#entity-type-filter`): select → `type`.
- Filtro de cidade: `#entity-city-filter` vira **input de texto livre** (hoje é select populado localmente) → `city`, debounce 300ms.
- Paginação: prev/next + "Mostrando X–Y de Z" com total do servidor (mesmo padrão visual da aba Curations).
- Contagem da aba (`updateEntitiesCountSummary`) usa o total do servidor.
- **Fallback offline:** quando `navigator.onLine === false` ou a primeira busca falha com erro de rede, a aba mostra as entities locais do DataStore (filtro atual: linked + createdBy) com um aviso discreto ("offline — mostrando dados locais"). O fluxo de curations (criação/edição/fila de sync) NÃO é tocado.
- `loadEntities()` vira o gatilho do browse (chamado após import do Find Entity, troca de aba, etc.) — o import continua persistindo localmente (fix anterior), o que mantém o fallback offline completo.
- Cards continuam via `CardFactory.createEntityCard(entity)` — já tolerante aos dois formatos. Ações dos cards recebem o objeto da entity da página (não leem do DataStore); checagem pontual na implementação de qualquer ação que ainda leia o DataStore em vez do objeto.

### 4. Fluxo de dados

```
Aba Entities
  └─ uiManager → EntityBrowser.openScope({type, city, q})
       └─ ApiService.listEntities({limit:25, after_id|offset, type, city, q})
            └─ GET /api/v3/entities  → Mongo (filtros + paginação)
  └─ offline/falha de rede → DataStore.getEntities (linked + createdBy) + aviso
```

### 5. Tratamento de erros

- Busca falhou (rede/5xx): exibe o fallback local com o aviso de offline (ou mensagem de erro + botão de retry se houver dados locais vazios).
- Página vazia em modo cursor: `done = true` (mesmo comportamento do curationBrowser).
- Docs malformados no Mongo: já são pulados no backend (validação Pydantic) — sem 500.

### 6. Testes

- **Backend** (pytest, mesmo padrão dos unit tests existentes da API): filtros `city` e `q` montam o query esperado; combinação com `type`; escape do regex.
- **Frontend** (vitest): `EntityBrowser` — reset de cursor quando o scope muda, mapeamento de params (`after_id` vs `offset`), `nextPage`/`openPage` com apiService mockado, `done` em página vazia.
- Suítes completas: `npm test` (frontend) + `venv/bin/pytest -m "not integration and not external_api and not mongo and not openai"` (backend).
- Verificação manual via browser com busca real contra o servidor.

## Fora de escopo

- Mudanças na aba Curations (já server-backed; este design documenta o padrão para quando ela escalar).
- Ordenação (nome/rating) e abordagem C (cache de metadados).
- Bug latente do init do IndexedDB em perfil novo (modo degradado) — investigação separada.
- Limpeza do lixo de teste no banco (`entity_curation_test_*`, doc "Terraço Jardins").
