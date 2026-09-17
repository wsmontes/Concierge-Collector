# Admin como produto + contrato de mídia — passe de 2026-09-17

Objetivo recebido: *"repensar o front-end da interface admin baseado nos melhores CMS do mundo —
bonito, elegante, fácil de usar, poderoso e flexível"*, com o goal fechando apenas em produção
funcional. No meio do trabalho veio a revisão do usuário, que reorganizou as prioridades: o Admin
era **fundação de UI**, não produto; era preciso tirar o Payload da frente do operador; e a mídia
do Collector precisava de contrato (`evidence` × `display`) com a descoberta fora do render path.

Este documento registra o que foi medido, decidido e verificado. Commit inicial `270dfadd`,
limpeza `e2cdd547`.

---

## 1. Ponto de partida (medido, não estimado)

| Fato | Medida | Fonte |
|---|---|---|
| Admin é Payload 3.86 + Next 16 com 9 telas custom | 77 componentes, 15 CSS, 4.503 linhas | inventário de código |
| Primitivos do Payload em uso | **3** (`Button`, `Pill`, `Banner`) | grep |
| Overlays caseiros | **10** (7 dialogs, 3 drawers), 4 backdrops copiados, 3 sem `aria-modal` | CSS + TSX |
| Gramáticas de tabela | 3 (1 `<table>`, 2 `div[role=table]`), 2 `COLUMN_WIDTH` | `CollectionsWorkspace`, `CurationTable`, `EntityTable` |
| Tokens referenciados e inexistentes | `--cms-limestone-500`, `--theme-elevation-600` ×9, `-150/250` com literal | CSS |
| Mapeamento `--theme-*` | ~200 declarações, **40 degraus semânticos colapsados em 3 hex** | `admin.css` |
| Camada CSS | `:root` **fora de `@layer`** → anulava o dark do Payload | `admin.css` |
| Logout na sidebar | **não existia** | `CmsNav` |
| Menu | expunha `Consumer Applications (records)` e `Consumer Credentials (records)` | `nav-groups.ts` |
| Produção | **502 em todas as superfícies** durante a sessão; 5 OOM em 2 dias; baseline 445 MB de 512 MB | log do Render + API de métricas |
| `/admin/operations` | caía no error boundary do Next ("This page couldn't load") | captura autenticada |

O acervo tem **21.604 Entities** e o card do Collector resolvia a imagem **a cada request**
(descoberta de site + Places + download + PIL + ranking), sem persistir nada: a única memória do
resultado eram caches em processo e o Cache Storage do navegador.

---

## 2. Decisões e o que elas evitam

| Decisão | Motivo |
|---|---|
| `--theme-*` **dentro de `@layer payload-default`**, com bloco `html[data-theme='dark']` próprio | Fora de camada, o `:root` vencia o dark mode do Payload (que vive na camada) — o modo escuro não invertia nada |
| Kit de componentes em `src/components/ui/**` envolvendo primitivos do Payload (`Modal`, `Drawer`, `Popup`, `ShimmerEffect`) | O acoplamento fica num diretório; o Payload 4 vai reescrever o admin e remover SCSS — wrappers sobrevivem, forks não |
| Dashboard por `admin.dashboard.widgets` | O Payload fixa `DashboardView` em `/admin`; a alternativa era continuar injetando bloco dentro do dashboard alheio |
| Navegação sem Collection interna | "(records)" era o menu dizendo qual tabela está por trás da tela |
| Sem backfill de mídia (decisão do usuário) | O custo do Google Places para 19.430 Entities é real; o enriquecimento sob demanda cobre o que é visitado |
| Runner de jobs dentro do processo do Admin | Era o processo mais caro que dava para eliminar sem perder semântica (carregava uma segunda cópia de Payload só para drenar fila) |

---

## 3. O que mudou

### Admin — fundação
`theme.css` (tokens, claro e escuro, com rampas de 4 papéis por tom), `kit.css` (1.182 linhas: página,
seção, cartão, KPI, tabela, chip, diálogo, gaveta, menu, campo, abas, esqueleto, vazio, erro, aviso,
movimento, responsivo) e `ui/**` (24 componentes). O `admin.css` caiu de **619 para 98 linhas**: virou
a cola com o Payload (tipografia, foco, alvo de toque, alto contraste). `explorer-admin.css` saiu.

