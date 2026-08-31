# Local Release Gate

O Concierge não usa GitHub Actions como CI. A verificação canônica do repositório é local e reproduzível, para evitar consumo do free tier e para manter a mesma sequência disponível em qualquer máquina de desenvolvimento ou ambiente de release.

## Gate padrão

```bash
npm run verify
```

O gate padrão executa, em ordem e com fail-fast:

1. Collector build freshness (`build:collector:check`)
2. Collector lint
3. Collector unit tests
4. Admin unit tests
5. Admin typecheck
6. Admin production build com variáveis de teste seguras
7. API unit tests, excluindo integrações, Mongo e APIs externas
8. API formatting (`black --check`)
9. API lint (`flake8`)
10. Generated contract checks

Esse é o comando recomendado antes de push, merge e deploy normal.

## Gate completo

```bash
npm run verify:full
```

O gate completo roda todo o gate padrão e acrescenta:

1. Admin integration tests
2. API integration tests (sem APIs externas/OpenAI)
3. Playwright E2E

O modo completo habilita obrigatoriamente as suites live do CMS:

- `CMS_E2E_AUTH_HANDOFF=1`
- `CMS_E2E_PUBLISH=1`
- `CMS_E2E_EXPLORER=1`

Por isso, `verify:full` exige o stack local de integração disponível: MongoDB de teste, FastAPI em development, Admin CMS, CMS worker e os dados de teste esperados pelas suites E2E. Ele é intencionalmente um release qualification gate; se o stack não estiver pronto, o comando deve falhar em vez de produzir um falso verde.

Por segurança, os alvos E2E (`CMS_E2E_BASE_URL` e `CMS_E2E_FASTAPI_URL`) precisam apontar para loopback (`localhost`, `127.0.0.1` ou `::1`). Um stack remoto descartável só pode ser usado com opt-in explícito:

```bash
CONCIERGE_ALLOW_REMOTE_E2E=1 \
CMS_E2E_BASE_URL=https://admin.staging.example \
CMS_E2E_FASTAPI_URL=https://api.staging.example \
npm run verify:full
```

Nunca use esse override contra produção. Nunca aponte as variáveis de banco usadas por integração para bancos de produção. Os bancos de teste devem manter o sufixo `-test` previsto pelos fixtures e pelas proteções existentes.

## Python portátil

Os scripts de release não assumem mais `concierge-api-v3/venv/bin/python`.

A resolução do interpretador segue esta ordem:

1. `CONCIERGE_PYTHON`
2. `PYTHON`
3. `concierge-api-v3/venv`
4. `concierge-api-v3/.venv`
5. `python3` / `python` (ou `py` / `python` no Windows)

Python 3.13 continua sendo o ambiente de release suportado.

Exemplo:

```bash
CONCIERGE_PYTHON=/opt/homebrew/bin/python3.13 npm run verify
```

## Setup inicial

Instale as dependências JavaScript e Python antes de executar o gate:

```bash
npm ci --legacy-peer-deps
python3 -m pip install -r concierge-api-v3/requirements.txt -r concierge-api-v3/requirements-dev.txt
```

Para E2E com Playwright, instale também o browser necessário conforme o setup do Playwright do projeto.

## Hook pre-push opcional

O hook nunca é ativado automaticamente. Para optar por rodar o gate padrão antes de cada push:

```bash
npm run hooks:enable
```

Esse comando configura `core.hooksPath=.githooks` e garante que `.githooks/pre-push` esteja executável no ambiente local.

Para ignorar o hook em uma situação excepcional, use o mecanismo normal do Git (`git push --no-verify`). A autoridade continua sendo `npm run verify`, não o hook.

## GitHub Actions

Não há workflows ativos em `.github/workflows`. Essa é uma decisão deliberada de custo: qualidade e release qualification são executados localmente, e build/deploy do ambiente continua sendo responsabilidade da plataforma de deployment.
