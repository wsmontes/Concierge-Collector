<!--
Purpose: Definir o plano de governança da documentação a partir do diagnóstico de investigação, organizando conteúdo ativo, histórico e controle de qualidade contínuo.
Main responsibilities: Priorizar correções críticas, estabelecer documentos-chave, política de arquivamento e rotina anti-drift doc-código.
Dependencies: docs/DOCUMENTATION_INVESTIGATION_STATUS_2026_02_18.md, docs/, concierge-api-v3/docs/, scripts/, concierge-api-v3/app/.
-->

# Documentation Governance Plan (Phase 2) — 2026-02-18

## 1) Objetivo (recalibrado)

Focar a revisão documental **apenas no que impacta operação real** do projeto hoje:

- integração correta com API V3
- autenticação e autorização sem ambiguidade
- execução local/produção sem instruções conflitantes
- sync e fluxos AI descritos conforme runtime

Documento base desta fase:

- `docs/DOCUMENTATION_INVESTIGATION_STATUS_2026_02_18.md`

---

## 2) O que é importante (critérios de impacto)

Um documento é prioritário quando afeta pelo menos um destes pontos:

1. **Pode quebrar integração** (endpoint, payload, headers, auth)
2. **Pode gerar operação incorreta** (ambiente, deploy, URL, setup)
3. **Afeta custo/risco** (AI endpoints pagos, permissões, write operations)
4. **Afeta onboarding técnico** (primeira leitura para dev usar o sistema)

Fora desse critério: revisão cosmética e material histórico.

---

## 3) Escopo ativo (in-scope)

### P0 — Crítico operacional

- `docs/API/API_DOCUMENTATION_V3.md`
- `docs/API/API_QUICK_REFERENCE.md`
- `docs/API/README.md`
- `docs/ENVIRONMENT_DETECTION.md`
- `docs/OAUTH_SETUP_GUIDE.md`
- `docs/DEPLOYMENT.md`
- `docs/LOCAL_DEVELOPMENT.md`

### P1 — Alta relevância funcional

- `docs/AI_ORCHESTRATOR_SPEC.md`
- `docs/SEMANTIC_SEARCH_GUIDE.md`
- `docs/testing/COLLECTOR_V3_TEST_GUIDE.md`
- `docs/README.md`

### P2 — Suporte (somente se bloquear P0/P1)

- `docs/UI/README.md`
- `docs/RENDER_DEPLOYMENT_MANAGER_GUIDE.md`

---

## 4) Fora de escopo agora (out-of-scope)

- Qualquer refino de `docs/archive/**` e `archive/**`
- Revisão estética/linguística sem impacto técnico
- Reorganização documental ampla que não reduza risco operacional

---

## 5) Plano de revisão (focado)

## Ciclo A — Integridade de API (P0)

**Meta:** documentação de integração sem divergência com runtime.

Checklist:
1. Endpoint e método HTTP corretos
2. Header de auth correto por endpoint
3. Regras de `If-Match`/`version` corretas em updates
4. Exemplos cURL/JS/Python executáveis conceitualmente
5. Sem rotas inativas apresentadas como ativas

**Saída:** API docs sem inconsistência crítica com `concierge-api-v3/app/api/`.

---

## Ciclo B — Operação e ambiente (P0)

**Meta:** setup e operação reproduzíveis sem ambiguidade.

Checklist:
1. URLs de produção/local consistentes
2. Fluxo OAuth e auth em sintonia com implementação
3. Passos de deploy e local setup sem dependências legadas
4. Mensagens de risco/custo em endpoints AI sensíveis

**Saída:** docs de ambiente/deploy confiáveis para executar projeto do zero.

---

## Ciclo C — Funcional (P1)

**Meta:** AI, busca semântica e testes alinhados ao comportamento real.

Checklist:
1. Inputs/outputs das rotas AI e semantic search
2. Distinção clara entre endpoints públicos/protegidos
3. Guia de testes coerente com suíte atual e comandos válidos

**Saída:** documentação funcional útil para manutenção diária.

---

## 6) Critério de pronto

Este plano é considerado cumprido quando:

- todos os documentos P0 estiverem consistentes com código atual
- documentos P1 não apresentarem contradições críticas
- `docs/README.md` refletir corretamente a navegação ativa
- houver rotina mínima de prevenção de drift

---

## 7) Rotina mínima anti-drift

A cada mudança em endpoint/auth/config:

1. Atualizar docs P0 no mesmo ciclo da mudança
2. Marcar data de última verificação no PR
3. Executar checklist curto de consistência (API + ambiente)

---

## 8) Ownership operacional

- **API/Auth:** backend maintainer
- **Deploy/Env:** owner de infraestrutura
- **AI/Semântica:** owner AI/backend
- **Índice ativo (`docs/README.md`):** owner de documentação técnica

---

## 9) Próxima ação prática

Executar revisão **P0 completa** em lote único (API + ambiente + auth), com validação cruzada em `concierge-api-v3/app/` e `scripts/`.

---

## 10) Quadro de execução (status atual)

Baseado na verificação dos docs ativos em 2026-02-18:

### P0 — Status por documento

- `docs/API/API_DOCUMENTATION_V3.md` → **OK operacional** (sem drift crítico detectado)
- `docs/API/API_QUICK_REFERENCE.md` → **OK operacional**
- `docs/API/README.md` → **OK operacional**
- `docs/LOCAL_DEVELOPMENT.md` → **OK operacional**
- `docs/DEPLOYMENT.md` → **OK operacional**
- `docs/ENVIRONMENT_DETECTION.md` → **OK operacional** (alinhado ao comportamento real de runtime em 2026-02-18)
- `docs/OAUTH_SETUP_GUIDE.md` → **OK operacional** (reconciliado com runtime em 2026-02-18)

### Pendências críticas já identificadas

- Nenhuma pendência crítica P0 aberta neste ciclo.

### Ordem de execução (o que importa primeiro)

1. Rodar checklist final P0 e congelar baseline

Status: ✅ Checklist P0 executado e baseline operacional congelado em 2026-02-18.

---

## 11) Definição de conclusão do plano (curto prazo)

Plano entra em estado **estável** quando:

- todos os documentos P0 estiverem marcados como **OK operacional**
