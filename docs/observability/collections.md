# Observabilidade de Collections

As quatro aplicações usam um `request_id` seguro. A API aceita somente
`X-Request-Id` com até 128 caracteres de `[A-Za-z0-9._:-]`; qualquer outro
valor é substituído por UUID e devolvido na resposta. Logs não devem conter
headers, corpos, tokens, chaves, transcrições ou identificadores de curadoria.

## Endpoints

| Serviço | Liveness | Readiness | Métricas |
| --- | --- | --- | --- |
| FastAPI | `/api/v3/health` | `/api/v3/ready` | `/api/v3/metrics` |
| Admin Payload | `/health` | `/ready` | `/metrics` |
| Worker Payload | `/health/worker` | — | métricas do Admin |

Os endpoints de métricas exigem `X-Metrics-Key` igual a `METRICS_KEY`. Essa
chave é independente de JWT, `X-API-Key`, `CMS_SERVICE_KEY` e credenciais de
consumer. Uma chave ausente ou inválida recebe `401`; cookies e Bearer nunca
servem como substituto.

## Métricas e alertas

Os labels permitidos são de baixa cardinalidade: método, rota estável, status,
tipo/estado de job e nome de fila. Não usar email, URL, token, `curation_id`,
slug dinâmico ou mensagem de exceção como label.

- `concierge_api_http_requests_total` e
  `concierge_api_http_request_duration_seconds`: taxa, erros e latência da API.
- `concierge_admin_collection_jobs_total` e
  `concierge_admin_collection_job_duration_seconds`: execução de operações e
  publicação.
- `concierge_admin_collection_queue_depth`: backlog por fila.

Alertar quando o worker fica sem heartbeat por mais de três minutos com
backlog, quando a idade do job mais antigo cresce, quando aumentam retries/5xx
ou conflitos de publish e quando a disponibilidade da dependência de
curadorias piora. O alerta deve conter IDs operacionais de job/collection no
evento estruturado, nunca como label Prometheus.