### Admin — casca e telas
Nav com marca, pílula de busca, ícone por seção e **bloco de conta com logout** (não existia); ações
de cabeçalho (busca, atalhos, tema); paleta de comandos com **ações** além da busca; dashboard com
contadores de Curation + **cobertura de mídia** e os painéis *Recently updated* e *Pipeline*. As 9
telas migradas para o kit com esqueletos, vazios com ação e erro com retry — `/admin/operations`
deixou de cair no boundary do Next (verificado em produção).

### Mídia — `evidence` × `display`
- `display_media` persistido na Entity: `state`, `kind`, `provider_ref` **opaco**, dimensões, score,
  validade, tentativas, código curto de erro e **`source_fingerprint`** (hash da fonte).
- A leitura serve a referência persistida; a **descoberta sai do render path**. `resolved` só é
  gravado depois de a referência durável ser **provada** (um fetch que devolve imagem).
- Segurança: a URL de Places carrega `?key=`, então nada dela é persistido — só o nome opaco, com a
  URL assinada reconstruída no servidor. O filtro de log do repo passou a cobrir `?key=` **e a viver
  nos handlers** (filtro em logger raiz não pega registro propagado de logger filho — era o buraco).
- Cadência: referência morta (`http_403/404/410/invalid`) retenta em 24h; falha transitória em 1h;
  o backoff persistido é o que decide (antes era ignorado e tudo caía no cooldown de 60s).
- Fila limitada (200) com consumidor único e **sem descarte da carga fria**; itens guardam
  identidade, não o documento.
- Collector: cache negativo de 7 dias/10 min para **30 min/60 s**, limitado pelo `max-age` do
  servidor.
- Contadores honestos: `without_images` vira **"Without evidence media"**; entra a cobertura de
  display media, contada do **dado atual** (sem fonte / resolvido e válido / o resto), com partição
  que fecha.

### Capacidade
O runner de jobs passou a viver no processo do Admin (`instrumentation.ts` →
`jobs/inProcessRunner.ts`): `handleSchedules` antes de `run`, lote de 10 **sequencial**, agendamento
recursivo (sem sobreposição) e guarda contra ciclo lento. `CMS_JOBS_INPROCESS=false` reverte.

---

## 4. Verificação executada

| Verificação | Resultado |
|---|---|
| `npm run verify` (11 passos) | **verde**, com o FastAPI local de teste no ar (a integração do Collector rodou, não pulou) |
| Admin unit | 727 testes |
| API unit | 645 |
| Mídia (display media) | 26 |
| Runner in-process | 6 (ordem, lote, sem sobreposição, retry, desligamento, intervalo) |
| Backfill | 13 |
| Guardas de token/contraste | 7, com prova de dente (quebrar camada, token e contraste faz falhar) |
| E2E de autoração (Collector) | verde em 5 execuções: criar → salvar → reload → editar → rascunho sobrevive a fechar a página → retomar → sync → conferir na API (conceitos, provenance, Entity) |
| Guardas do E2E de autoração | recusa banco sem `-test`, alvo fora de loopback e origem sem CORS — antes de abrir browser |
| Produção | `/api/v3/health`, `/admin`, `/health` em 200; as telas verificado no browser autenticado |
| Produção — mídia | `display_media` real no banco: **29 `resolved`** (refs opacas de Places + URLs de site), 2 `failed`, 21.573 pendentes |
| Produção — contador | "With a display image: 29", "No source at all: 2.174", "Not yet resolved: 19.401" — soma 21.604 |
| Produção — memória | **428-430 MB** sob rajada de 30 imagens + navegação (baseline antes do passe: 445 MB, com OOM a cada pico) |

---

## 5. Erros meus, corrigidos

1. **Fila que descartava.** A primeira versão do enriquecimento resolvia um item e descartava os
   outros 29 de uma carga fria. Substituída por fila limitada com consumidor único.
