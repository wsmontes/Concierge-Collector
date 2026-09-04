# Collections Admin — implantação no Render

**Data:** 2026-09-03
**Status:** aguardando revisão

## Objetivo

Publicar o Collections Admin com segurança, sem expor Collections ao tráfego
de produção antes de uma qualificação reprodutível em staging.

## Estado conhecido

- O Render possui os serviços de produção `Concierge-Collector` (API) e
  `Concierge-Collector-Web` (site estático), ambos ligados à `main`.
- Não há serviço Render para o Admin Payload nem worker de jobs.
- `admin.concierge-collector.com` ainda não possui DNS publicamente resolvível.
- O Admin é construído por `Dockerfile.admin`; o worker usa a mesma imagem,
  com o comando `npm run start:admin-worker`.
- O merge de Collections está em `main` no commit
  `2d654d42090587d1430ac795afcda2ccb4546d6d`.

## Arquitetura alvo

```text
Collector Web ──┐
                ├── FastAPI (serviço Render existente) ── MongoDB Atlas
Admin Web ──────┘                  ▲
                                  │ sessão, callbacks e serviços internos
Admin Worker (Render) ────────────┘
```

O Admin Web e o Worker são serviços separados, usando a mesma imagem e o
mesmo banco CMS. Apenas o Admin Web recebe um domínio público. O Worker não
recebe domínio nem tráfego HTTP externo.

## Fase 1 — qualidade e staging

1. Corrigir o teste do gate de aceitação para ler a fixture como caminho de
   arquivo no ambiente JSDOM.
2. Criar um Admin Web de staging e um Worker de staging no Render. Ambos
   usam banco com sufixo `-test` e valores de URL/callback exclusivos de
   staging.
3. Configurar apenas os nomes e valores necessários no dashboard do Render:
   `CMS_MONGODB_URL`, `CMS_MONGODB_DB_NAME`, `PAYLOAD_SECRET`,
   `CMS_SERVICE_KEY`, `CMS_PUBLIC_SERVER_URL`, `FASTAPI_BASE_URL`,
   `METRICS_KEY` e flags. Segredos nunca entram no Git ou em logs.
4. Executar `npm run verify:full`, migrations com lock, e
   `scripts/operations/cms-backup-restore-smoke.sh` contra destinos
   descartáveis.
5. Rodar carga, concorrência, recuperação, autenticação e contratos em
   staging. Registrar os resultados em `docs/evidence/collections-staging.json`
   para o SHA efetivamente implantado e validar os 20 critérios do gate.

Nenhuma flag de Collections será habilitada em produção nesta fase.

## Fase 2 — produção

1. Criar o Admin Web e Worker de produção com a imagem já qualificada.
2. Apontar `admin.concierge-collector.com` ao Admin Web e aguardar DNS/TLS
   saudável antes de tornar o link público.
3. Atualizar a configuração da API existente para aceitar a origem exata do
   Admin e o callback de autenticação; manter as origens explícitas, sem
   wildcard.
4. Executar migrations uma vez sob o lock existente. Fazer backup/restore
   smoke antes de habilitar qualquer flag.
5. Confirmar saúde da API, Mongo, storage, worker heartbeat, filas e erros
   antes de abrir tráfego.

## Fase 3 — canário de flags

Cada passo registra SHA, operador, horário, valor anterior e evidência. Só
avança após observar saúde e invariantes da etapa atual:

1. `CMS_AUTH_ENABLED=true`
2. `CATALOG_SCAN_ENABLED=true`
3. `COLLECTIONS_ADMIN_ENABLED=true`
4. `COLLECTOR_ASSOCIATION_READ_ENABLED=true`
5. `COLLECTOR_DRAFT_MUTATION_ENABLED=true`
6. `CONSUMER_CREDENTIALS_ENABLED=true`
7. `COLLECTIONS_DISTRIBUTION_ENABLED=true`

Distribuição externa e credenciais permanecem desligadas até as etapas finais.

## Falhas e reversão

- Antes de exposição pública: suspender os novos serviços e manter flags
  desligadas.
- Após uma flag: reverter somente a última flag e seguir
  `docs/runbooks/collections-rollback.md`.
- Para uma Collection ruim: arquivar a Collection; não apagar dados nem
  reescrever intervalos publicados.
- Não executar rollback de dados que reduza retenção de evidências.

## Critérios de conclusão

- Admin Web e Worker estão `live` no Render.
- DNS/TLS e login em `admin.concierge-collector.com` funcionam.
- Migrations, restore smoke, gate completo e evidência de staging passam.
- As flags habilitadas foram liberadas em canário e registradas.
- Métricas, fila, heartbeat, API, Mongo e storage foram observados sem
  regressão durante cada etapa.
