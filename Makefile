# Requiere Docker + bash (macOS/Linux). En Windows usa pnpm run docker:up o dos terminales (ver README).
.PHONY: install up down logs build-web dev help

help:
	@echo "make install   — .env si falta + bash scripts/bichi-docker-up.sh (API host + UI Docker)"
	@echo "make up        — bash scripts/bichi-docker-up.sh"
	@echo "make down      — bash scripts/bichi-docker-down.sh"
	@echo "make logs      — docker compose logs -f"
	@echo "make build-web — docker compose build web"
	@echo "make dev       — pnpm + API (ver README)"

install:
	@test -f .env || cp .env.example .env
	bash scripts/bichi-docker-up.sh

up:
	bash scripts/bichi-docker-up.sh

down:
	bash scripts/bichi-docker-down.sh

logs:
	docker compose logs -f

build-web:
	docker compose build web

dev:
	@command -v pnpm >/dev/null || { echo "Instala pnpm (corepack enable)"; exit 1; }
	pnpm install
	cd metrics-api && npm install
	cd .. && pnpm dev
