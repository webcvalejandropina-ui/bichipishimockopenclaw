# Instalación y arranque rápidos (Docker; `make dev` usa pnpm).
.PHONY: install up down logs build-web dev help

help:
	@echo "make install  — igual que sh scripts/install.sh (build + up -d; admite docker-compose legado)"
	@echo "make up       — docker compose up -d"
	@echo "make down     — docker compose down"
	@echo "make logs     — docker compose logs -f"
	@echo "make build-web— solo reconstruye el servicio web (tras cambiar marca en .env)"
	@echo "make dev      — pnpm + API en paralelo (ver README)"

install:
	sh scripts/install.sh

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
