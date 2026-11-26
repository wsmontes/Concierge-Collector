# Cardápio da entidade (scraping sob demanda + pré-preenchimento) — Design

**Status:** fase 1 implementada em 2026-11-26 (branch `feat/entity-menus`), ainda não publicada.
**Repos:** Collector (`concierge-api-v3`) é o dono; o bot (`lotier-concierge-engine-agent`) consome.

## Objetivo

Dar a cada restaurante os fatos que só o cardápio tem: preço por pessoa em reais, pratos (o que é leve,
vegetariano, frutos do mar), menu executivo, degustações, couvert e rolha. Um mesmo endpoint serve para
**popular antecipadamente** (script sobre o catálogo) e para **atualizar sob demanda** (Admin, bot), sem
pipeline separado.

## Por que (evidência, nov/2026)

- Nas 50 mensagens do Anwar ao bot, as perguntas que travam são de preço relativo ("o Fasano é caro,
  algo mais em conta?", "qual o mais caro?", "e o Gero? e o Picchi?").
- O catálogo não distingue: 63 de 123 restaurantes têm `price_range = expensive`, com vocabulário sujo
  ("average", "affordable", "average. good value").
- O Google também não: `priceRange` do Places no Brasil é por faixa e a de cima é aberta. 72 dos 106
  restaurantes com place_id caem em "R$ 200+" (Fasano, Gero, Picchi, Piselli, Zena…). Em 17 casas a
  curadoria diz `mid-range` e o Google diz 200+ — daí o "o Zena é intermediário… desculpe, é bem mais caro".
- O cardápio resolve: o PDF do Picchi dá principais de R$ 189–295, degustações de R$ 499/699/1.249 e
  rolha de R$ 230 (≈ R$ 350–450 por pessoa sem bebida) contra R$ 60–140 do Jamie's Italian.
- Cobertura medida no catálogo (heurística, a confirmar pela extração): 92 de 123 têm site no Google;
  ~38 páginas com preços, 18 PDFs, 8 plataformas (menu.app, Tagme, Goomer, Drive); 28 com link mas sem
  preço legível (JS, imagem, Instagram); 27 sem site. A heurística erra (site do hotel Fasano, post de
  blog do Piselli, widget de reserva do Fogo de Chão): por isso há validação na extração.

## Decisões

1. **O cardápio inteiro é uma coleção própria, `entity_menus`; a entidade recebe só um resumo,
   `menu_summary`, por `$set` do campo** — o mesmo padrão do `display_media`. Gravar pela escrita normal
   (`entity_service.upsert_entity`) subiria `version` e geraria conflito `If-Match` no Collector offline a
   cada coleta; o `$set` do campo não toca `version` nem `updatedAt`. O resumo aparece em
   `GET /entities/{id}` (campo só de leitura no modelo `Entity`).
2. **Tempo real = serve o que tem e atualiza por trás.** Extrair leva segundos (download + modelo);
   o bot espera no máximo ~2 s por fatos ao vivo. Nenhum consumidor espera a raspagem, exceto o
   `refresh` explícito.
3. **Números derivados saem do código**, a partir dos itens classificados. O modelo só lê e classifica.
4. **O valor revisado por um curador nunca é sobrescrito.** Uma mudança no site marca para revisão.
5. **"Por pessoa" = entrada + principal + sobremesa, sem bebida e sem os 13% de serviço** (decidido em
   2026-11-26). É a medida comparável entre casas; o bot diz isso quando cita o valor ("sem bebida").
6. **Uma única fronteira de rede:** o download reaproveita a de `og_image_service` (hook
   `_validate_image_request_hook` contra SSRF em cada redirect, teto de bytes, retry), com teto próprio
   para PDF.

## Modelo de dados — `entity_menus`

Um documento por entidade (`_id = entity_id`):

```jsonc
{
  "_id": "entity_ChIJ...",
  "website": "https://restaurantepicchi.com.br",
  "sources": [                           // o cardápio inteiro: comida, bebidas, carta de vinhos, almoço…
    {
      "url": "https://restaurantepicchi.com.br/.../CARDAPIO_SETEMBRO_2026.pdf",
      "kind": "pdf | html | platform | image",
      "covers": "food | drinks | wine | lunch | dessert | full",
      "found_via": "website_link | website_home | web_search | manual",
      "fetched_at": "2026-11-26T12:00:00Z",
      "content_hash": "sha256:…",      // do texto extraído; igual = não chama o modelo para esta fonte
      "menu_date": "2026-09"             // se o próprio documento declara (ex.: "SETEMBRO 2026")
    }
  ],
  "items": [                             // TODOS os itens de todas as fontes; sem teto; sem texto bruto
    {"source": 0, "section": "main", "subsection": "Massas", "name": "Fettuccine ao ragu de pato",
     "description": "...", "price_brl": 260.0, "tags": ["pasta", "meat"], "meal": "dinner|lunch|all"},
    {"source": 1, "section": "drink", "subsection": "Tintos — Itália", "name": "Barolo …",
     "prices": [{"label": "taça", "brl": 89.0}, {"label": "garrafa", "brl": 690.0}],
     "wine": {"producer": "…", "vintage": 2019, "region": "Piemonte", "grapes": ["nebbiolo"]}}
  ],
  "derived": {
    "per_person_brl": {"lunch": 310, "dinner": 380, "basis": "starter+main+dessert", "partial": false},
    "main_brl": {"p25": 196, "median": 247, "p75": 260},
    "starter_brl": {...}, "dessert_brl": {...},
    "executive_lunch_brl": null,
    "tasting_menus": [{"name": "Tradizione", "price_brl": 699}],
    "couvert_brl": 36, "corkage_brl": 230,
    "drinks": {"wine_by_glass_brl": {"median": 75}, "wine_bottle_brl": {"min": 190, "median": 420},
               "cocktail_brl": {"median": 58}, "wine_labels": 240},
    "tags": ["vegetarian_options", "seafood", "light_options"]
  },
  "status": "auto | reviewed | needs_review | rejected | not_found",
  "review": {"by": "anwar@lotier.com", "at": "...", "overrides": {"per_person_brl.dinner": 420}, "note": ""},
  "extraction": {"model": "...", "config": "menu_extraction_text", "is_menu_of_this_place": true,
                 "confidence": 0.9, "rejected_reason": null},
  "refresh": {"lease_until": null, "last_error": null, "attempts": 0, "next_allowed_at": "..."},
  "updatedAt": "..."
}
```

- `section` ∈ `starter | main | dessert | side | drink | tasting | executive | couvert | corkage | other`.
- **Coleta o cardápio inteiro**, inclusive bebidas e carta de vinhos: "sem bebida" vale só para o
  `per_person_brl`; os demais itens servem a pratos, opções leves/vegetarianas, vinho em taça, rolha etc.
  Um item com mais de um preço (taça/garrafa, meia/inteira, por pessoa/para dois) usa `prices`; com um
  só, `price_brl`. Item sem preço também entra (`price_brl: null`).
- Tamanho esperado: ~10–50 KB por restaurante; uma carta de vinhos grande (~1.000 rótulos) chega a
  ~250 KB, longe do limite de 16 MB por documento. Para ~150 casas, poucos MB. O Atlas está no plano de
  512 MB (incidente 2026-08-12): coletar **só** entidades curadas, com curadoria em coleção, ou pedidas
  explicitamente — nunca as ~21,6 mil em massa.
- Índices: `_id` basta para leitura; `status` + `updatedAt` para o script de refresh. Entra em
  `index_specs.py` (o teste `test_db_rebuild` conta specs — atualizar junto).

## Pipeline do `refresh`

1. **Site.** `entity.data` (website/contacts) se existir; senão `websiteUri` do Places Details
   (place_id do `entity_id`).
2. **Achar o cardápio — todas as partes.** Home do site → links cujo texto/href casa
   `cardápio|menu|carta|vinhos|drinks|bebidas|almoço|executivo|sobremesas` e PDFs → segue um nível.
   Guarda **todas** as fontes que forem cardápio (comida, bebidas, vinhos, almoço), não só a melhor;
   duplicatas (mesmo hash) entram uma vez.
   Respeita `robots.txt`; ritmo por domínio; User-Agent do Collector. Sem achado → `not_found`
   (fase 2: busca na web "cardápio <nome> <bairro>").
3. **Ler.** PDF → texto (dependência nova: `pdfminer.six` ou `pypdf`, Python puro, sem binário de sistema
   no Docker; hoje não há lib de PDF em `requirements.txt`). PDFs em duas colunas (caso do Picchi)
   misturam linhas no texto — o modelo reconstrói os pares prato/preço; HTML → texto sem
   script/estilo; plataforma → parser específico quando for JSON público; imagem → fase 2 (visão).
4. **Hash.** Por fonte: se `content_hash` igual ao gravado, atualiza só `fetched_at` dela e não a reextrai.
5. **Extrair** cada fonte que mudou, em partes (por página ou bloco de seção) para caber na saída do
   modelo; as partes são unidas e deduplicadas por (seção, nome, preço). Modelo OpenAI via registro `openai_configs` (serviço novo `menu_extraction_text`,
   gravado sozinho — nunca rodar o seed inteiro em produção). Saída estruturada (JSON schema) com
   `is_menu_of_this_place` (nome/endereço batem? é cardápio de comida e não quarto, blog, reserva?),
   itens e seções. `false` → `rejected` com motivo.
6. **Derivar** no código: medianas/percentis por seção, `per_person_brl` = mediana(entrada) +
   mediana(principal) + mediana(sobremesa) por refeição; `partial: true` quando falta seção.
   Menus degustação e executivo ficam à parte, nunca na média.
7. **Gravar.** `status = reviewed` preservado; mudança relevante (≥ 15% no `per_person` ou troca de
   fonte) → `needs_review`. Caso contrário `auto`.

## API (Collector, `/api/v3`)

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| `GET` | `/entities/{id}/menu?max_age_days=30&items=0..300` | `viewer` (inclui X-API-Key do bot) | Resposta imediata do gravado + `fresh: bool`. Faltando ou velho, agenda refresh em segundo plano e responde `refreshing: true` (com o que houver). |
| `POST` | `/entities/{id}/menu/refresh` | `curator` | Síncrono (~5–30 s). `force=true` ignora hash e intervalo mínimo. Usado pelo script e pelo Admin. |
| `PATCH` | `/entities/{id}/menu` | `curator` | Revisão: confirma (`status=reviewed`), corrige derivados (`review.overrides`) ou rejeita a fonte; aceita fontes manuais (`sources[].url`, ex.: o PDF da carta de vinhos que o site não linka). |

- **Segundo plano sem fila:** tarefa asyncio no processo, com lease em Mongo (`refresh.lease_until`)
  para não duplicar entre workers, semáforo global (ex.: 3 simultâneos) e intervalo mínimo por entidade
  (ex.: 6 h, exceto `force`). Teto diário de chamadas ao modelo em config. Sem Celery/Redis (o projeto
  não tem fila server-side).
- **Erros:** nunca devolvem texto do site ou do provedor; códigos curtos (`site_unreachable`,
  `no_menu_link`, `not_a_menu`, `extraction_failed`, `budget_exhausted`).
- **Rate limit:** `slowapi` como as outras rotas (`refresh` mais restrito que `GET`).
- **Resumo nas leituras de entidade:** `GET /entities/{id}` ganha `menu_summary` (derivados + status +
  `as_of`), anexado na leitura — a entidade não muda nem sobe versão.

## Pré-preenchimento

Script local em `scripts/python-tools/` (padrão do pipeline): percorre as entidades das coleções
curadas, chama `POST …/menu/refresh` com concorrência baixa, escreve relatório (achados por tipo,
rejeitados com motivo, `per_person` por casa) para a revisão do Anwar. Depois, mensal: o mesmo script
com `max_age_days=30` (o hash evita custo quando nada mudou).

## Consumo no bot

- `live_places.get_menu_facts(entity_id)` chama o `GET` com o mesmo cliente, timeout e cota por minuto
  dos fatos ao vivo; corre em paralelo ao prefetch existente (`ToolExecutor.prefetch`), sem espera nova.
- `get_restaurant_details` passa a trazer `menu`: `per_person_brl`, executivo, degustações, couvert,
  rolha, `as_of`, `source` (`curator | menu | google`), `status`, e até ~20 pratos com preço e tags.
  Sem cardápio, cai no `priceRange` do Google como piso, dito como tal.
- A busca ganha ordenação por `per_person_brl` quando o hóspede pede "mais em conta"/"mais caro", via
  o catálogo sincronizado — não por regra no loop.
- Prompt: dizer de onde veio e de quando ("uns R$ 400 no jantar, pelo cardápio de setembro"); nunca
  inventar preço.

## Fases

1. **Collector:** `entity_menus`, `refresh` para PDF e HTML, `GET` com atualização em segundo plano,
   `PATCH` de revisão, resumo na leitura da entidade, testes. Script de pré-preenchimento rodado no
   catálogo + relatório para o Anwar.
2. **Bot:** fatos do cardápio na ficha e preço na busca. Revisão do Anwar no Admin (Payload).
3. **Cobertura:** imagens/Instagram pelo modelo de visão, plataformas com parser, busca na web quando o
   site não linka o cardápio; atualização mensal agendada (job do Payload) com aviso de mudança.

## Testes e aceite

- Unitários com rede e modelo falsos: classificação de link, PDF/HTML → texto, hash curto-circuita,
  `is_menu_of_this_place=false` rejeita, derivados determinísticos (medianas, `partial`), revisado não
  é sobrescrito, lease impede refresh duplo, erros sem texto do provedor, SSRF bloqueado (IP privado,
  redirect para metadata).
- Fixtures de cardápio **sintéticas** no formato dos reais (duas colunas de PDF, preço "1249,00",
  "R$ 45"), não cópia de cardápio de terceiros.
- Aceite da fase 1: rodada no catálogo com ≥ 40% das casas curadas com `per_person_brl` não parcial;
  10 casas conferidas à mão contra o cardápio, erro ≤ 15%; nenhum `rejected` indevido nas 10.

## Aprendizados da implementação (fase 1, rodadas reais em 22 casas do catálogo)

- **O cardápio costuma estar a dois cliques** (home → página "Cardápio" → PDF ou plataforma): uma página
  de cardápio sem preços é seguida mais um nível, com teto de 14 downloads por refresh.
- **Sites de grupo** (fasano.com.br: Fasano, Gero, Gero Panini, Baretto… em várias cidades): sem link de
  cardápio na home, segue-se a página cujo texto/caminho tem **todas** as palavras do nome (palavra
  inteira: "Gero" não casa "Leggero") e, entre essas, a que mais casa com o endereço — **inclusive a
  cidade** ("São Paulo" escolhe "Fasano São Paulo", não "Fasano Angra dos Reis", que foi o erro antes).
- **Validação pelo modelo funciona:** no Piselli, as duas "fontes" eram matérias de blog e foram recusadas
  com o motivo.
- **Não contornamos bloqueios:** site que recusa robôs (Chef Rouge: 403 até no robots.txt) vira
  `site_refused`; certificado vencido (Zena) vira `tls_error`. O Collector se identifica e mantém a
  verificação de TLS; nesses casos o curador adiciona a fonte (`add_sources`) ou fica para a fase 3.
- **Google aponta às vezes para outra coisa:** o "site" da Casa do Porco é o widget de reserva da Tagme;
  o do Rubaiyat é um app JS sem links. Fase 3 (ou fonte manual).
- **Cardápio de delivery** entra como fonte (`covers: delivery`) mas não define o preço por pessoa quando
  há outro cardápio.
- **Couvert** é a mediana das linhas de couvert (uma linha "Pães R$ 36" não o define); **taça** só como
  palavra inteira ("Atacama" e "Jacopo" enganavam), incluindo "bicchiere" e doses em ml.
- **Tempo:** cardápios grandes (Fasano 735 itens, Ristorantino 433) levam 100–175 s; o nginx dá 300 s
  em `/api/v3`. O GET nunca espera isso.
- **Resultados (por pessoa, sem bebida):** Fasano SP R$ 514, Picchi 395, Ristorantino 390, Gero 379,
  Amadeus 348, Gero Panini 197; D.O.M. só degustação (R$ 1.400 / 2.300). Não encontrados: Jamie's
  (JS), Sal (plataforma Getin, JS), Le Bife, Cantaloup, Casa do Porco, Figueira, Chef Rouge, Zena,
  Huto Köhï (sem site no Google).

## Em aberto

1. Quem revisa além do Anwar, e se `reviewed` expira (ex.: 6 meses).
2. Se o bot mostra pratos ao hóspede (cita "o fettuccine de pato") ou só usa para decidir.
