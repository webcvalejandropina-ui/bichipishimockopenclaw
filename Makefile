# Sin Docker: web en dist/, API en metrics-api/, datos en data/. Requiere Bun.
.PHONY: install deploy dev help proxy-dev proxy-prod

help:
	@echo "make install — .env si falta + bun run deploy"
	@echo "make deploy  — bun run deploy (build + servidor)"
	@echo "make dev     — bun run dev"
	@echo "make proxy-dev  — sudo caddy :80 -> Astro (tras make dev)"
	@echo "make proxy-prod — sudo caddy :80 -> API (tras servidor en 3001)"

install:
	@test -f .env || cp .env.example .env
	bun run deploy

deploy:
	bun run deploy

dev:
	bun run dev

proxy-dev:
	sudo caddy run --config ./config/caddy-bichipishi-dev.caddyfile

proxy-prod:
	sudo caddy run --config ./config/caddy-bichipishi-prod.caddyfile
