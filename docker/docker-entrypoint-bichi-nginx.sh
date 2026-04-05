#!/bin/sh
set -e
# Sustituye solo BICHI_SITE_HOST; el resto ($host, etc.) lo deja Nginx.
export BICHI_SITE_HOST="${BICHI_SITE_HOST:-bichipishi.127.0.0.1.nip.io bichipishi.home}"
PROFILE="${BICHI_NGINX_PROFILE:-host-api}"
OUT=/etc/nginx/conf.d/default.conf
if [ "$PROFILE" = "docker-api" ]; then
  TEMPLATE=/etc/nginx/bichi-templates/docker-api.conf.template
else
  TEMPLATE=/etc/nginx/bichi-templates/host-api.conf.template
fi
if [ ! -f "$TEMPLATE" ]; then
  echo "bichi: falta plantilla $TEMPLATE" >&2
  exit 1
fi
envsubst '${BICHI_SITE_HOST}' <"$TEMPLATE" >"$OUT"
echo "bichi: server_name incluye ${BICHI_SITE_HOST} (+ localhost 127.0.0.1 localtest.me)"
