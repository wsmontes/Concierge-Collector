# Curation Authoring Workspace — reconstrução da pipeline de edição

**Data:** 2026-08-29
**Status:** Design aprovado; aguardando review da spec antes do plano de implementação
**Branch:** `design/curation-authoring-workspace`
**Base:** `main@a86e4b5d14d5d35d4ba00bc89f313294c11c6ab5`

## Contexto

A superfície atual de edição de Curation foi construída incrementalmente e hoje mistura cinco responsabilidades distintas:

1. identificação provisória de uma Curation órfã;
2. contexto factual de uma Entity já resolvida;
3. captura de conhecimento do curador;
4. revisão/edição do conteúdo estruturado produzido pela automação;
5. operações avançadas de manutenção, provenance e troubleshooting.

O resultado é uma tela em que o curador — profissional caro, especializado e não necessariamente letrado em ferramentas — recebe cedo demais tarefas de metadata, taxonomia e manutenção estrutural. A ordem atual (`Identity`, `Curation`, `Concepts`, `Source material`) também contradiz o fluxo real de trabalho: a matéria-prima mais valiosa é áudio, imagem e opinião; Concepts e transcription são resultados derivados e devem ser secundários.

O próprio frontend preserva resíduos do modelo antigo. `RestaurantModule` declara responsabilidade por edição de Restaurant/Entity e criação/edição de Curation ao mesmo tempo. `ConceptModule` configura nome, transcrição, descrição, localização, fotos, save/discard, clone/export, reprocessamento e `Record Additional Review`, além de Concepts. O problema portanto não é apenas de ordem visual; as fronteiras do código refletem a mesma confusão conceitual.

## Modelo de domínio que a UX deve respeitar

### Cardinalidade

```text
Entity      0..N Curations
Curation    0..1 Entity
```

Uma Curation é sempre sobre uma coisa real, mas o registro `Entity` correspondente pode ainda não estar resolvido no momento da captura. Por isso `entity_id = null` é um estado legítimo de authoring, não um erro.

### Entity

Responde: **"o que é este lugar/coisa?"**

É a fonte canônica de fatos compartilhados: nome, tipo, endereço, cidade, país, contato, localização, mídia factual e demais metadata operacional.

Editar uma Entity deve alterar uma única Entity. Todas as Curations linkadas passam a enxergar esses fatos atualizados quando forem hidratadas/exibidas. Não deve haver propagação manual de campos canônicos para cada Curation.

### Curation

Responde: **"o que este curador sabe, recomenda ou pensa sobre isto?"**

É autoral/editorial. Pode existir temporariamente órfã. Muitas Curations humanas podem coexistir para a mesma Entity. Collections selecionam Curations, não Entities.

### `restaurant_name` na Curation

Na primeira fase não haverá migração de schema. O campo existente continuará persistido, mas sua semântica de UX será corrigida:

- `entity_id == null`: `restaurant_name` funciona como **working/captured name**, pista provisória para identificar o assunto da Curation e resolver a Entity depois;
- `entity_id != null`: a identidade canônica exibida vem de `entity.name`; `restaurant_name` deixa de ser apresentado como nome factual e permanece apenas como provenance/fallback para unlink e compatibilidade.

### Curadoria sintética

`curator_type = synthetic` representa material automatizado de partida, não uma autoria equivalente à humana. O backend já implementa takeover: quando um humano edita uma Curation sintética, ela passa a humana e a origem é preservada em `createdBy`.

A UX deve tratar Curation sintética como **draft para enriquecimento humano**, não como uma Curation humana final.

### Denormalização operacional

Campos como `city` e `type` hoje podem ser copiados da Entity para a Curation por razões de busca/paginação. Esses campos são projeções derivadas/cache operacional, não ownership editorial da Curation. Eles não serão exibidos como metadata manual do curador.

## Objetivo do redesign

A nova superfície deve otimizar uma única pergunta:

> **Quanto tempo entre abrir uma Curation e o curador começar a adicionar conhecimento útil?**

O caminho principal deve se aproximar de um clique.

O curador não deve precisar entender Entity, denormalização, taxonomia, provenance, transcription ou reprocessamento para fazer seu trabalho principal.

## Princípios de UX

