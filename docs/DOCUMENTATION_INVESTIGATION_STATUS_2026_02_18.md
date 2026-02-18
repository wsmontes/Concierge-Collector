<!--
Purpose: Registrar o status atual detalhado da documentação do projeto com método auditável, evidências e priorização de risco.
Main responsibilities: Inventário, taxonomia, critérios de classificação, drift code-doc, conflitos e prontidão para fase 2.
Dependencies: docs/, concierge-api-v3/docs/, scripts/, concierge-api-v3/app/, DOCUMENTATION_AUDIT_2026_01_30.md.
-->

# Documentation Investigation Status (2026-02-18)

## 1) Objetivo desta investigação

Estabelecer um baseline auditável do estado atual da documentação para responder, com evidência:

- O que está atualizado e operacional
- O que está parcial, conflita com o código ou está obsoleto
- O que deve ser mantido ativo vs histórico
- Quais documentos devem ser chave na próxima fase de governança

---

## 2) Escopo e taxonomia usada

### Escopo varrido

- docs/
- concierge-api-v3/docs/
- Referência cruzada em código:
  - scripts/
  - concierge-api-v3/app/

### Taxonomia de domínio

- API
- Auth & Access
- Arquitetura
- AI/Orquestração/Semântica
- Sync/Offline
- Deploy/Infra
- UI/UX
- Testes
- Histórico/Arquivo

### Status aplicado por documento

- Atual
- Parcial
- Obsoleto
- Histórico
- Conflitante

---

## 3) Método (investigação executada)

1. Inventário completo de arquivos Markdown
2. Distribuição por área para priorização
3. Varredura de marcadores de risco por arquivo:
   - URLs legadas (pythonanywhere)
   - Stack legado ou inconsistente
   - Texto de autenticação divergente
   - Marcadores de histórico/arquivo
4. Confronto com código vigente (backend e frontend)
5. Consolidação de riscos e fila de priorização

Arquivo de apoio gerado durante a varredura:

- /tmp/doc_risk_scan.csv

---

## 4) Inventário consolidado

### Volume identificado

- 145 arquivos Markdown dentro de docs/ e concierge-api-v3/docs/
- Distribuição principal:
  - docs/archive: 42
  - docs/API: 13
  - docs/UI: 12
  - docs/testing: 6
  - docs/development: 6
  - concierge-api-v3/docs: 7

Leitura: existe volume relevante de histórico e alta chance de sobreposição entre guias ativos e snapshots.

---

## 5) Fonte de verdade (estado atual)

## 5.1 Fonte de verdade técnica primária

- Código backend:
  - concierge-api-v3/app/api/
  - concierge-api-v3/app/models/schemas.py
  - concierge-api-v3/app/core/
- Código frontend:
  - scripts/core/config.js
  - scripts/services/apiService.js
  - scripts/sync/syncManagerV3.js

## 5.2 Fonte de verdade documental declarada

- docs/DOCUMENTATION_AUDIT_2026_01_30.md declara docs/API/API_DOCUMENTATION_V3.md como source of truth.

## 5.3 Conclusão desta investigação

Há divergência entre “source of truth declarado” e realidade operacional atual: alguns documentos tidos como centrais ainda contêm referências legadas e inconsistências.

---

## 6) Principais achados (com impacto)

### A) Drift de URL/ambiente (alto)

Persistem múltiplas referências a wsmontes.pythonanywhere.com em docs ativos, inclusive em documentação de API.

Exemplos críticos:

- docs/API/API_DOCUMENTATION_V3.md
- docs/API/README.md
- docs/API/API_QUICK_REFERENCE.md
- docs/archive/investigations/V3_API_SERVER_ISSUES_ANALYSIS.md

Impacto: onboarding e operação induzidos a endpoint incorreto.

### B) Drift de autenticação entre docs e runtime (alto)

Backend atual suporta autenticação dual (Bearer JWT e X-API-Key) nos endpoints protegidos.

No entanto, ainda há material de configuração/documentação com narrativa API-key-only ou comentários legados.

Exemplo de conflito:

- scripts/services/apiService.js usa Bearer token
- scripts/core/config.js mantém comentários de X-API-Key como base principal