2. **Localizador mutilado.** Cheguei a "limpar" a query da URL e persistir o resto: isso cria um
   localizador que se sabe inválido e cujo retry redescobre o mesmo vencedor. Terminou com prova da
   referência no enriquecimento + retry raro por classe de erro.
3. **`$nin` que casa com campo ausente.** A cláusula de "tem fonte?" marcava quase todo o acervo
   como fonte, zerando `no_sources`. Corrigida com `$exists` + `$type`.
4. **Bloco de saúde duplicado.** Um patch meu duplicou `content_health`/`_facet_count`, e a
   definição antiga vencia em silêncio. Removido, com teste da partição.
5. **`global` faltando no contador de descartes** — `UnboundLocalError` que só apareceria no dia em
   que a fila enchesse.
6. **`setState` síncrono em efeito** (7 ocorrências de lint, 5 minhas/dos agentes): resolvido por
   estado derivado e por um relógio compartilhado (`useNow`), não por `eslint-disable`.
7. **Remoção de CSS por script quebrou seletores multi-linha.** Recuperado reescrevendo `admin.css`
   à mão, com a lista de classes órfãs levantada por referência no código antes de apagar.

---

## 6. Hipóteses que a medição derrubou

- **"Recusar URL com query é a regra segura."** Recusar jogaria fora toda imagem com `?v=`/`?w=` —
  boa parte do acervo. A regra correta é provar a referência durável e pagar o caso assinado na
  cadência, não na referência.
- **"Um job por ciclo basta."** Sequencial com lote de 10 dá o mesmo pico (um job ativo) com 10× a
  vazão; com 1, publicação ficaria atrás de heartbeat/reconciliação.
- **"Subir o teto do heap do Next agora que o quarto processo saiu."** Revertido para 200 MB: a
  folga a 512 MB ainda não foi medida, e subir teto sem prova troca um OOM por um processo maior que
  ninguém verificou.
- **"O contador de mídia estava mentindo."** Não: ele lia o dado antes de o enriquecimento rodar. A
  contradição aparente (0 resolvido × 200 na imagem) era ordem no tempo — e é o contador atualizando
  de 0 para 29 que prova o laço inteiro.

---

## 7. Aberto (honesto)

1. **Backfill não rodado** (decisão do usuário). 21.573 Entities seguem pendentes e serão resolvidas
   conforme forem visitadas; a ferramenta existe e foi medida em `--dry-run`.
2. **Cache positivo do navegador não invalida por mudança de fonte.** O servidor recusa um fato cuja
   fonte mudou, mas o Cache Storage do Collector guarda o 200 para sempre por chave — trocar o
   website de uma Entity só aparece depois de "Refresh photos". Corrigir exige versionar a chave do
   cache pelo fato persistido.
3. **Um fetch+reencode por hero frio continua no caminho.** Sem bucket durável (não existe em
   produção), persistir os bytes processados é o próximo passo; hoje o decode é um por hero, com
   concorrência 1, não o crawl de candidatos.
4. **Folga de memória a 512 MB com o runner in-process não foi medida sob carga sintética**; a
   evidência é produção (428-430 MB estável), não um teste de carga local.
5. **Flakes conhecidos:** `security-config.test.ts` (import de `payload.config` sob carga paralela) e
   a suíte do Collector com IndexedDB quando o gate roda em paralelo. Regra da casa: rerun antes de
   investigar — feito, e ambos passam isolados.
6. **`cacheRead: 0`** nos providers Z.ai e Alibaba segue aberto (multiplicador de custo de ~5×, se
   for limitação de reporte).

---

## 8. Método

- Números antes/depois vêm de execução: `npm run verify`, suítes por arquivo, API de métricas do
  Render (memória por minuto), consulta direta ao Mongo (`display_media` por estado), e o Admin de
  produção autenticado via `ops-login` + handoff.
- Cada guarda nova foi testada **com dentes** (quebrar a condição e ver o teste falhar), e as
  estimativas que não se sustentaram saíram do código em vez de virar comentário.
- Quando um agente de execução mediu um defeito no kit (especificidade em modo empilhado, `Esc` sem
  chegar ao dono do estado, `id` duplicado no picker, checkbox aninhado com toggle duplo), o
  conserto foi na origem — não no chamador.

