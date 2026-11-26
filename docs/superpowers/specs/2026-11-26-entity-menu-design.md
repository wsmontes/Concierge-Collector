# Cardápio da entidade (scraping sob demanda + pré-preenchimento) — Design

**Status:** v1 publicada em 2026-11-26 (extração item a item + heurísticas); **v2 (coleta ampla do site +
triagem + ficha por LLM)** implementada na branch `feat/entity-menus`, testada localmente em 77 casas,
ainda não publicada.
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

1. **Três passos: coleta ampla, triagem e ficha.** O código **coleta** o site inteiro com teto (sitemap +
   links internos + plataformas de cardápio, até 40 páginas, 2 níveis, 90 s), na ordem do mais promissor;
   um **modelo leve** lê url, título e começo de cada página e diz o que é útil para o concierge desta
   unidade (e de que assunto); só as páginas úteis guardam o texto; um **modelo forte** lê as úteis e
   escreve a **ficha**: cardápio e preço por pessoa **e fatos da casa** (reserva, horário, eventos, chef,
   rolha, crianças, pets, estacionamento…), cada fato com o trecho literal que o sustenta. Revisão de
   2026-11-26 (v2): a v1 extraía item a item e derivava números por heurística (medianas, regex de taça,
   filtro de delivery, couvert) — frágil e errada nos casos que importam (Charlô: loja de Natal lida como
   cardápio, R$ 3.562; Fogo de Chão: rodízio tratado como à la carte). Limpar por heurística não escala;
   quem lê o cardápio decide.
2. **O código só verifica a ficha, não interpreta.** Os pratos que o LLM cita como base do preço por
   pessoa precisam ter o preço citado no texto bruto do documento citado; a soma é refeita no código.
   Preço não encontrado no texto, ou preço afirmado com confiança baixa → `needs_review`. Um fato da casa
   cujo trecho não está na página (palavras em ordem numa janela curta, porque colunas de PDF se
   intercalam) é deixado de fora e registrado, sem bloquear a ficha. Site sem preço publicado mas com
   fatos tem ficha normal (`auto`).
3. **Sem lista estruturada de itens.** Ficha + texto bruto cobrem o chat; a lista custava caro e era
   frágil. Volta só se surgir busca no catálogo inteiro por prato/preço.
4. **No chat: ficha pronta + bruto sob consulta.** A ficha (~300 tokens) vai no cartão do restaurante.
   Pergunta específica ("tem ostra?", "quanto é o Barolo?") → `GET /entities/{id}/menu/text?q=` devolve
   trechos do bruto (busca por palavra, sem LLM; ~6 mil caracteres) para o próprio modelo do bot ler.
   **Nunca** se raspa site durante a conversa.
5. **A entidade recebe só um resumo, `menu_summary`, por `$set` do campo** (padrão `display_media`): não
   sobe `version`, não gera conflito `If-Match` no Collector offline.
6. **O valor revisado por um curador nunca é sobrescrito.** Mudança relevante marca para revisão.
7. **"Por pessoa" = entrada + principal + sobremesa, sem bebida e sem os 13% de serviço.** Rodízio e
   preço fixo usam o próprio preço por pessoa.
8. **Uma única fronteira de rede** (hook SSRF em cada redirect, teto de bytes, robots.txt, sem disfarce
   de User-Agent, TLS verificado).

## Modelo de dados — `entity_menus` (um documento por entidade, `_id` = `_id` da entity)

