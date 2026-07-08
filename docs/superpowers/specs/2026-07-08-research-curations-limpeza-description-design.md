# Limpeza de conteúdo + Description no `research_curations` — Design

**Data:** 2026-07-08
**Status:** aprovado (aguardando revisão da spec)
**Contexto:** estende `scripts/python-tools/research_curations.py` (piloto de curadorias por pesquisa web, já em produção após PR #1).

## Objetivo

Adicionar ao programa de research curations:

1. **Limpeza heurística** do conteúdo bruto raspado (eliminar sujeira que atrapalha extração e leitura).
2. **Transcript = texto limpo** — o `transcript` da curation passa a ser o texto limpo (com rótulo de fonte), em vez do dump bruto atual.
3. **Description gerada por IA** — prosa curta em português, gravada em `entity.data.description` (o campo que o banco de fato usa para "description").

## Decisões de design (fechadas no brainstorming)

- **Limpeza é só heurística** (função pura, sem chamada de LLM para limpar).
- **Uma única chamada de LLM por entidade**, retornando **duas saídas**: `categories` + `description`. Não há geração de transcript por IA.
- **Transcript = texto limpo** (mesmo texto que alimenta o LLM), rotulado por fonte.
- **Description vai para `entity.data.description`** (não para a curation), via patch de entidade separado.
- **Idioma**: `description` em **português** (1-3 frases factuais, igual às descrições reais no banco); `categories` continuam em **inglês minúsculo** (convenção existente — ver `curation-category-vocabulary`).

## Achados do schema/banco que embasam o design

- `CurationBase.transcript` (alias `unstructured_text`): "texto associado à curadoria". **Não existe** campo `description` na curation.
- `description` no banco = **`entity.data.description`** (83 entidades já têm; reais brasileiras em PT, 1-3 frases, ~55–253 chars).
- `POST /entities/bulk` faz **deep-merge do `data`** (`bulk_upsert_entities`, "Deep-merge the data field instead of replacing it"; `create_entity`: `{**existing_data, **new_data}`). Logo, enviar `{entity_id, name, type, data:{description}}` **só adiciona** `data.description`, sem apagar `location`/contatos. `import_entities.py` já usa esse endpoint e valida `entity_id`, `name`, `type`.

## Fluxo (data flow)

```
build_queries → search_web → scrape_url            (inalterado: texto bruto por página)
        ↓
clean_scraped_text  (NOVO: heurística, por página)
        ↓
build_research_block(pages_limpos)  → texto limpo rotulado por fonte
        ↓
extract_llm(texto_limpo)  → { categories, description }   (1 chamada)
        ↓
   ┌───────────────────────────────┴───────────────────────────────┐
build_curation                                             entity patch (NOVO)
  transcript = texto limpo                                   { entity_id, name, type,
  categories = categories                                      data: { description } }
  → data/rio_curations_research_v2.json                      → data/rio_entity_descriptions.json
  (import_curations.py --keep-entity-id)                      (import_entities.py --apply)
```

Continua **1 chamada de LLM por entidade**; a limpeza é grátis (heurística); nenhum passo novo de rede.

## Componentes

### 1. `clean_scraped_text(text: str) -> str`  (NOVO — puro/testável)

Conservador: só remove o que é claramente lixo, preservando conteúdo real (nomes de prato, frases descritivas).

Regras:
- Quebra em linhas; descarta vazias e **linhas curtas de navegação** (curtas e sem pontuação de frase, ou tokens como `Home`, `Menu`, `Login`, `Compartilhar`, `Buscar`).
- Remove **boilerplate por padrão** (PT/EN): consentimento de cookies, "assine/newsletter/subscribe", `Último update: …`, andaimes de rating (`★ 2.3 / 5`, `(6 Avaliação)`, `Avaliações`), `FAQ`, `Imagens`, blocos de share social.
- **Deduplica** linhas repetidas (idênticas após normalização).
- Colapsa múltiplos espaços/linhas em branco.

Aplicada por página, antes de `build_research_block`.

### 2. Chamada LLM — 1 chamada, 2 saídas

Estende o extractor para retornar JSON `{ "categories": {...}, "description": "..." }`:
- **`categories`**: comportamento atual (vocab controlado, inglês minúsculo, `price_range` na escala fechada, semântica por categoria). Continua passando por `clean_llm_categories`.
- **`description`**: prosa **em português**, 1-3 frases, factual e **aterrada** no texto; sem invenção. Se o texto não sustentar, retorna vazio (`""`). Passa por trim + limite de tamanho (ex.: ~400 chars).

Nota: parsing robusto de JSON já existe (`_parse_json_object`).

### 3. Saídas e escrita

- **Curation** (arquivo/fluxo existente): `transcript` passa a ser o texto **limpo**; `categories` como hoje. Import via `import_curations.py --keep-entity-id`.
- **Entity patch** (NOVO arquivo, default `data/rio_entity_descriptions.json`): lista de `{entity_id, name, type, data:{description}}`. Só inclui entidades com `description` não-vazia. Import via `import_entities.py --apply` (deep-merge, sem clobber).

### 4. Orquestração / CLI

- `research_entity(...)` passa a devolver **`(curation, entity_patch | None)`** (patch ausente quando não há description).
- `main()` grava os **dois** arquivos incrementalmente, com cache por `entity_id` em cada um; imprime ambos os comandos de import no fim.
- Nova flag opcional `--descriptions-output` (default `data/rio_entity_descriptions.json`). Sem novas flags obrigatórias.

## Testes (TDD, dublês injetáveis — sem rede/LLM real)

- `clean_scraped_text`: remove nav/boilerplate/rating; deduplica; preserva conteúdo real (nome de prato/frase).
- Chamada LLM: parse de `{categories, description}`; `description` vazia ⇒ omitida; categorias continuam normalizadas.
- `research_entity`: retorna `(curation, patch)`; patch ausente quando sem description; `transcript` = texto limpo.
- Formato do entity patch: `{entity_id, name, type, data:{description}}` (campos exigidos por `import_entities.py`).

## Fora de escopo (YAGNI)

- Geração de transcript por IA (removido — transcript é o texto limpo).
- Limpeza via LLM (só heurística).
- Confidence score, robots.txt, checkpoint complexo (mantém a filosofia do script utilitário).
- Embeddings (passo separado pós-import, como já é).

## Compatibilidade

- O piloto atual (`data/rio_curations_research_v2.json`) permanece compatível; ao re-rodar, o `transcript` das novas passa a ser limpo (as em cache não são reprocessadas).
- Import de curations e de entities usam scripts existentes; nenhum endpoint novo.