---

## 9. Segundo passe: o que a revisão seguinte confirmou e o que ela errou

Uma nova rodada de revisão automatizada levantou 14 pontos. Cada um foi conferido **no código**
antes de virar trabalho; três não se sustentaram e ficaram de fora com a evidência:

|Alegado|Medido|Veredito|
|---|---|---|
|"`failed.expires_at` é gravado e nunca honrado; só há cooldown de 60 s em memória"|`read_hero_media` tem o bloco `retry_fresh`, que compara `stored["expires_at"] > now()` e só então reenfileira; `test_backoff_persistido_e_quem_decide_quando_tentar_de_novo` prova as duas cadências|**refutado**|
|"a fila guarda até 500 dicts de Entity"|`_enrichment_queue.append((collection, entity["_id"], key))` guarda **id**, e o documento é relido na vez|**refutado**|
|"`get_restaurant_images(limit=3)` entra em modo galeria e busca oito"|`resolve_display_media` chama com `limit=1`, o mesmo hero do card|**refutado**|
|"subir o teto de heap 200→256"|já revertido antes deste passe; `deploy/supervisord.conf` está em `--max-old-space-size=200`|**já feito**|
|"`setExpired(false)` síncrono"|não existe `setExpired` neste repositório|**inapplicável**|
|"contratos gerados defasados"|`npm run check:contracts` passa (o gate padrão o executa)|**refutado**|

Seis se confirmaram e foram corrigidos, cada um com teste que falha se o defeito voltar:

1. **`DataTable`**: a guarda de controle aninhado testava `input`/`button` por `instanceof` e deixava
   `select` e `textarea` de fora — Espaço num select inline abria o dropdown *e* alternava a linha, e
   as setas moviam o foco da tabela em vez do cursor. Agora é um `closest('input, button, select,
   textarea, a, [contenteditable="true"]')`.
2. **`useNow`**: o relógio do módulo nascia com o chunk, não com o primeiro leitor. Numa sessão longa
   a primeira pintura de uma lista usava um "agora" de até um minuto atrás — uma credencial que
   venceu nesse intervalo aparecia ativa. A assinatura atualiza o snapshot.
3. **`CollectionDistributionView`**: o carregamento derivava de `loadedId === collectionId`, que
   continua verdadeiro depois de `reloadKey++` — o Retry não mostrava carregamento nenhum e a
   mensagem de erro antiga ficava na tela durante toda a nova requisição. A chave passa a ser
   `${collectionId}:${reloadKey}`.
4. **KPI de mídia declara o teto**: o texto passa a dizer que o número é um teto, não uma promessa —
   a leitura também recusa fato cuja fonte mudou, e comparar impressão na agregação exigiria ler
   21,6k documentos a cada carga do painel.
5. **`display_media` exige igualdade da impressão da fonte.** Aceitar `None` (fato gravado antes do
   campo existir) pouparia uma resolução por Entity e deixaria um fato órfão de origem sendo servido
   por até 14 dias — o mesmo defeito de "derivado sem vínculo com a origem" que a impressão veio
   corrigir. Os 29 fatos do acervo re-resolvem uma vez, sob demanda.
6. **A chave de dedupe só é liberada depois da resolução.** Antes ia embora no `popleft`, e a janela
   ficava a cargo do cooldown de 60 s, que conta desde o *enfileiramento*: com fila cheia, a mesma
   Entity era enfileirada de novo enquanto a primeira ainda rodava.

Provas de produção deste passe (deploy `1546afc6`, `deploy_ended succeeded` às 08:50:29):

- três leituras reais de `/api/v3/entities/<id>/image` → **200 `image/jpeg`, 53.646 bytes**, com o
  `cache-control` do ramo persistido (`public, max-age=3600`) — a regra estrita aceita os fatos que
  estão no acervo;
- o ciclo gravação↔leitura continua coberto no unit (`test_vencedor_do_site_persiste_a_url_da_imagem`
  resolve e depois lê o mesmo documento), que é exatamente o risco da regra nova;
- a cópia nova do KPI está no bundle servido (`6058-b0495e2fd2428333.js`).
