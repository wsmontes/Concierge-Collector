# Fase 1 — Segurança contra perda de trabalho + consistência de navegação

**Data:** 2026-08-16
**Status:** Aguardando review do usuário
**Ciclo:** Remediação dos 8 grupos da revisão UX (135 pontos → 8 tensões estruturais)

## Contexto

Auditoria UX do Collector (2026-08-16) produziu 135 pontos, reduzidos a 8 grupos pelo usuário. Decisões tomadas no brainstorming:

- **Estrutura:** 3 fases, segurança primeiro. Fase 1 = grupos 1–2 + bugs concretos do grupo 7. Fase 2 = cards + Quick Actions. Fase 3 = resíduos visuais + densidade + infra CSS.
- **Definição de fase concluída:** testes locais passando (`npm test` + thresholds de cobertura) e merge em `main`. Deploy verificado uma única vez, no fim do ciclo completo (auto-deploy do Render não é confiável — verificar manualmente).
- **Eixo A (autosave):** restaurar persistência de rascunho (não apenas flags).
- **Eixo B (navegação):** consistência cirúrgica (não centralização total).
- **Eixo C (description):** manter os dois limites (30 palavras na UI, `maxlength=200` como teto de segurança) — sem mudança de código.

Todos os claims foram verificados contra a working tree atual por 8 agentes read-only. Veredito geral: **todos CONFIRMADOS**, com correções importantes ao diagnóstico original:

1. A tabela `draftRestaurants` **existe** na schema atual do Dexie (`scripts/storage/databaseManager.js:587-605`, caminhos fresh/legacy/upgrade incluem). O comentário "old database schema" em `conceptModule.js:357-358` está **desatualizado**.
2. O `DraftRestaurantManager` **já é inicializado** (`scripts/core/main.js:212-214` com `window.dataStore`). A incompatibilidade real é o ID de curador: o código desabilitado usa `this.uiManager.currentCurator.id`, que é **null para usuários só-OAuth** (a verdade de auth é `CuratorProfile`, ver memória `curator-dual-model-auth-vs-legacy`).
3. O guard de navegação (`main.js:851-885`) chama `discardRestaurant()` incondicionalmente ao sair de `/edit` — com o rascunho restaurado, isso **deletaria** o draft em toda navegação, anulando a persistência.

## Escopo da Fase 1

| Mudança | Onde | Resumo |
|---|---|---|
| M1 | `scripts/modules/conceptModule.js`, `scripts/modules/recordingModule.js` | Reativar autosave com resolução correta de curador |
| M2 | `scripts/modules/conceptModule.js`, `scripts/modules/entityModule.js` | `saveRestaurant` retorna boolean; dirty limpo só em sucesso |
| M3 | `scripts/modules/conceptModule.js`, `scripts/core/main.js` | Restauração de rascunho + guard preserva draft ao sair sem dirty |
| M4 | `scripts/ui-core/uiManager.js`, `scripts/modules/quickActionModule.js`, `scripts/modules/restaurantModule.js`, `scripts/modules/entityModule.js` | Navegação cirúrgica: rotas refletem o estado em todos os modos |
| M5 | `styles/application.css` | Fix do seletor do back-button mobile + título centralizado na viewport |

**Fora de escopo desta fase** (decisões explícitas):

- `beforeunload` com prompt de trabalho não salvo (refresh perde no máximo o conteúdo dentro da janela de debounce de 3s — a promessa de autosave cobre o resto).
- Limpeza de seletores órfãos (`.alert-*`, `.already-added-badge`, `.character-counter`, `.back-button` de `createBackButton`) — vai para a Fase 3 (infra CSS).
- Quick Actions no padrão ModalManager, semântica/a11y dos cards, resíduos visuais, densidade da home — Fases 2 e 3.
- `maxlength=200` da description permanece como está (Eixo C aprovado).

## M1 — Autosave reativado com resolução correta de curador

**Problema:** `autoSaveDraft()` é chamado em 5 pontos (`conceptModule.js:70,83,93,155,1078,1092`) mas a persistência está comentada (`conceptModule.js:357-368`). A UI promete autosave que não existe; refresh perde todo o trabalho.

**Mudança:**

