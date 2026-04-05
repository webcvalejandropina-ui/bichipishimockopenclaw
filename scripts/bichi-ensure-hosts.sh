#!/usr/bin/env bash
# Sincroniza /etc/hosts con los nombres de BICHI_SITE_HOST (bloque entre marcadores).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOSTS="/etc/hosts"
MARK_BEGIN="# >>> bichipishi-hosts"
MARK_END="# <<< bichipishi-hosts"

if [ "${BICHI_SKIP_HOSTS:-}" = "1" ] || [ "${CI:-}" = "true" ]; then
  echo "bichi-ensure-hosts: omitido (BICHI_SKIP_HOSTS=1 o CI=true)."
  exit 0
fi

case "$(uname -s)" in
Darwin | Linux) ;;
*)
  echo "bichi-ensure-hosts: solo macOS/Linux; si hace falta, edita /etc/hosts a mano."
  exit 0
  ;;
esac

V=""
if [ -f "$ROOT/config/site.env" ]; then
  LINE="$(grep -E '^[[:space:]]*BICHI_SITE_HOST=' "$ROOT/config/site.env" | grep -v '^[[:space:]]*#' | tail -1 || true)"
  if [ -n "$LINE" ]; then
    V="${LINE#*=}"
    V="${V%$'\r'}"
    V="${V#\"}"
    V="${V%\"}"
    V="${V#\'}"
    V="${V%\'}"
  fi
fi

NEEDED=""
should_skip() {
  local h="$1"
  [[ "$h" == *nip.io* ]] && return 0
  [[ "$h" == "localhost" ]] && return 0
  [[ "$h" == "127.0.0.1" ]] && return 0
  [[ "$h" == "localtest.me" ]] && return 0
  [[ "$h" == *.localtest.me ]] && return 0
  return 1
}

add_if_needed() {
  local h="$1"
  case "$h" in
  *[!a-zA-Z0-9.-]* | '')
    return
    ;;
  esac
  should_skip "$h" && return
  case " $NEEDED " in
  *" $h "*) ;;
  *)
    NEEDED="${NEEDED:+$NEEDED }$h"
    ;;
  esac
}

for tok in $V; do
  add_if_needed "$tok"
done

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

awk -v begin="$MARK_BEGIN" -v end="$MARK_END" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  skip { next }
  { print }
' "$HOSTS" >"$TMP"

if [ -n "$NEEDED" ]; then
  {
    echo "$MARK_BEGIN"
    echo "# Gestionado por scripts/bichi-ensure-hosts.sh (config/site.env → BICHI_SITE_HOST)."
    echo "127.0.0.1 $NEEDED"
    echo "$MARK_END"
  } >>"$TMP"
fi

if cmp -s "$HOSTS" "$TMP" 2>/dev/null; then
  echo "bichi-ensure-hosts: /etc/hosts ya está al día."
  exit 0
fi

if [ -n "$NEEDED" ]; then
  echo "bichi-ensure-hosts: añadiendo o actualizando entradas para: $NEEDED"
else
  echo "bichi-ensure-hosts: quitando bloque bichipishi (BICHI_SITE_HOST solo usa DNS, p. ej. nip.io)."
fi
echo "  Requiere escribir en /etc/hosts (sudo). Desactiva con BICHI_SKIP_HOSTS=1 si no quieres."
if ! sudo -n true 2>/dev/null; then
  echo "  Si te la pide, introduce la contraseña de administrador."
fi
sudo cp "$TMP" "$HOSTS"
echo "bichi-ensure-hosts: listo."
