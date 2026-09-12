# Imagem única do serviço Concierge: API + Admin (Payload) + jobs no mesmo container.
#
# Por que existe: antes eram três serviços pagos no Render (API, Admin, Worker)
# para um sistema sem clientes. Aqui os três processos convivem, com nginx
# roteando uma única porta, o que reduz para uma instância sem perder nenhuma
# funcionalidade.
#
# Base Python (a API é o serviço principal) com o Node copiado da imagem
# oficial — assim a versão do Python é a 3.12 exigida pela API e a do Node é a
# 22 exigida por apps/admin (engines: >=22.12 <23), sem depender de repositório
# de terceiros para nenhuma das duas.

# ---------------------------------------------------------------------------
# Estágio 1: build do Admin (Next + Payload)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS admin-builder

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY packages/fastapi-client/package.json packages/fastapi-client/package.json
RUN npm ci --include=dev --legacy-peer-deps
COPY . ./

# Payload config is evaluated by next build. These non-secret placeholders are
# only for compilation; Render replaces every operational value at runtime.
ENV CMS_MONGODB_URL=mongodb://placeholder.invalid:27017 \
    CMS_MONGODB_DB_NAME=concierge-cms \
    CMS_SERVICE_KEY=build-only-cms-service-key \
    CMS_PUBLIC_SERVER_URL=https://api.concierge-collector.com \
    FASTAPI_BASE_URL=https://api.concierge-collector.com \
    METRICS_KEY=build-only-metrics-key \
    PAYLOAD_SECRET=build-only-payload-secret-at-least-32-chars

# Cliente de contratos: apps/admin importa '@concierge/fastapi-client', cujo
# `exports` aponta para ./dist/index.js. Esse dist é GERADO (não versionado) e o
# .dockerignore exclui `dist`, então ele precisa ser produzido aqui. O gerador
# lê o snapshot versionado contracts/openapi/fastapi-admin-internal.v1.json, sem
# depender de Python nem do FastAPI durante o build.
RUN npm run generate --workspace=@concierge/fastapi-client \
 && npm run build --workspace=@concierge/fastapi-client

RUN npm run build --workspace=@concierge/admin

# ---------------------------------------------------------------------------
# Estágio 2: runtime único
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

# Node vindo da imagem oficial (mesma versão que compilou o admin).
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# nginx = roteamento de uma porta só; supervisor = mantém os processos vivos;
# libstdc++6 = dependência do binário do Node em base Debian slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      nginx supervisor ca-certificates libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Admin já compilado (inclui apps/admin/.next e o dist do cliente de contratos).
COPY --from=admin-builder /app/package.json /app/package-lock.json ./
COPY --from=admin-builder /app/node_modules ./node_modules
COPY --from=admin-builder /app/apps/admin ./apps/admin
COPY --from=admin-builder /app/packages ./packages

# API e o app de captura. capture/ fica na RAIZ porque main.py resolve
# Path(__file__).parents[1] / "capture" — a mesma estrutura do repo.
COPY concierge-api-v3 ./concierge-api-v3
COPY capture ./capture

COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/supervisord.conf /etc/supervisor/conf.d/concierge.conf
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh

# venv fora da árvore do repo (/opt/venv): o uvicorn do supervisor é chamado por
# caminho absoluto, então nada depende de ativação de ambiente.
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir -r concierge-api-v3/requirements.txt \
 && rm -rf /app/concierge-api-v3/venv

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1

EXPOSE 10000
CMD ["/usr/local/bin/entrypoint.sh"]