```jsonc
{
  "website": "https://fogodechao.com.br/location/jardins/",
  "pages": [                         // tudo que foi coletado, com o veredito da triagem, SEM texto
    {"index": 0, "url": "…", "kind": "html|pdf|platform", "title": "…", "found_via": "website_home|
     website_link|sitemap|manual", "content_hash": "sha256:…", "chars": 4120, "useful": true,
     "topics": ["reservations", "hours_location"], "reason": "página da unidade com endereço e reserva"}
  ],
  "documents": [                     // só as páginas úteis, com texto (teto 80 mil caracteres cada)
    {"index": 0, "url": "…", "kind": "…", "title": "…", "topics": ["menu"], "found_via": "…",
     "fetched_at": "…", "content_hash": "…", "chars": 18234, "truncated": false, "text": "…"}
  ],
  "brief": {                         // decidida pelo modelo forte, verificada pelo código
    "documents": [{"index": 0, "role": "dining_room|delivery|orders_or_shop|drinks|event|other_unit|
                   not_a_menu|other", "note": "…"}],
    "formats": ["a_la_carte", "rodizio", "tasting", "executive", "buffet", "prix_fixe"],
    "per_person_brl": {"lunch": 190, "dinner": 354}, "per_person_fixed": {"lunch": true, "dinner": false},
    "per_person_basis": {"dinner": [{"item": "Burrata", "price_brl": 110, "document": 0}, …]},
    "executive_lunch_brl": 190, "tasting_menus": [{"name": "…", "price_brl": 699, "courses": 6}],
    "couvert_brl": 55, "corkage_brl": 230, "wine": {"by_the_glass": true, "bottle_min_brl": 152, …},
    "dietary": ["vegetarian"], "highlights": ["…"], "caveats": ["…"], "summary": "cardápio, em pt-BR",
    "menu_date": "2026-09", "confidence": "high|medium|low",
    "facts": [{"topic": "corkage|reservations|hours|kids|pets|parking|…", "fact": "em pt-BR",
               "evidence": "trecho literal do site", "page": 3}],
    "house_summary": "3 a 5 frases sobre a casa, em pt-BR"
  },
  "synthesis": {"model": "…", "at": "…", "version": 2, "input_hash": "…", "issues": [ … ], "error": null},
  "status": "auto | reviewed | needs_review | not_found",
  "review": {"by": "…", "at": "…", "overrides": {"per_person_brl.dinner": 420}, "note": ""},
  "rejected": [{"url": "…", "reason": "site_refused"}], "manual_sources": ["…"], "last_error": null,
  "refreshed_at": "…", "next_allowed_at": "…", "lease_until": null, "updatedAt": "…"
}
```

- Espaço: ~100–300 KB por casa (só as páginas úteis guardam texto); ~150 casas curadas cabem com folga no
  Atlas de 512 MB. Nunca coletar as ~21,6 mil em massa.
- `entities.menu_summary` (por `$set` do campo): preço por pessoa, formatos, executivo, degustação mínima,
  couvert, rolha, dietas, resumo do cardápio, `house_summary` e `fact_topics`.
- Campos da v1 (`sources`, `items`, `derived`) são removidos na próxima gravação de cada documento.

## Pipeline do `refresh`

1. **Site:** `entity.data` ou `websiteUri` do Places.
2. **Coletar:** home → fila por prioridade (seção e nome da unidade, PDFs, cardápio/reserva/eventos/sobre
   primeiro; blog e notícias por último; um link revisto com motivo melhor sobe na fila) + página da
   unidade em sites de grupo + `sitemap.xml` + fontes manuais do curador. Até 40 páginas, 2 níveis, 5
   downloads em paralelo, 90 s. Página só de links é seguida mesmo sem texto. Bloqueios não são
   contornados (`site_refused`, `tls_error`).
3. **Triar** (serviço `site_triage_text`, modelo leve): só páginas cujo texto é novo; as demais mantêm o
   veredito anterior. Fonte manual do curador é sempre útil.
4. **Sintetizar** (serviço `menu_synthesis_text`, modelo forte): só quando as páginas úteis mudaram (ou
   `resynthesize`). Teto total de ~150 mil caracteres, dividido de forma justa entre as páginas.
5. **Verificar:** soma refeita; preços conferidos no texto (inclusive o "5858" de PDFs que repetem cada
   número); trecho de cada fato conferido na página.
6. **Gravar:** sem cardápio e sem fatos → `not_found` (`nothing_useful`); preço com pendência →
   `needs_review`; revisão do curador preservada salvo mudança ≥ 15% ou outros documentos de salão.

## API (Collector, `/api/v3`)

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| `GET` | `/entities/{id}/menu` | `viewer` (inclui X-API-Key do bot) | Ficha + status, imediato. Faltando ou velho: agenda refresh em segundo plano (`refreshing: true`). Sem texto bruto. |
| `GET` | `/entities/{id}/menu/text?q=&topic=&max_chars=6000` | `viewer` | Trechos das páginas úteis que casam com `q` (sem acento/caixa), cardápio do salão primeiro; `topic` (menu, reservations, hours_location, events_private_dining, amenities_policies…) restringe às páginas com esse assunto. Para o chat consultar detalhe. |
| `POST` | `/entities/{id}/menu/refresh?force=&resynthesize=` | `curator` | Coleta + triagem + ficha, síncrono (mediana ~45 s, até ~3 min em site lento). `resynthesize=true` refaz só a ficha sobre as páginas gravadas (sem rede). |
| `PATCH` | `/entities/{id}/menu` | `curator` | Revisão: status, overrides na ficha por caminho, nota, fontes manuais. |

Segundo plano: fila em memória limitada, um consumidor, deduplicada; lease no Mongo; intervalo mínimo
por entidade; teto diário de sínteses. Erros com códigos curtos, nunca texto do site ou do provedor.

