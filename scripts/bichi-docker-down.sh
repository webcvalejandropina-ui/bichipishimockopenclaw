#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
docker compose down
PID_FILE="$ROOT/.bichi-api.pid"
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
    echo "Deteniendo metrics-api (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    sleep 0.5
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi
