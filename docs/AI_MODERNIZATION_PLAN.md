# Plano de Modernização da IA (2026-08-15)

Estado atual auditado: 5 serviços em `openai_configs` (Mongo). `whisper-1` e `text-embedding-3-small` estão correntes (confirmado por pesquisa web — 1536 dims é contratual); **3 serviços ainda em `gpt-4` legado** (restaurant_name_extraction, restaurant_name_extraction_text, concept_extraction_text — o núcleo da extração). Prompts vivem no campo `prompt_template` do Mongo + `promptTemplate.js` no frontend. **Não há política de retry explícita** em `openai_service.py`/`ai_orchestrator.py` (depende só do default do SDK).

## Fase 1 — Modelos recentes (baixo risco, primeiro)

**Alvos PESQUISADOS (web, ago/2026):** a família atual da OpenAI é **GPT-5.6** — `gpt-5.6-sol` (flagship, $5/$30), `gpt-5.6-terra` (default equilibrado, $2/$12), `gpt-5.6-luna` (alto volume, $0.20/$1.20). `gpt-4.1`/`gpt-4o` são legado API-only (retirados do picker do ChatGPT em fev/2026). Contexto de 1.05M em todos; reasoning effort ajustável.

- [x] ~~`concept_extraction_text` → **`gpt-5.6-terra`**~~ ✓ (extração real validada: JSON estruturado OK)
- [x] ~~`restaurant_name_extraction` + `restaurant_name_extraction_text` → **`gpt-5.6-luna`**~~ ✓ (nome extraído OK)
- [ ] `image_analysis` (`gpt-4o` atual): avaliar migração para gpt-5.6-terra — validar suporte a visão antes
- [ ] `reasoning_effort` none/minimal nas extrações (terra usou 98 reasoning tokens sozinho — avaliar)
- [x] ~~Validar end-to-end com amostra real~~ ✓ (SDK direto; LM Studio shadow contornado com env -u)
- [x] ~~Update cirúrgico no Mongo~~ ✓ (3 rows; NUNCA re-rodar o seed)
- [x] ~~Contrato empírico da família 5.6~~ ✓ — `max_tokens` REJEITADO (usar `max_completion_tokens`), `temperature` só aceita 1 (omitir). openai_service.py agora lê os params do config (fonte única) em vez de hardcodar — código ajustado e testado (206 unit ✓)

**Nota de qualidade observada na validação:** o prompt atual deixa passar `"price_range": ["Mid-range"]` (maiúscula) e categorias livres ("Family-style") — a Fase 2/3 ataca exatamente isso (vocabulário forçado + validação).

## Fase 2 — Prompts melhores

- [x] ~~Auditar os `prompt_template` dos 5 serviços + `promptTemplate.js`~~ ✓ (todos dumpados; concept é o crítico)
- [x] ~~JSON schema explícito~~ ✓ (concept_extraction_text: só as chaves das categorias + confidence_score; omitir vazias; nunca inventar campos)
- [x] ~~Vocabulário FORÇADO~~ ✓ (concept: lowercase em todas as tags, exceções menu/price_and_payment; price_range exatamente um de unexpensive|mid-range|expensive; promptTemplate.js alinhado — antes dizia "inexpensive, moderate, expensive")
- [ ] Few-shot com exemplos reais de curadorias boas
- [ ] Instrução anti-alucinação: "campo ausente = omitir, nunca inventar"

## Fase 3 — Validação de resultado

- [ ] Parse do JSON com Pydantic v2 (schema do orchestrator) — hoje o parse é manual
- [ ] Rejeição de categoria fora do vocabulário → re-prompt único com o erro (não só logar)
- [ ] Validação entity name não-vazio / coerência concepts↔entity

## Fase 4 — Retries

- [ ] `max_retries` explícito no client OpenAI (ex.: 3) com backoff exponencial + jitter
- [ ] Retry de VALIDAÇÃO: resposta inválida → re-request com feedback (máx 2 tentativas, custo limitado)
- [ ] Timeout por chamada (evita request pendurado comendo cota)

## Fase 5 — Pipeline local + testes

- [ ] `research_curations.py` (DeepSeek): mesmos critérios de prompt/validação
- [ ] Testes: parser com respostas malformadas (JSON quebrado, categoria inválida, campo faltando), retry mockado

## Riscos

- Mudança de modelo altera qualidade das extrações em produção → validar com amostra real antes de fechar a fase
- Custo: gpt-4.1 é mais barato que gpt-4 para o mesmo trabalho — economia esperada
- O seed do openai_configs NÃO deve ser re-rodado (apaga/sobrescreve configs de prod)