## Pré-preenchimento

`scripts/python-tools/prefill_menus.py`: `POST …/refresh` com concorrência baixa e relatório JSONL
(status, papéis dos documentos, por pessoa, confiança, pendências de verificação). `--resynthesize`
refaz só as fichas (rápido, para iterar o prompt ou corrigir valores).

## Consumo no bot (fase 2)

- A ficha (`summary`, `house_summary`, fatos, por pessoa, formatos, executivo, degustação, couvert,
  rolha, dietas, `as_of`, status) entra no cartão do restaurante. Horário: o do Google vale em conflito
  com o do site (o site costuma estar desatualizado); a divergência pode ser dita. Sem ficha, o `priceRange` do Google como piso, dito como tal.
- Ferramenta `menu_lookup(restaurant, question)` → `GET …/menu/text?q=` para perguntas de detalhe.
- O bot diz de onde veio e de quando ("uns R$ 400 no jantar, sem bebida, pelo cardápio de setembro");
  `needs_review` não é citado como valor firme.

## Fases

1. **Collector (v2):** bruto + ficha + verificação, `GET`/`text`/`refresh`/`PATCH`, prefill no catálogo.
2. **Bot:** ficha no cartão e `menu_lookup`.
3. **Cobertura:** foto do cardápio pelo app (transcrição vira documento bruto), plataformas (Getin,
   Goomer, menu.app), JSON-LD `hasMenu`, busca na web; atualização mensal agendada.

## Testes e aceite

- Unitários com rede e modelo falsos: coleta guarda o bruto; hash igual não chama o modelo; verificação
  marca preço inventado e confiança baixa; soma refeita; rodízio usa preço fixo; revisado não é
  sobrescrito; trechos do bruto por palavra sem acento; lease; erros sem texto do provedor.
- Aceite: Charlô sem o valor da loja de Natal, Fogo de Chão como rodízio; ≥ 10 casas conferidas à mão
  com erro ≤ 15%.

## Teste da coleta ampla (2026-11-26, 77 casas, local, nada gravado)

- 72/77 com ficha; **34 com preço por pessoa** (a coleta só de cardápio tinha 16 nessas casas); 981 fatos
  com trecho conferido, mediana de 14 por casa, 1% descartados sem evidência.
- Casas com fato por assunto: chef/conceito 64, horário 61, reserva 59, acesso 59, ambiente 52, pratos
  assinatura 46, dietas 41, eventos 39, prêmios 32, pagamento/serviço 21, rolha 17, crianças 12; traje,
  acessibilidade e pets aparecem pouco (os sites raramente dizem).
- A triagem separa outras unidades bem (Gero: 32 de 34 páginas eram de outras casas do grupo Fasano).
- Tempo por casa: mediana 40 s; site lento (Sal) passava de 3 min só na coleta → teto de 90 s na coleta.
- Tokens: triagem ~3,5k entrada / 0,75k saída por casa; ficha ~8k / 1,9k (medianas).
- Variação a acompanhar: o "preço típico" do Fogo de Chão saiu R$ 259 (rodízio completo, num PDF da
  unidade) numa rodada e R$ 139 (um corte) em outra, conforme o PDF entrou ou não na coleta.

## Aprendizados da v1 (rodadas reais no catálogo)

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
- **Heurísticas de interpretação falharam e saíram na v2:** filtro de delivery, couvert por mediana, taça
  por regex ("Atacama", "Jacopo"), medianas por seção. O prefill v1 (106 casas, 22 com cardápio) gravou o
  Charlô a R$ 3.562 (loja de Natal) e o Fogo de Chão como à la carte parcial (é rodízio).
- **Tempo:** cardápios grandes (Fasano 735 itens, Ristorantino 433) levam 100–175 s; o nginx dá 300 s
  em `/api/v3`. O GET nunca espera isso.
- **Resultados (por pessoa, sem bebida):** Fasano SP R$ 514, Picchi 395, Ristorantino 390, Gero 379,
  Amadeus 348, Gero Panini 197; D.O.M. só degustação (R$ 1.400 / 2.300). Não encontrados: Jamie's
  (JS), Sal (plataforma Getin, JS), Le Bife, Cantaloup, Casa do Porco, Figueira, Chef Rouge, Zena,
  Huto Köhï (sem site no Google).

## Em aberto

1. Quem revisa além do Anwar, e se `reviewed` expira (ex.: 6 meses).
2. Se o bot mostra pratos ao hóspede (cita "o fettuccine de pato") ou só usa para decidir.