Impacto: entendimento inconsistente do fluxo de segurança e integrações externas.

### C) Drift de stack/arquitetura em documentos de ciclo anterior (médio-alto)

Ainda há documentação com linguagem/estrutura de fases anteriores (parser legado, rotas antigas, análises de migração pontuais).

Exemplos:

- docs/API/CONCIERGE_PARSER_API_DOCUMENTATION.md
- docs/archive/API_V3_STATUS.md
- docs/archive/api-planning/API_V3_INTEGRATION_SPEC.md
- docs/archive/API_SERVICE_V3_SPECIFICATION.md

Impacto: decisão técnica baseada em contexto histórico em vez de estado atual.

### D) Sobreposição documental e alto acoplamento histórico (médio)

Existe concentração de conteúdo de transição (roadmaps, análises, migration notes) fora de estrutura única de governança.

Impacto: custo alto de manutenção e leitura ambígua para novos colaboradores.

---

## 7) Priorização de risco (resultado da varredura)

Top de arquivos com maior score de risco documental (considerando URL legada, stack legado, drift de auth e marcadores de obsolescência):

1. docs/DOCUMENTATION_AUDIT_2026_01_30.md
2. docs/API/API_AUDIT_REPORT.md
3. docs/API/API_DOCUMENTATION_V3.md
4. docs/COLLECTOR_V3_IMPLEMENTATION_ROADMAP.md
5. docs/API/API_INTEGRATION_COMPLETE.md
6. docs/archive/investigations/V3_API_SERVER_ISSUES_ANALYSIS.md
7. docs/API/CONCIERGE_PARSER_API_DOCUMENTATION.md
8. docs/API/README.md
9. docs/ENVIRONMENT_DETECTION.md
10. docs/API/API_QUICK_REFERENCE.md

Observação: presença em “alto risco” não implica remoção automática. Em alguns casos o conteúdo é histórico útil e deve ser movido/reclassificado, não apagado.

---

## 8) Classificação inicial por bloco (baseline)

### Bloco: API

- Estado: Parcial/Conflitante
- Motivo: mistura de conteúdo atualizado com exemplos e URLs legadas

### Bloco: Auth

- Estado: Parcial
- Motivo: implementação dual no código, mas narrativa ainda heterogênea em docs e comentários de config

### Bloco: Arquitetura e Roadmaps

- Estado: Parcial/Histórico
- Motivo: vários documentos de planejamento coexistindo com operação atual

### Bloco: AI/Semântica

- Estado: Parcial
- Motivo: boa cobertura funcional, porém alguns nomes/serviços e fluxos exigem reconciliação fina com código atual

### Bloco: Deploy

- Estado: Parcial
- Motivo: coexistência de referências atuais e legadas

### Bloco: UI e Testing

- Estado: Predominantemente Atual/Parcial
- Motivo: menor incidência de drift crítico, mas com sobreposição de relatórios de fase

### Bloco: Archive

- Estado: Histórico
- Motivo: volume alto e útil para contexto, mas requer fronteira mais explícita com docs ativos

---

## 9) Critérios de completude da investigação (atingimento)

- Inventário completo: Atingido
- Taxonomia e status de classificação definidos: Atingido
- Mapa de risco por arquivo com evidência objetiva: Atingido
- Confronto doc vs código em áreas críticas (API/Auth/Schema/Sync): Atingido
- Baseline para fase 2 (governança): Atingido

---

## 10) Saída pronta para a próxima fase

Este documento fecha a fase de investigação e habilita a fase 2 de gerenciamento documental com foco em:

- Organizar histórico sem perder rastreabilidade
- Definir conjunto mínimo de documentos ativos chave
- Resolver conflitos de fonte de verdade
- Reduzir duplicação e drift contínuo

Recomendação de próximo passo imediato:

- Construir plano de governança em três trilhas:
  1) Curadoria de conteúdo ativo
  2) Política de arquivamento histórico
  3) Regra contínua de validação doc-código

Plano de fase 2 publicado em:

- `docs/DOCUMENTATION_GOVERNANCE_PLAN_2026_02_18.md`
