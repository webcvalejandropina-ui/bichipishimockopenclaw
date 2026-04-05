# Requiere Docker + Node. Mismo comando en Windows (PowerShell/CMD): pnpm run bichi:up
.PHONY: install up down logs build-web dev help

help:
	@echo "make install   — .env si falta + node scripts/bichi-up.mjs (API en el PC + UI Docker)"
	@echo "make up        — node scripts/bichi-up.mjs"
	@echo "make down      — node scripts/bichi-down.mjs"
	@echo "make logs      — docker compose logs -f"
	@echo "make build-web — docker compose build web"
	@echo "make dev       — pnpm + API (ver README)"

install:
	@test -f .env || cp .env.example .env
	node scripts/bichi-up.mjs

up:
	node scripts/bichi-up.mjs

down:
	node scripts/bichi-down.mjs

logs:
	docker compose logs -f

build-web:
	docker compose build web

dev:
	@command -v pnpm >/dev/null || { echo "Instala pnpm (corepack enable)"; exit 1; }
	pnpm install
	cd metrics-api && npm install
	cd .. && pnpm dev
