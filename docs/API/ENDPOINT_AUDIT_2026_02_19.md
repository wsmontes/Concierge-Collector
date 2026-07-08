<!--
Purpose: Registrar auditoria de endpoints da API v3 com validação prática, autenticação real e critério sem fallback.
Main responsibilities: listar endpoint por endpoint (função, status funcional, documentação, melhoria), e separar o que ainda precisa de confirmação manual.
Dependencies: Execuções locais via FastAPI TestClient, configuração de ambiente em concierge-api-v3/.env, documentação em docs/API/* e docs/*.md.
-->

# Auditoria de Endpoints API V3 — 2026-02-19

## Critério aplicado
- Validação feita com autenticação real (`Authorization: Bearer` e/ou `X-API-Key` quando aplicável).
- **Fallback não foi considerado solução funcional principal**.
- Status `OK` = fluxo principal respondeu conforme esperado.
- Status `FAIL` = erro de execução no fluxo principal.
- Status `PENDENTE` = precisa de confirmação adicional endpoint a endpoint (chamadas externas longas/canceladas nesta sessão).

## Respostas diretas (revisão)
1. **Render e variáveis de ambiente**
   - Sim, a API está hospedada no Render.
   - Conferência em produção (`/api/v3/health` e `/api/v3/ai/health`) mostrou serviço saudável e `openai_api_key` como `configured`.
   - O `FAIL` local em endpoints de AI/OpenAI ocorreu por diferença de runtime local (leitura direta de variável de ambiente no processo local), não por ausência no Render.

2. **OpenAI usa prompt/config do Mongo? Há hardcode?**
   - Parcialmente sim.
   - `OpenAIService` usa `OpenAIConfigService` (`openai_configs`) e renderização de `prompt_template` vindo do Mongo para serviços como transcrição, extração e análise de imagem.
   - Ainda há pontos hardcoded fora desse fluxo: por exemplo, embeddings em `curations semantic/hybrid` fixam modelo (`text-embedding-3-small`) e não passam por `openai_configs`.
   - Também existem regras de fallback/categorias em código (não apenas no banco).

3. **Entities/Curations preparados para milhares de registros?**
   - Parcialmente preparados.
   - Há paginação (`limit/offset`), filtros, índices e suporte incremental por `since`.
   - Para escala maior, há gargalos conhecidos: `skip/offset` em páginas profundas, filtros com `regex`, e pontos que ainda fazem varredura completa quando não há índice vetorial disponível.
   - Erros de índice único com `null` (`externalId`, `entity_id`) indicam necessidade de saneamento para operação estável em alto volume.

4. **Autenticação ativa hoje**
   - Não é só Google Auth.
   - Existem duas vias ativas para endpoints protegidos (principalmente `entities`, `curations`, `ai`):
     - `Authorization: Bearer <JWT>` (fluxo OAuth Google para usuários)
     - `X-API-Key` (integração/sistema)
   - Além disso, vários endpoints são públicos (ex.: `health`, `info`, parte de `llm/openai/places`).

## Evidências de autenticação
- `entities` aceita `Bearer` sozinho e `X-API-Key` sozinho (ambos retornaram `201` em criação).
- `auth/verify`, `auth/refresh`, `auth/logout` confirmados com `Bearer` válido.

## Resultado endpoint por endpoint

| Endpoint | O que faz | Auth | Status | Documentado | Pode melhorar? |
|---|---|---|---|---|---|
| GET /api/v3/health | Health geral da API | Pública | OK (200) | Sim | Incluir checks de dependências externas |
| GET /api/v3/info | Metadados da API | Pública | OK (200) | Sim | Incluir build/commit |
| GET /api/v3/auth/google | Inicia OAuth Google | Pública | OK (307) | Sim | Teste e2e com provedor real |
| GET /api/v3/auth/callback | Recebe callback OAuth | Pública | OK técnico (400 sem `code/state`) | Sim | Cobrir caso real com `code` válido |
| GET /api/v3/auth/verify | Valida token JWT e usuário | Bearer | OK (200) | Sim | Mensagens de erro mais objetivas |
| POST /api/v3/auth/refresh | Renova access token | Bearer body refresh | OK (200) | Sim | Rotação/blacklist de refresh tokens |
| POST /api/v3/auth/logout | Logout lógico | Bearer | OK (200) | Sim | Invalidar token server-side |
| GET /api/v3/concepts/ | Lista conceitos ativos | Pública | OK (200) | Sim | Paginação/filtro |
| GET /api/v3/concepts/{entity_type} | Conceitos por tipo | Pública | OK técnico (404 para `restaurant` sem dados ativos) | Sim | Seed mínimo para tipos base |
| POST /api/v3/entities | Cria entidade | Bearer ou X-API-Key | OK (201) | Sim | Exemplo canônico de payload |
| GET /api/v3/entities/{entity_id} | Lê entidade | Pública | OK (200) | Sim | Expand opcional |
| PATCH /api/v3/entities/{entity_id} | Atualiza entidade com `If-Match` | Bearer ou X-API-Key | OK (200) | Sim | Padronizar erro de conflito |
| DELETE /api/v3/entities/{entity_id} | Remove entidade | Bearer ou X-API-Key | OK (204) | Sim | Soft delete opcional |
| GET /api/v3/entities | Lista entidades com filtros | Pública | OK (200) | Sim | Ordenação default explícita |
| POST /api/v3/curations | Cria curation | Bearer ou X-API-Key | OK (201) | Sim | Exemplo mínimo e exemplo completo |
| GET /api/v3/curations/entities/{entity_id}/curations | Lista curations da entidade | Pública | OK (200) | Sim | Paginação |
| GET /api/v3/curations/{curation_id} | Lê curation | Pública | OK (200) | Sim | Expor metadado de versão |
| PATCH /api/v3/curations/{curation_id} | Atualiza curation | Bearer ou X-API-Key | OK (200) | Sim | Regras de concorrência mais explícitas |
| DELETE /api/v3/curations/{curation_id} | Soft delete curation | Bearer ou X-API-Key | OK (204) | Sim | Retorno opcional de tombstone |
| GET /api/v3/curations/search | Busca/lista curations | Pública | OK (200) | Sim | Ordenação e filtros avançados |
| POST /api/v3/curations/semantic-search | Busca semântica | Pública | FAIL (500 OpenAI key) | Sim | Ler chave da config central + erro 503 claro |
| POST /api/v3/curations/hybrid-search | Busca híbrida | Pública | FAIL (500 OpenAI key) | Sim | Mesmo ajuste de configuração |
| POST /api/v3/llm/search-restaurants | Busca restaurantes para LLM | Pública | OK (200) | Sim | Telemetria por fonte |
| POST /api/v3/llm/get-restaurant-snapshot | Snapshot consolidado | Pública | OK (200)
(com observação de fallback interno no serviço) | Sim | Remover dependência de fallback para sucesso |
| POST /api/v3/llm/get-restaurant-availability | Disponibilidade consolidada | Pública | OK (200)
(com observação de fallback interno no serviço) | Sim | Mesmo ponto do snapshot |
| GET /api/v3/llm/health | Health LLM gateway | Pública | OK (200) | Sim | Latência/métricas |
| GET /api/v3/llm/tools | Lista tools LLM | Pública | OK (200) | Sim | Versionar catálogo |
| GET /api/v3/llm/tools-manifest | Manifesto de tools | Pública | OK (200) | Sim | Capabilities por tool |
| GET /api/v3/openai/v1/models | Lista modelos compatíveis | Pública | OK (200) | Sim | Metadados de capacidades |
| GET /api/v3/openai/v1/functions | Lista funções compatíveis | Pública | OK (200) | Sim | Schema mais estrito por função |
| POST /api/v3/openai/v1/chat/completions | Chat compatível OpenAI | Pública | OK (200) | Sim | Testes de tool calls paralelos |
| GET /api/v3/places/health | Health Google Places | Pública | OK (200) | Sim | Check de quota em tempo real |
| GET /api/v3/places/nearby | Busca nearby | Pública | PENDENTE | Sim | Confirmar com timeout dedicado e payload fixo |
| GET /api/v3/places/details/{place_id} | Detalhes de place | Pública | PENDENTE | Sim | Confirmar com place_id válido fixo |
| GET /api/v3/places/{place_id}/photos | Fotos de place | Pública | PENDENTE | Sim | Confirmar com place_id válido fixo |
| POST /api/v3/places/orchestrate | Orquestra operação places | Pública | OK técnico (400 com body vazio) | Sim | Validar cenário feliz com payload completo |
| GET /api/v3/ai/health | Health AI | Pública | OK (200, unhealthy por key) | Sim | Separar health de config e health funcional |
| GET /api/v3/ai/health/original | Health legado AI | Pública | OK (200) | Parcial | Documentar ou remover endpoint legado |
| POST /api/v3/ai/extract-restaurant-name | Extrai nome de restaurante | Bearer ou X-API-Key | FAIL (500 OpenAI key) | Sim | Unificar leitura de chave OpenAI |
| GET /api/v3/ai/usage-stats | Estatísticas de uso AI | Pública | FAIL (500 OpenAI key) | Sim | Mesmo ajuste de configuração |
| POST /api/v3/ai/orchestrate | Orquestra fluxo AI | Bearer ou X-API-Key | FAIL (500 OpenAI key) | Sim | Mesmo ajuste + retorno de erro operacional |

## Pendências para confirmação “um por um”
1. `GET /api/v3/places/nearby` com payload fixo e timeout dedicado.
2. Reaproveitar `place_id` válido retornado no passo 1 para:
   - `GET /api/v3/places/details/{place_id}`
   - `GET /api/v3/places/{place_id}/photos`
3. `POST /api/v3/places/orchestrate` com payload válido (não vazio).
4. Repetir endpoints OpenAI/AI após corrigir fonte de `OPENAI_API_KEY` no runtime.

## Observações técnicas relevantes
- Startup registra erro de índice único em `entities.externalId` para `null`; não bloqueou os testes, mas é dívida técnica.
- Em chamadas LLM houve erro de índice único `entity_id: null` em criação automática de entidade; não impediu resposta 200 no endpoint testado, mas indica inconsistência de dados/índice.