1. **Input first.** Áudio, fotos e notas são as superfícies primárias.
2. **Automation first.** Novo input dispara transcrição/análise/extração/categorização automaticamente sempre que possível.
3. **Review before manual structure.** Concepts são primeiro leitura/revisão; edição manual é escape hatch.
4. **Entity as context in Curation.** Na edição de Curation linkada, Entity é contexto factual read-only, não formulário embutido.
5. **Entity editing is a separate job.** Alterar fatos canônicos acontece na superfície de Entity.
6. **Orphan is valid.** Não exigir resolução de identidade para capturar conhecimento.
7. **One recording model.** Não existe conceitualmente "initial review" versus "additional review"; existem uma ou mais fontes de áudio anexadas à Curation.
8. **Advanced stays advanced.** Transcript bruto, reprocessamento, clone, export, unlink e troubleshooting não competem com o caminho principal.
9. **No schema big bang.** A primeira implementação reorganiza UX e responsabilidades reutilizando API, IndexedDB, sync e modelos atuais.
10. **Preserve ownership/sync rules.** O redesign não altera as regras de ownership humano/sintético, optimistic locking, offline-first e sincronização já implementadas.

## Estados do Curation Workspace

O editor deixa de ser um formulário estático e passa a renderizar contexto por estado.

### Estado 1 — Orphan human curation

Condição: `entity_id == null`, `curator_type != synthetic`.

Cabeçalho `About`:

- campo editável `Name this place` mapeado para `restaurant_name`;
- badge discreto `Unlinked`;
- helper: "We'll identify the place later.";
- opcionalmente pistas já capturadas, sem transformar a tela em cadastro de Entity.

Não mostrar formulário de Entity metadata.

### Estado 2 — Linked human curation

Condição: `entity_id != null`, `curator_type != synthetic`.

Cabeçalho `About`:

- nome canônico vindo de `Entity.name`;
- tipo/cidade/endereço/contato/mídia factual da Entity, quando disponíveis;
- badge `Linked`;
- ação secundária `View entity`;
- sem campo de nome da Curation fingindo ser o nome canônico.

A Entity deve ser resolvida de forma robusta:

```text
route state / entity supplied
        ↓ fallback
IndexedDB local
        ↓ fallback
GET /entities/:id
        ↓
EntityContext
```

Uma deep link de Curation linkada não pode perder seu contexto apenas porque a Entity não está no cache local.

### Estado 3 — Linked synthetic curation

Condição: `entity_id != null`, `curator_type == synthetic`.

Exibe contexto da Entity como no estado 2 e um banner editorial:

- `AI-generated curation`;
- "This is an automated starting point.";
- CTA principal `Record your expert review`;
- fotos/notas como inputs complementares;
- Concepts sintéticos ficam visíveis como material de partida, não como tarefa principal.

Salvar conteúdo humano usa o takeover já implementado pelo backend.

### Estado 4 — Orphan synthetic curation

Não é o caminho esperado dos pipelines atuais, mas deve ser suportado sem quebrar a UI. Combina working name editável, badge `Unlinked`, indicador sintético e as mesmas ferramentas de enriquecimento humano.

## Arquitetura da tela

A ordem canônica, desktop e mobile, será:

```text
EDIT CURATION

1. ABOUT
2. ADD TO THIS CURATION
3. YOUR CURATION
4. CONCEPTS
5. SOURCES & HISTORY
6. ADVANCED

[Save Curation]
```

A navegação secundária atual `Identity | Curation | Concepts | Source material` será removida do editor. Em mobile a mesma ordem é mantida em uma única coluna; seções secundárias podem ser accordions, mas `About` e `Add to this curation` permanecem imediatamente visíveis.

## 1. About

Responsabilidade: dizer claramente "sobre o que é esta Curation?".

### Orphan

```text
ABOUT
Name this place
[________________________]
Unlinked · We'll identify the place later.
```

### Linked

```text
ABOUT
[photo]  Entity Name
         Type · City
         Address
         Website · Phone
         ✓ Linked
                       View entity →
```

A tela de Curation não expõe mais `Entity Type`, `Phone`, `Address`, `City`, `Country`, `Website`, `Rating` e `Price Level` como campos editáveis.

## 2. Add to this curation

É a área de maior peso visual e a principal ferramenta do curador.

### Ação primária

`Record your review` para Curation sem áudio recente, ou `Record more` para Curation com material existente.

