# Passe de design, UX e performance do Admin — 2026-09-16/17

Objetivo recebido: *"improve design, UX and UI for admin, responsiveness, better use of the screen
space, good visualization of items, sizes, better color choices, improve speed and reduce latency,
standardize elements, sizes and style. Use Collector as reference."*

Este documento resume a sessão inteira. O detalhe operacional de cada item vive em
`docs/PENDENCIAS_MELHORIAS.md` (seções "Design/UX do Admin — 2026-09-16", "Lote de padronização e
performance — 2026-09-16 (parte 2)" e as notas de flake/deploy); aqui está o que foi medido, o que
foi revertido e o que continua aberto.

Estado final: gate verde (Collector **1236** testes, Admin **628**) e ambos os serviços `live` em
`e30461c6`, verificado pelo que é **servido** — não pelo que foi commitado.

---

## 1. O achado que reorganizou o trabalho

O root do Admin é **13px** (Payload) e `rem` resolve contra o root. Como a escala compartilhada do
pacote é autorada contra 16px, **cada passo computava 19% menor no Admin do que no Collector** — um
token, dois pixels, que é o oposto do que a escala existe para garantir. Medido no browser antes da
correção:

|Token|Admin (13px)|Intenção|Collector (16px)|
|---|---|---|---|
|`--cms-text-xs`|9.75px|12px|12px|
|`--cms-text-sm`|11.375px|14px|14px|
|`--cms-radius-lg`|6.5px|8px|8px|

Correção: o gerador (`scripts/design-tokens.mjs`) passou a projetar **duas cópias** do mesmo arquivo —
a do Collector (verbatim, para o `<link>` sem bundler) e a do Admin (com cada passo em `rem`
resolvido para px, ×16). Mesma fonte, mesmo byte-check no gate, nomes e intenção idênticos. O Admin
importa a cópia em px **depois** do pacote, de propósito, e há teste para a ordem.

Sem essa decisão, os 82 raios e os 415 espaçamentos teriam encolhido 19% silenciosamente.

## 2. Design, padronização e cor

|Mudança|Antes → depois (medido)|
|---|---|
|Largura útil a 1920px|1320 → **1645px**|
|Escala tipográfica por classe|literais → tokens; menor texto renderizado **12px** (era 9.75px), 4-6 tamanhos distintos por página|
|Título de página|`clamp(1.65rem, 2.4vw, 2.25rem)` → 29.25px → **36px** (`--cms-text-4xl`, o mesmo `h1` do Collector)|
|Raios|**82 literais, zero tokens** → 0 literais; painéis de 10px no passo de superfície, blocos internos de 7px encostados em `lg`|
|Espaçamento|**415 declarações, 15+ valores ad-hoc** → escala de 8 passos, desvio ≤1px por site (Collections 64 → 63px; cartão mobile 178 → 181px)|
|Cores semânticas|rampas do Payload (success/error/warning/info) nos três tons da marca; pill "Active" medido `#2f5239`|
|CSS morto|`curation-explorer*` + `explorer-filter-form*` removidos — **131 linhas**, 0 referências|
|Fundação|pacote de tokens compartilhado, `next/font` com as três famílias da marca, moldura de página única|

Guarda de padronização (4 testes, com dentes verificados): nenhum `border-radius` fora da escala,
nenhuma propriedade de espaçamento em `rem`, paridade pacote × Collector × Admin, e a aritmética
`rem × 16` da projeção.

## 3. Responsividade

A lista de Collections declarava `min-width: 760px`: medido a 390px, o wrapper rolava **396px** de
lado e só **1 das 5** colunas cabia. Abaixo de 900px cada linha vira cartão com rótulos
(`data-label` via `::before`) — nenhuma coluna escondida.

|Largura|Modo|Rolagem lateral|Overflow do documento|
|---|---|---|---|
|390|cartão|0|0|
|768|cartão|0|0|
|899|cartão|0|0|
|901|tabela|0|0|
|1024|tabela|0|0|
|1440|tabela|0|0|

O limite é 900px e não 760px porque 760 é o `min-width` da própria tabela, sem contar a moldura — a
768px ela ainda rolava 25px. Varredura das 7 páginas do Admin em todas as larguras: overflow 0.

## 4. Performance e latência

|Item|Antes → depois (medido)|
|---|---|
|Cache da mídia no BFF|`withAdmin` forçava `private, no-store` sobre o `private, max-age=…` do FastAPI: cada visita **re-baixava cada thumbnail** e re-executava o pipeline de fetch+reencode do upstream → frescura preservada|
|Carga fria do Collector|236 requisições / **0 fotos** → **108 / 39**; com o prefetch adiado, **122 / 40** e a página 2 aquecida depois do dreno|
|Prefetch|era **cancelado** sob carga (o timer só é armado no `_queue`) → passou a ser **adiado** e rearmado no dreno, então continua aquecendo a próxima página sem disputar conexão com o que o usuário vê|
|Thumbnail na lista de Entities|não existia → miniatura por linha, virtualizada, `loading="lazy"`, sem moldura quebrada quando não resolve|

A exceção de cache tem limite explícito: `private` é a linha, e `public`/`s-maxage` junto de
`private` é sobrescrito — um valor contraditório não pode levar resposta autenticada a um cache de
proxy. A cadeia está pinada **nas duas pontas com prova executada**: `pytest
tests/test_catalog_media.py` (**9 passed**, asserção de `private, max-age={TTL}` no caminho 200) e 27
casos em `apps/admin/tests/unit/http/` (sem a checagem de `private` falham 7; sem o aperto de
`public`/`s-maxage` falham 2).

## 5. Erros meus, revertidos

1. **Sobrescrevi um arquivo de teste com `write`.** `apps/admin/tests/unit/http/with-admin.test.ts` já
   existia (16 casos) e foi substituído — a suíte caiu de 621 para 611 e eu só percebi porque comparei
   as contagens. Restaurado verbatim do git; os casos novos de cache foram para o arquivo dedicado
   (`with-admin-cache-policy.test.ts`), onde pertenciam.
2. **Removi um caminho de recuperação com evidência que não o sustentava.** Cortei o fallback legado
   de imagem alegando duplicação; a medição mostrava falha **rápida**, não timeout (116 chamadas em
   25s, antes de qualquer limite), ou seja media-se volume, não latência. Revertido com o porquê no
   código; o corte foi movido para onde o volume nasce (o prefetch).
3. **Escrevi `no-store` como sintoma universal.** Um 404 de entidade sem imagem devolve `no-store` de
   propósito; a leitura vale só para respostas 200.

## 6. Hipóteses que a medição derrubou (não viraram mudança)

- **Cadeia serial de chamadas no BFF** — medido: 3-4 chamadas `/api/admin` por página, TTFB 162-309ms.
  Não havia cadeia para paralelizar.
- **Projeção pesada (`transcript`) no registro** — não localizei nenhuma projeção assim nos caminhos
  que o Admin lê; a tentativa de medir bytes voltou inconclusiva. Retirado por falta de evidência.
- **Latência de página em `next dev`** — Turbopack compila por rota; número de dev não é número de
  produto.
- **Encolhimento dos raios/espaçamento** — investigado e resolvido pela projeção em px (seção 1), não
  por remap caso a caso.

## 7. Aberto

**Buracos deste trabalho (4):**

1. Thumbnail com imagem **real** nunca foi visto: o CMS local é fixture de E2E e todas as imagens dão
   404. O comportamento está verificado (404 não deixa moldura; a imagem de 34px é menor que o
   conteúdo de 41px, então a linha fixa de 48px não cresce), o visual não.
2. `security-config.test.ts` é um **flake**: 2 falhas em 12 execuções, com duas hipóteses testadas e
   derrubadas (env do gate; pipe na saída). Suspeita de timing no `import` de `payload.config`, não
   diagnóstico. Regra: rerun antes de investigar.
3. **Todo push em `main` reinicia o container fusionado** — `autoDeployTrigger = commit`, sem
   `buildFilter` (lido do topo do JSON do serviço). O 502 não é garantido (uma medição deu ~90s, outra
   respondeu 200 durante o `update_in_progress`), mas o gatilho é. Regra: agrupar doc com o próximo
   commit funcional. Conserto durável = `buildFilter` com `ignoredPaths`; **não** usar
   `autoDeployTrigger: checksPass`, porque o CI do GitHub foi removido por billing e o gatilho
   esperaria checks que nunca chegam.
4. Divergência de marca **não resolvida**: `--cms-olive-500: #596f42` × `--color-primary: #5c6b4a` —
   dois verdes para o mesmo papel. É decisão de identidade.

**Do usuário (não são deste trabalho):** rotação do client id/secret OAuth vazado em docs (adiada),
usuários scoped no Atlas (precisa de acesso à API do Atlas), reativar o GitHub Actions (billing),
`frame-ancestors` no static site (header de dashboard), limpeza das 53 curadorias órfãs
`entity_curation_test_*` (destrutivo), e a decisão sobre `cleanupBrowserData` (denylist deliberada).

**Qualificação:** `verify:full` continua nunca rodado ponta a ponta — e passou a pesar mais, porque o
lote visual mexeu em escala, raios, espaçamento e breakpoints, e o Playwright é o único gate que vê
isso num browser real. As 4 falhas de integração do Admin com Mongo local são **pré-existentes**
(medidas contra worktree limpo).

## 8. Método (o que sustenta as afirmações acima)

- Números antes → depois vieram do browser, não de leitura de CSS: alturas de linha, tamanhos
  renderizados, rolagem lateral, overflow de documento, contagem de requisições e status, em 390, 768,
  899, 901, 1024, 1440 e 1920.
- Produção foi conferida pelo **conteúdo servido**: o módulo JS do Collector (4 marcadores) e o CSS do
  Admin baixado de `/_next/static/*.css` — com **controle** para a remoção de CSS morto (classes vivas
  do mesmo arquivo presentes, as removidas ausentes), porque ausência sem controle não prova nada.
- Cada guarda de padronização foi testada com dentes: quebra-se a condição e o teste tem de falhar
  (7 e 2 casos na política de cache, 1 na guarda de raios, 1 na de espaçamento).
- Quando a medição não sustentou a hipótese, a hipótese saiu (seção 6) — e quando eu afirmei algo sem
  checar (que o Admin estava `live` num commit que eu tinha acabado de empurrar), a correção foi
  registrada com a medição que a contradiz.

## Anexo — commits do período

42 commits entre `2a255e23` e `e30461c6` (71 arquivos, +3918/−898). Deste passe:
`05dde184` fundação de design · `95fc2c53` escala e rampas · `b185c691` escala em px e raios ·
`d589355f` cartões mobile · `7cc0dc96` thumbnail · `10d3c4f1` CSS morto · `335e6687` título ·
`9722fe15` breakpoint · `b2de06ab` política de cache · `4e915e1d` frescura `private` ·
`3dd5306d`/`867ec945` prefetch do Collector · `f8940c66` restauração dos testes.
O restante da sessão (fora do design): OOM do container por heap V8, ordenação em memória do catálogo
que devolvia 503, `catalog_sequence` e o scan do acervo, o espelho de usuário do Admin, o
`localStorage` apagado no boot do Collector, o seletor "Browse" do capture e a qualificação em produção
— todos com commit próprio e detalhe em `docs/PENDENCIAS_MELHORIAS.md`.
