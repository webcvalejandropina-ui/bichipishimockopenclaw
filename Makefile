# Sin Docker: web en dist/, API en metrics-api/, datos en data/. Requiere Bun.
# Con Docker: perfil web-only por defecto (ver docs/DESPLEGUE.md § local).
.PHONY: install deploy dev docker-up docker-up-local docker-up-tunnel docker-up-local-tunnel docker-down docker-logs docker-logs-local docker-build docker-build-local help

help:
	@echo "make install        — .env si falta + bun run deploy"
	@echo "make deploy         — bun run deploy (build + servidor)"
	@echo "make dev            — bun run dev (Astro :4322 + API; /api vía Vite)"
	@echo "make docker-up      — Docker perfil production (dist + API :3001)"
	@echo "make docker-up-local— Docker perfil local (Astro dev :4322 + API :3001)"
	@echo "make docker-up-tunnel — production + Cloudflare Tunnel (host :8080 por defecto; TUNNEL_TOKEN en .env)"
	@echo "make docker-up-local-tunnel — local + Cloudflare Tunnel (API host :8080 por defecto)"
	@echo "make docker-down    — docker compose down (todo el proyecto)"
	@echo "make docker-logs    — logs production"
	@echo "make docker-logs-local — logs local"
	@echo "make docker-build   — build imagen production"
	@echo "make docker-build-local — build imagen local (dev)"

install:
	@test -f .env || cp .env.example .env
	bun run deploy

deploy:
	bun run deploy

dev:
	bun run dev

docker-up:
	bun scripts/docker-local.mjs up production

docker-up-local:
	bun scripts/docker-local.mjs up local

docker-up-tunnel:
	bun scripts/docker-local.mjs up production tunnel

docker-up-local-tunnel:
	bun scripts/docker-local.mjs up local tunnel

docker-down:
	bun scripts/docker-local.mjs down

docker-logs:
	bun scripts/docker-local.mjs logs production

docker-logs-local:
	bun scripts/docker-local.mjs logs local

docker-build:
	bun scripts/docker-local.mjs build production

docker-build-local:
	bun scripts/docker-local.mjs build local