É um único componente/pipeline de gravação. O conceito de `Record Additional Review` deixa de existir na UX e progressivamente no código.

### Ações complementares

- `Add photos`;
- `Write a note` / entrada textual livre quando aplicável.

Essas ações representam **fontes de conhecimento**, não manutenção de estrutura.

### Pipeline automática

```text
audio / image / text
        ↓
source persisted safely
        ↓
transcription / image analysis
        ↓
concept extraction
        ↓
category mapping
        ↓
curation content refresh
        ↓
reviewable result
```

Novo input deve disparar análise automaticamente quando a infraestrutura existente permitir. Ação manual `Analyze again` fica em Advanced para exceções.

## 3. Your curation

Responsabilidade: apresentar o conteúdo editorial humano/machine-assisted que efetivamente compõe a Curation.

Campos editáveis continuam disponíveis porque a palavra final é do curador:

- Summary / Description;
- Public recommendation / public notes;
- Private notes.

A UI deve privilegiar leitura clara com ação `Edit`, em vez de mostrar todos os textareas pesados simultaneamente quando isso não for necessário.

Geração/melhoria por IA pode continuar existindo, mas como assistência dentro deste bloco, não como pré-requisito do fluxo.

## 4. Concepts

Concepts passam de ferramenta primária para resultado estruturado revisável.

### Default

- título `Concepts`;
- contagem total;
- grupos/chips resumidos;
- ação `Review concepts`.

### Review

Mostra as categorias existentes do vocabulário real do sistema e seus valores. Não inventar uma nova taxonomia visual que mude a persistência.

### Manual editing

Disponível apenas depois de uma ação explícita `Edit manually` ou equivalente.

Fluxo conceitual:

```text
machine extracts
      ↓
curator reviews if desired
      ↓
manual correction only when needed
```

O `ConceptModule` continua responsável pela lógica de Concepts e análise, mas deixa de ser dono do save geral, gravação, fotos e ciclo de vida completo do formulário.

## 5. Sources & History

Colapsado por padrão.

Responsabilidade: provenance, auditoria e inspeção do material original.

Exemplos:

- gravações com timestamp/duração;
- fotos adicionadas;
- web research source em Curation sintética;
- transcription expandível;
- estado de processamento;
- erros de análise, se houver.

Transcript deixa de ocupar área principal da edição.

## 6. Advanced

Agrupa ações de exceção/manutenção:

- Analyze again / Reprocess;
- Clone Curation;
- Export JSON;
- Unlink Entity;
- detalhes de sync/conflito quando necessário;
- outras ações técnicas futuras.

Ações destrutivas continuam protegidas por confirmação apropriada.

## Entity editing

A superfície de Entity é separada e responde a outro trabalho:

```text
EDIT ENTITY

Canonical identity
Location
Contact
Media
Operational metadata

Curations about this entity
  - human curation A
  - human curation B
  - synthetic draft
```

Editar uma Entity atualiza a Entity. O editor de Curation passa a buscar/mostrar os fatos atuais dela.

A existência de uma ação `Edit entity` a partir do contexto da Curation é aceitável como navegação explícita para outra superfície, mas não como formulário inline dentro da Curation.

## Fronteiras de frontend propostas

### `CurationEditorModule` — novo orquestrador

Responsável por:

- carregar Curation e Entity context;
- derivar estado `orphan/linked` + `human/synthetic`;
- coordenar renderização das seções;
- dirty state e save orchestration;
- navegação e compatibilidade com rotas existentes;
- delegar captura e análise aos módulos especializados.

Não deve implementar internamente gravação, IA de Concepts ou CRUD de Entity.

### `EntityContext`

Pode começar como helper/subcomponente do `CurationEditorModule`.

Responsável por:

- resolver Entity via state/local/API;
- normalizar os vários shapes legados de dados apenas para display;
- renderizar contexto read-only;
- expor `View entity`.

### `RecordingModule`

Continua responsável por captura de áudio, preview, persistência segura e integração com transcription.

Mudança principal: uma única experiência reutilizável para qualquer gravação de uma Curation; retirar a distinção conceitual `isAdditionalRecording` quando a migração estiver segura.

### Photo input

A lógica existente de captura/galeria e processamento deve ser preservada, mas orquestrada a partir de `CaptureTools`, não de `ConceptModule.setupEvents()`.

### `ConceptModule`

Fica responsável por:

- extração/análise;
- category mapping;
- render/review de Concepts;
- validação/edição manual de Concepts;
- reanálise quando explicitamente solicitada.

Sai de sua responsabilidade:

- save/discard geral da Curation;
- gravação;
- criação de `Record Additional Review`;
- ownership de photo input;
- ownership do formulário inteiro;
- geolocalização como tarefa editorial principal.

### `RestaurantModule`

Não fazer rename big-bang imediatamente.

Criar `CurationEditorModule` e migrar responsabilidades progressivamente. `RestaurantModule` pode permanecer temporariamente como compatibility adapter para chamadas existentes, delegando ao novo módulo, até os call sites e testes serem atualizados.

O objetivo final é que o nome `RestaurantModule` deixe de representar o editor genérico de Curation.

## Compatibilidade e invariantes

A primeira implementação não muda:

- `CurationCreate/CurationUpdate` públicos, salvo se um gap real for descoberto durante testes;
- cardinalidade Entity/Curation;
- `entity_id` opcional;
- takeover synthetic → human;
- ownership humano → humano (duplicar, não sobrescrever);
- optimistic locking/version;
- sync offline-first;
- Collection membership por `curation_id`;
- distribuição `Curation + current Entity`;
- IndexedDB como working set/offline cache.

## Tratamento de `city` / `type` derivados

A implementação deve documentar e testar que `curation.city`/`curation.type` são dados derivados para busca, não informação que o curador edita.

O redesign não precisa resolver de imediato a estratégia de atualização dessas projeções quando a Entity muda. Se testes mostrarem stale search projections, isso será registrado como follow-up de consistência de índice/projeção, sem reintroduzir metadata manual no editor.

## Plano de entrega em ondas

### Onda 0 — Characterization e safety net

Antes de alteração visual estrutural:

- testes de edição de Curation orphan;
- testes de edição linked com Entity local;
- linked com fallback para API;
- synthetic takeover;
- save/discard/dirty;
- audio capture/review;
- photo input;
- concepts render/edit/reprocess;
- unlink preservando working name;
- deep-link route;
- mobile critical path.

Objetivo: distinguir regressão causada pelo redesign de comportamento legado já quebrado.

### Onda 1 — State model + Entity context

- introduzir `CurationEditorModule`;
- derivar estado do workspace;
- resolver Entity via state → IndexedDB → API;
- manter adapters para APIs atuais;
- testes unitários/DOM do state model.

### Onda 2 — Novo markup e hierarquia

- substituir `Identity/Curation/Concepts/Source material` por `About/Input/Your Curation/Concepts/Sources/Advanced`;
- preservar IDs DOM indispensáveis durante a transição quando isso reduzir risco;
- remover editor nav antigo;
- adaptar CSS desktop/mobile e acessibilidade.

### Onda 3 — Capture Tools no topo

- unificar Record/Record More;
- mover photo input;
- integrar note input;
- automático pós-input;
- manter compatibilidade com pending audio/drafts.

### Onda 4 — Review-first Concepts + Sources

- Concepts default read-only/resumidos;
- editor manual sob ação explícita;
- transcript e provenance em `Sources & History`;
- reprocess em Advanced.

### Onda 5 — Desacoplamento de módulos

- retirar save/discard/photo/recording do `ConceptModule`;
- centralizar orchestration no `CurationEditorModule`;
- reduzir `RestaurantModule` a adapter ou removê-lo quando não houver call sites.

### Onda 6 — Synthetic UX e Entity handoff

- banner/CTA específico para synthetic;
- takeover end-to-end;
- navegação limpa `View/Edit Entity` para superfície separada;
- confirmar que Entity edits aparecem atualizados ao reabrir Curations.

### Onda 7 — Regression, accessibility e cleanup

- desktop/mobile;
- teclado/foco/touch targets;
- offline/degraded mode;
- sync conflicts;
- route/back navigation;
- stale cache fallback;
- remover IDs/classes/adapters mortos somente depois de cobertura.

## Estratégia de testes

### Unit/DOM

- derivação de estado do editor;
- Entity context resolver;
- working name vs canonical entity name;
- synthetic banner/CTA;
- concepts collapsed/review/manual states;
- source history collapsed;
- advanced actions.

### Integration