1. Reativar o bloco de `conceptModule.js:357-368`, substituindo `this.uiManager.currentCurator.id` pela resolução usada por `openQuickActions` (`quickActionModule.js:115-128`):
   - `CuratorProfile.getCurrentCurator()` → `curator_id` (email, string) — caminho OAuth;
   - fallback: `this.uiManager.currentCurator?.id` — curador legado do selector local;
   - sem nenhum dos dois → **skip silencioso** (não gravar rascunho órfão, não lançar).
2. Mesma resolução em `recordingModule.js:1649-1656` (único outro ponto que cria draft via `getOrCreateCurrentDraft`).
3. Nenhuma mudança em `DraftRestaurantManager` nem na schema (ambos funcionam; o debounce de 3s e o metadata JSON com concepts/location/photos permanecem).

## M2 — Ciclo de vida do `formIsDirty`

**Problema:** `conceptModule.js:184-190` — o handler do Save faz `await this.saveRestaurant(); this.uiManager.formIsDirty = false;` incondicionalmente. `saveRestaurant()` tem 4 retornos antecipados de validação (`:484-487` delegação a entity, `:494-502` nome vazio, `:504-507` sem conceitos, `:520-526` descrição >30 palavras) — todos completam sem throw, então o flag é limpo mesmo com o save falhado. O guard (`main.js:862`) confia só nesse flag.

**Mudança:**

1. `saveRestaurant()` retorna `boolean`: `false` em todos os early returns de validação; `true` apenas no caminho que realmente persiste (após o sucesso da escrita).
2. A delegação `:484-487` passa a `return await entityModule.saveEntityFromForm();` — **`saveEntityFromForm` ganha retorno booleano** (true no sucesso; false nos early returns de validação dela; erros continuam propagando como throw).
3. O handler do Save reseta o flag apenas com resultado `true`: `const ok = await this.saveRestaurant(); if (ok) this.uiManager.formIsDirty = false;`.
4. Exceções (throw) continuam pulando o reset — comportamento preservado.

**Invariante resultante:** `formIsDirty === true` ⇔ existem alterações no formulário que ainda não foram persistidas como curadoria/entidade **nem** como rascunho restaurado.

## M3 — Restauração de rascunho + guard com preservação

**Problema:** sem restore, os drafts persistidos por M1 nunca seriam lidos (só acumulariam). E o guard de saída (`main.js:875-883`) chama `discardRestaurant()` incondicionalmente ao sair de `/edit`, o que deletaria o draft em toda navegação — tornando a persistência inútil.

**Mudança:**

1. Novo método `restoreDraftIfPresent()` no conceptModule, chamado por `showRestaurantFormSection` **somente em modo novo** (nunca em edição de item existente), antes do render:
   - resolve o ID do curador (mesma resolução de M1); sem curador → no-op;
   - `DraftRestaurantManager.getOrCreateCurrentDraft(curatorId)` → `getDraft`;
   - só restaura se o draft **tem dados** (`hasData`) e o formulário está **vazio** (nome, transcrição, conceitos todos vazios e `!formIsDirty`) — previne overwrite de digitação recente;
   - preenche name/transcription/description/concepts/location/photos, re-associa `currentDraftId`, seta `formIsDirty = false` (o draft **é** o estado salvo) e notifica "Draft restored" (info, discreta).
2. `discardRestaurant()` ganha opção `{ keepDraft = false }`:
   - `keepDraft: true` → pula `deleteDraft` **e** pula `PendingAudioManager.deleteAudios({ draftId })` (o áudio pendente associado ao draft sobrevive junto);
   - comportamento default (false) inalterado — botão Discard explícito e save continuam deletando.
3. Guard de saída (`main.js:875-883`): `discardRestaurant({ keepDraft: !dirty })` — sair sem dirty preserva o draft; sair com dirty + confirm deleta (usuário confirmou).

**Semântica resultante do autosave:** o rascunho é a cópia de segurança entre sessões. Navegar para fora do editor (sem confirmar descarte) preserva-o; Discard explícito e Save bem-sucedido o removem. Refresh/crash perdem no máximo os últimos ~3s de digitação (janela de debounce).

## M4 — Navegação cirúrgica

