# syntax=docker/dockerfile:1
# Build y runtime con Bun (sin npm). Lockfile: bun.lock
# Cliente Docker (CLI) en runtime para el perfil full-host.

FROM oven/bun:1 AS builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
COPY metrics-api/package.json metrics-api/
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
COPY metrics-api ./metrics-api
COPY config ./config

ENV NODE_ENV=development
ENV ASTRO_TELEMETRY_DISABLED=1
RUN bun install --frozen-lockfile
RUN bun run build:astro

FROM oven/bun:1 AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/metrics-api

COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/metrics-api /app/metrics-api
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/config /app/config

ENV NODE_ENV=production
ENV BICHI_DATA_DIR=/data
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(Bun.env.BICHI_API_PORT||Bun.env.PORT||'3001')).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "server.js"]