- orphan create → save → link → reopen linked;
- linked → Entity edit → reopen Curation mostra Entity atual;
- linked → unlink → working name continua identificável;
- synthetic → human edit → takeover;
- audio → transcription → concepts refresh;
- image → analysis → concepts refresh;
- manual concept correction não quebra reprocessamento;
- offline draft/restore.

### E2E critical paths

Desktop e mobile:

1. abrir Curation linked e começar recording rapidamente;
2. abrir orphan e capturar sem linkar Entity;
3. abrir synthetic e transformar em humana;
4. revisar Concepts sem ser obrigado a editá-los;
5. abrir Entity a partir da Curation e voltar sem perda de estado.

## Acessibilidade

- CTA principal de gravação com target >= 44px;
- estados de recording/análise anunciados adequadamente;
- seções colapsáveis com `aria-expanded`/`aria-controls`;
- foco preservado ao expandir review/manual edit;
- ações icon-only sempre com label;
- Entity context não deve parecer input quando é read-only.

## Critérios de aceitação

1. Uma Curation órfã pode ser criada/editada sem qualquer Entity resolvida.
2. O único dado de identificação obrigatório/primário do orphan é o working name necessário para posterior resolução, respeitando as validações já existentes.
3. Uma Curation linkada exibe o nome/fatos atuais da Entity, não `restaurant_name` como autoridade factual.
4. Entity metadata não aparece como formulário editável dentro da Curation.
5. `Record your review` / `Record more` fica no topo, imediatamente após o contexto.
6. Não existe mais uma experiência separada chamada `Record Additional Review`.
7. Fotos ficam junto das ferramentas de input.
8. Novo input inicia processamento automático quando possível.
9. Concepts são revisão secundária; edição manual exige ação explícita.
10. Transcript fica secundário em `Sources & History`.
11. `Analyze again`, clone/export/unlink ficam em Advanced.
12. Synthetic curation comunica claramente que é material de partida e promove contribuição humana.
13. O takeover synthetic → human continua correto.
14. Duas Curations humanas da mesma Entity continuam coexistindo.
15. Collections continuam operando sobre Curation IDs.
16. Edição de Entity reflete nas Curations via hidratação/contexto, sem exigir edição manual de cada Curation.
17. Deep links linked resolvem Entity mesmo sem cache local.
18. Offline draft, dirty guard, sync e optimistic locking não regredem.
19. Desktop e mobile compartilham a mesma hierarquia conceitual.
20. O fluxo principal permite iniciar uma gravação em aproximadamente um clique depois de abrir a Curation.

## Fora de escopo da primeira implementação

- migração/rename de `restaurant_name` no schema/banco;
- remoção imediata de todas as compatibilidades legacy `restaurant*`;
- redefinição da taxonomia de Concepts;
- redesenho de Collections/Admin;
- novas regras de permissão;
- propagação massiva Entity → Curations;
- reescrita completa do Collector em outro framework;
- mudança do contrato público de distribuição sem necessidade comprovada.

## Riscos e mitigação

### Acoplamento DOM legado

Muitos módulos fazem lookup direto por IDs. Durante a migração, preservar IDs funcionais quando possível e mover ownership de events de forma incremental. Só remover IDs antigos depois que testes provarem ausência de call sites.

### `ConceptModule` muito grande

Não tentar refatorá-lo inteiro. Extrair apenas responsabilidades diretamente ligadas ao novo workspace. Mudanças não relacionadas ficam fora de escopo.

### Gravação mobile

`RecordingModule` possui compatibilidade específica de MIME/iOS e pending audio. A primeira onda reutiliza a implementação e muda a composição/entrada, não o core de gravação.

### Offline-first

O novo `CurationEditorModule` deve usar os mesmos DataStore/Draft/Sync contracts. Não criar uma segunda camada de persistência.

### Entity cache stale/missing

Resolver via API quando cache local não satisfizer o contexto. A tela deve degradar com aviso claro caso a Entity esteja realmente indisponível, sem permitir que `restaurant_name` passe silenciosamente a parecer a fonte canônica.

## Definição de pronto

O redesign está pronto quando um curador consegue abrir uma Curation e entender imediatamente:

> **"Esse é o lugar. Aqui eu adiciono o que sei."**

A complexidade de Entity resolution, taxonomia, transcription, provenance, sync e reprocessamento continua disponível para o sistema e para operações avançadas, mas não compete mais com a contribuição editorial de alto valor.
