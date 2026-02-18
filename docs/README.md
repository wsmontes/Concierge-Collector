<!--
Purpose: Servir como índice mestre de documentação, separando claramente fontes ativas e histórico para reduzir drift operacional.
Main responsibilities: Direcionar leitura por tema, definir fonte de verdade por domínio e explicitar regra de decisão em caso de conflito.
Dependencies: docs/API/, docs/archive/, docs/DOCUMENTATION_INVESTIGATION_STATUS_2026_02_18.md, docs/DOCUMENTATION_GOVERNANCE_PLAN_2026_02_18.md, concierge-api-v3/app/, scripts/.
-->

# Documentação do Projeto — Índice Mestre

> **Status:** Ativo — índice oficial para navegação entre documentação operacional e histórica.

## 1) Regra de decisão rápida

Em caso de conflito entre documentos:

1. **Código vigente prevalece** (`concierge-api-v3/app/` e `scripts/`).
2. Entre docs, usar primeiro os documentos da seção **Ativos (operacional)**.
3. Documentos marcados como **Histórico (Supersedido)** não devem orientar operação atual.

**Nota de execução:** o projeto está em cadência contínua (vibe coding). Referências a “Sprint” em documentos antigos devem ser tratadas como contexto histórico, não como cronograma vigente.

## 2) Ativos (operacional)

### API e integração
- `docs/API/README.md`
- `docs/API/API_DOCUMENTATION_V3.md`
- `docs/API/API_QUICK_REFERENCE.md`

### Autenticação e ambiente
- `docs/OAUTH_SETUP_GUIDE.md`
- `docs/ENVIRONMENT_DETECTION.md`
- `docs/LOCAL_DEVELOPMENT.md`
- `docs/DEPLOYMENT.md`

### AI / Semântica
- `docs/AI_ORCHESTRATOR_SPEC.md`
- `docs/SEMANTIC_SEARCH_GUIDE.md`

### Testes
- `docs/testing/COLLECTOR_V3_TEST_GUIDE.md`

## 3) Histórico (referência)

Use apenas para contexto de evolução técnica:

- `docs/archive/`
- `archive/`
- `docs/archive/sprints/` (**Histórico — planejamento legado**)
- `docs/archive/API_V3_STATUS.md` (**Histórico — Supersedido**)
- `docs/archive/API_SERVICE_V3_SPECIFICATION.md` (**Histórico — Supersedido**)

## 4) Fonte de verdade técnica por domínio

- **Backend API:** `concierge-api-v3/app/api/`
- **Modelos e validação:** `concierge-api-v3/app/models/`
- **Configuração backend:** `concierge-api-v3/app/core/`
- **Cliente frontend:** `scripts/services/`
- **Configuração frontend:** `scripts/core/`

## 5) Artefatos de governança

- Baseline de investigação: `docs/DOCUMENTATION_INVESTIGATION_STATUS_2026_02_18.md`
- Plano de governança (fases/ondas): `docs/DOCUMENTATION_GOVERNANCE_PLAN_2026_02_18.md`
