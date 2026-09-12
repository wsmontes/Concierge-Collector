#!/bin/sh
# Entrypoint do serviço único do Concierge.
#
# Gera a config do nginx com a porta que o Render injeta ($PORT) e entrega o
# controle ao supervisord, que mantém API, Admin, jobs e edge vivos.
set -e

PORT="${PORT:-10000}"

# PORT é validado antes de entrar na config: um valor não numérico geraria
# nginx inválido e o container subiria sem servir nada (falha silenciosa).
case "$PORT" in
    ''|*[!0-9]*)
        echo "PORT inválido: '$PORT' (esperado numérico)" >&2
        exit 1
        ;;
esac

sed "s/__PORT__/${PORT}/g" /etc/nginx/templates/default.conf.template \
    > /etc/nginx/conf.d/default.conf

# O pacote do nginx instala um site default em :80 que não queremos servir.
rm -f /etc/nginx/sites-enabled/default

mkdir -p /run /var/log/supervisor
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/concierge.conf
