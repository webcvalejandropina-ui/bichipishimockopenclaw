FROM node:22-alpine

RUN apk add --no-cache python3 make g++ libc-dev

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js perf-db.js win-scheduled-tasks.ps1 ./

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/api/metrics >/dev/null || exit 1

CMD ["node", "server.js"]
