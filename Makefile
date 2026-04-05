# Requiere Docker con "docker compose"
.PHONY: install up down logs build-web dev help

help:
	@echo "make install  — .env si falta + docker compose up --build -d"
	@echo "make up       — docker compose up -d"
	@echo "make down     — docker compose down"
	@echo "make logs     — docker compose logs -f"
	@echo "make build-web— docker compose build web"
	@echo "make dev      — pnpm + API (ver README)"

install:
	@test -f .env || cp .env.example .env
	docker compose up --build -d

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

build-web:
	docker compose build web

dev:
	@command -v pnpm >/dev/null || { echo "Instala pnpm (corepack enable)"; exit 1; }
	pnpm install
	cd metrics-api && npm install
	cd .. && pnpm dev
