FROM node:22-alpine

RUN apk add --no-cache python3 make g++ libc-dev wget

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js perf-db.js win-scheduled-tasks.ps1 ./

ENV NODE_ENV=production
EXPOSE 3001

# start-period largo: en Windows / discos lentos Node tarda en responder la primera vez
HEALTHCHECK --interval=20s --timeout=8s --start-period=60s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3001/api/metrics >/dev/null || exit 1

CMD ["node", "server.js"]