**Problema:** `switchView` no UIManager é a escrita canônica de estado; `goTo` é side-effect condicional. Em edição de item existente o `goTo` é pulado (`uiManager.js:2658-2660`) e a URL fica obsoleta; Quick Actions muta `isEditingRestaurant`/`editingRestaurantId` diretamente (`quickActionModule.js:188-199,229-240`).

**Mudança (sem tocar na API do navigationManager):**

1. `showRestaurantFormSection` (`uiManager.js:2645-2686`): substituir a condição que pula o `goTo` em edição por um branch por modo:
   - editando entity → `goTo('/entity/:id/edit', { replace: true, state: { entity: <objeto de edição, se disponível no módulo> } })`;
   - editando restaurant → `goTo('/curation/:id/edit', { replace: true, state: { curation: <objeto de edição, se disponível> } })`;
   - modo novo → `goTo('/new/edit', { replace: true, state: { title: 'New Curation' } })` (comportamento atual);
   - manter a checagem `nm.getCurrentRoute()?.path !== <alvo>` para não re-navegar (previne loop com os handlers de rota que chamam o próprio método);
   - se o objeto não estiver disponível no ponto da chamada, passar apenas o `id` nos params — os handlers de rota já fazem o fallback `findLocalCuration`/`findLocalEntity` (`main.js:811-843`).
2. Entradas de edição passam a ser route-first (as rotas e handlers **já existem** em `main.js:809-844`):
   - `restaurantModule.js:140-141` → `nm.goTo('/curation/:id/edit', { state: { curation } })`;
   - `entityModule.js:453` → `nm.goTo('/entity/:id/edit', { state: { entity } })`;
   - os handlers existentes já fazem o fallback `findLocalCuration`/`findLocalEntity` quando o state não traz o objeto.
3. Quick Actions:
   - `quickRecord` (`quickActionModule.js:138-158`): substituir `showRecordingSection()` por `nm.goTo('/new/record')` (handler da rota mostra a section) + manter o auto-click de `#start-record` (comportamento de UX: começar a gravar imediatamente);
   - `quickLocation`/`quickPhoto` (`:163-240`): remover as mutações diretas de `isEditingRestaurant`/`editingRestaurantId`; novo helper `uiManager.beginNewCuration()` centraliza reset de flags + `switchView('concepts')` + `goTo('/new/edit', { replace: true })` — usado pelos dois;
   - `quickManual` (`#quick-manual`, `quickActionModule.js`) segue o mesmo padrão de `beginNewCuration`.
4. **Verificar na implementação** (não verificado na exploração): o contrato interno de `uiManager.editCuration(curation)` / `entityModule.startEntityEdit(entity)` — eles devem tolerar serem chamados com a view ainda não trocada (os handlers de rota já fazem isso hoje, então o caminho existe). Se `editCuration` chama `showRestaurantFormSection` internamente, o branch de M4.1 cobre a URL.

**Invariante resultante:** toda transição de tela tem rota correspondente; a URL, o histórico e a tela descrevem o mesmo estado. O UIManager continua dono do estado (decisão: sem centralização total).

## M5 — CSS mobile

**Problema:** `application.css:235` usa o seletor `#mobile-nav-context .back-button`, mas o markup (`index.html:168`) tem `<button id="mobile-back-btn">` sem essa classe — o botão fica com estilo padrão do browser (sem touch target de 44px, sem cor). O título (`#mobile-nav-title`) tem `flex: 1; text-align: center` — centraliza no espaço restante após o botão, não na viewport.

**Mudança (CSS apenas):**

1. `application.css:235`: seletor `#mobile-nav-context .back-button` → `#mobile-back-btn` (markup é a verdade). As regras de `navigationManager.js:116-135`/`createBackButton` ficam intocadas (limpeza de código morto é Fase 3).
2. `#mobile-nav-context` ganha `position: relative`; `#mobile-nav-title` passa a `position: absolute; left: 50%; transform: translateX(-50%); max-width: 60%;` mantendo ellipsis/nowrap. O botão continua no fluxo; o container mantém `min-height` implícita pelo botão (44px).

## Fluxo de dados (rascunho)

