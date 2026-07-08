# Curadorias por pesquisa web (piloto) — design

**Data:** 2026-07-08
**Status:** aprovado para piloto

## Objetivo

Gerar curadorias **draft** ricas para entidades já importadas (ex.: restaurantes do Rio vindos de Overture/OSM, que têm nome/localização/contato mas nenhuma opinião humana, `place_id` do Google ou reviews). Um curador humano revisa e finaliza depois. A IA faz ~80% do trabalho; o humano dá o toque final.

Isto é um **script utilitário local**, não parte da aplicação. Simplicidade > rigor. Sem confidence score sofisticado, sem tratamento elaborado de robots/ToS, sem checkpoint complexo.

## Fluxo

Script novo: `scripts/python-tools/research_curations.py`. Roda local, dry-run por padrão. Para cada entidade:

1. **Montar queries** a partir do Mongo: `"{nome}" {bairro} {cidade}` e `"{nome}" restaurante {cidade}`. Bairro/cidade vêm de `data.location`.
2. **Buscar** no DuckDuckGo (`ddgs`), top ~5 links por query, dedup por domínio.
3. **Scrape + extrair** texto limpo de cada página com `trafilatura`; concatenar num bloco único, cada trecho precedido de `--- FONTE: {url} ---`, cortado a um teto de caracteres.
4. **LLM (DeepSeek, OpenAI-compatível)**: enviar o bloco + as categorias do schema (de `GET /concepts/restaurant` ou coleção `categories`). Instrução: extrair conceitos **só do que está no texto**; sem evidência = campo vazio; **não inventar** (grounded only). Retorna JSON `{categoria: [valores]}`.
5. **Montar curation** `draft`: `categories` do LLM, `sources: {web_research: [urls]}`, `transcript` = bloco pesquisado, `curator` = curador de automação, `entity_id` = a entidade. Salvar num JSON revisável.

Depois: revisão humana do JSON → import via `import_curations.py` (já existe, usa `POST /curations/bulk`). Embeddings via `generate_embeddings.py` (já existe) após import.

## Categorias-alvo

Dinâmicas do schema: `cuisine`, `mood`, `setting`, `food_style`, `menu`, `price_range`, `drinks`, `special_features`, `crowd`, `suitable_for`.

## Piloto

Rodar em ~30 entidades do Rio → gerar `data/rio_curations_research.json` → revisar qualidade juntos → ajustar prompt/queries se preciso → só então escalar.

## Dependências

- Instalar no venv da API: `ddgs`, `trafilatura` (traz `lxml`), `beautifulsoup4` (fallback).
- `openai` já instalado (cliente reaproveitado com `base_url` da DeepSeek).
- Adicionar `DEEPSEEK_API_KEY` (e opcional `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`) ao `concierge-api-v3/.env`.

## Resiliência (mínima)

- Cache por entidade: se o JSON de uma entidade já existe, pula. Se cair, roda de novo.
- Rate-limit gentil (sleep curto entre queries/páginas).
- Falha de scrape/busca numa entidade não derruba o lote — segue para a próxima.

## Não-objetivos

- Não é endpoint/serviço server-side.
- Não gera curadorias `active`/publicadas automaticamente.
- Não faz enriquecimento via Google Places API.
- Não escala pras 7.428 sem revisão do piloto antes.
