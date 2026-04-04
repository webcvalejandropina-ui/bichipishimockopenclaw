#!/bin/sh
set -e
# Sobrescribe bichi-brand.js para personalizar sin rebuild (PUBLIC_* del contenedor).
PN="${PUBLIC_BICHI_APP_NAME:-}"
UR="${PUBLIC_BICHI_AVATAR_URL:-}"
echo "window.__BICHI_BRAND__ = $(jq -n \
  --arg n "$PN" \
  --arg u "$UR" \
  '{appName: (if $n == "" then null else $n end), avatarUrl: (if $u == "" then null else $u end)}');" \
  > /usr/share/nginx/html/bichi-brand.js