```
input → formIsDirty=true + autoSaveDraft()          [conceptModule]
  → coleta {name, transcription, description, concepts, location, photos}
  → DraftRestaurantManager (debounce 3s)
  → getOrCreateCurrentDraft(curatorId resolvido)     [valida curatorId, re-busca se outro curador]
  → updateDraft → tabela draftRestaurants
save ok        → formIsDirty=false → deleteDraft + deleteAudios
discard (btn)  → confirm se dirty → deleteDraft + deleteAudios + reset estado
sair sem dirty → estado em memória limpo, draft PRESERVADO (keepDraft)
refresh/crash  → draft sobrevive → reentrar em modo novo → restoreDraftIfPresent
```

## Erros e casos de borda

- **Falha na escrita do draft** (quota/IndexedDB): silenciosa (log), sem UI; `formIsDirty` em memória continua a verdade; guard/confirm cobre navegação.
- **Degraded mode** (`DataStore._degraded`, db null — bug latente em perfil novo): autosave checa db aberto e pula silenciosamente; o editor continua funcional.
- **Metadata ilegível:** `getDraft` já trata `JSON.parse` com warn; restaura campos válidos e ignora metadata quebrada.
- **Navegação dentro do debounce (<3s):** dirty=true → guard pergunta; confirm deleta o draft (perda limitada à digitação recente, confirmada pelo usuário).
- **Troca de curador:** `getOrCreateCurrentDraft` valida `curatorId` e re-busca — um draft por curador.
- **Restore vs. digitação:** restore roda antes do render e só com formulário vazio — sem corrida prática, sem overwrite.
- **`quickLocation` com draft restaurado:** editor abre com draft + localização nova, dirty=true, notificação de restore visível. Aceitável e documentado.
- **Edição de item existente:** restore nunca roda nesse modo.

## Testes

Novos (vitest + fake-indexeddb, suíte existente em `tests/` com conftest jsdom):

1. `saveRestaurant`: `false` nos 4 early returns (dirty **não** limpo); `true` no sucesso (dirty limpo); `saveEntityFromForm` retorna booleano propagado.
2. Autosave só-OAuth: mock `CuratorProfile.getCurrentCurator()` → `{ curator_id: email }`, `currentCurator=null` → draft gravado com o email, sem throw.
3. `restoreDraftIfPresent`: form vazio + draft com dados → preenche, dirty=false, notifica; form com dados → sem overwrite; sem draft → no-op; em edição existente → nunca chamado.
4. Guard: sair de `/edit` sem dirty → `deleteDraft` **não** chamado e `keepDraft: true` respeitado; com dirty + confirm → `deleteDraft` chamado; cancel → rota inalterada.
5. Navegação: `showRestaurantFormSection` resulta na rota correta por modo (`/new/edit`, `/entity/:id/edit`, `/curation/:id/edit`); `quickRecord` → `goTo('/new/record')` + auto-click; `quickLocation`/`quickPhoto` sem mutação direta de flags (via `beginNewCuration`).
6. Smoke de markup: `#mobile-back-btn` presente; regra CSS nova casa com ele (se a suíte testa CSS, senão só DOM).

**Risco para a suíte atual (533 passed / 10 skipped):** testes que assumam o comportamento condicional antigo do `goTo` (skip em edição) ou que chamem `saveRestaurant` sem tratar o retorno booleano. Ajustar expectativas se quebrarem; a mudança de contrato está documentada aqui.

**Barra da fase:** `npm test` verde e `npm run test:coverage` dentro dos thresholds (70/60/70/70) antes do merge em `main`.

## Critérios de aceite da Fase 1

1. Autosave grava rascunho real na tabela `draftRestaurants` para curador OAuth e legado.
2. `formIsDirty` só é limpo em save bem-sucedido; guard/confirm/discard mantêm os invariantes.
3. Rascunho sobrevive a refresh e é restaurado ao reentrar em modo novo; Discard e Save o removem.
4. Navegar para fora do editor sem alterações preserva o rascunho.
5. Todas as transições de tela refletem a rota correta (novo, edição de entity, edição de restaurant, gravação).
6. Back-button mobile com estilo correto (touch target 44px) e título centralizado na viewport.
7. `npm test` verde + thresholds de cobertura; merge em `main`.
