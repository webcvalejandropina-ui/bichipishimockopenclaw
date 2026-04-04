#!/bin/sh
# Instalación portable: POSIX sh (Alpine, Debian, dash, etc.) + detección de Compose.
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Necesitas Docker instalado (Docker Desktop, Engine o Podman con compatibilidad)."
  echo "Guía: https://docs.docker.com/get-docker/"
  exit 1
fi

DOCKER_COMPOSE="docker compose"
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
  else
    echo "No se encontró «docker compose» (v2). Instala el plugin Compose o el paquete docker-compose."
    exit 1
  fi
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Creado .env desde .env.example (revísalo si quieres personalizar marca o puertos)."
fi

$DOCKER_COMPOSE up --build -d

echo ""
echo "Listo. UI: http://localhost:8080"
echo "API:  http://localhost:3001/api/metrics"
echo ""
echo "En Windows sin bash: ejecuta scripts\\install.ps1 en PowerShell."
