#!/usr/bin/env bash
# Arranca metrics-api en el host (3001) si no responde, luego docker compose (solo web).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if docker inspect bichipishi-metrics >/dev/null 2>&1; then
  echo "Bajando stack anterior (API en contenedor) para usar la API en el Mac..."
  docker compose -f docker-compose.full-docker.yml down 2>/dev/null || docker rm -f bichipishi-metrics 2>/dev/null || true
fi

METRICS_URL="http://127.0.0.1:3001/api/metrics"
PID_FILE="$ROOT/.bichi-api.pid"

api_ok() {
  curl -sf "$METRICS_URL" >/dev/null 2>&1
}

if api_ok; then
  echo "API ya responde en :3001 (métricas del sistema host)."
else
  if [ -f "$PID_FILE" ]; then
    OLD="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "${OLD:-}" ] && kill -0 "$OLD" 2>/dev/null; then
      echo "Esperando API (PID $OLD)..."
    else
      rm -f "$PID_FILE"
    fi
  fi
  if ! api_ok; then
    if [ ! -d metrics-api/node_modules ]; then
      echo "Instalando dependencias de metrics-api..."
      (cd metrics-api && npm ci --omit=dev)
    fi
    echo "Iniciando metrics-api en el host (puerto 3001)..."
    (
      cd "$ROOT/metrics-api"
      nohup env NODE_ENV=production node server.js >>"$ROOT/.bichi-api.log" 2>&1 &
      echo $! >"$PID_FILE"
    )
    for i in $(seq 1 30); do
      if api_ok; then
        echo "API lista."
        break
      fi
      sleep 0.3
    done
    if ! api_ok; then
      echo "Error: la API no arrancó en 3001. Mira $ROOT/.bichi-api.log"
      exit 1
    fi
  fi
fi

bash "$ROOT/scripts/bichi-ensure-hosts.sh"

docker compose up --build -d

# Primer token de BICHI_SITE_HOST = URL principal en el mensaje final
SITE_HOST=bichipishi.home
HOSTS_LINE=""
if [ -f "$ROOT/config/site.env" ]; then
  LINE="$(grep -E '^[[:space:]]*BICHI_SITE_HOST=' "$ROOT/config/site.env" | grep -v '^[[:space:]]*#' | tail -1 || true)"
  if [ -n "$LINE" ]; then
    V="${LINE#*=}"
    V="${V%$'\r'}"
    V="${V#\"}"
    V="${V%\"}"
    V="${V#\'}"
    V="${V%\'}"
    SITE_HOST="${V%% *}"
    HOSTS_LINE="$V"
  fi
fi
[ -z "$SITE_HOST" ] && SITE_HOST=bichipishi.home

echo "Listo. Abre: http://${SITE_HOST}/  (config/site.env → BICHI_SITE_HOST)"
if [[ "$SITE_HOST" == *nip.io* ]]; then
  echo "Este host resuelve por DNS (nip.io); no hace falta /etc/hosts."
else
  echo "Los nombres de sitio se sincronizan en /etc/hosts al arrancar (scripts/bichi-ensure-hosts.sh; ver README)."
fi
echo "Siempre: http://localtest.me  http://127.0.0.1"
echo "Parar: bash scripts/bichi-docker-down.sh"
