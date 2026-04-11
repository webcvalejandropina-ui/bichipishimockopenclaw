import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

const root = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(root, '.env') });

const apiPort =
  process.env.BICHI_API_PORT ||
  process.env.PUBLIC_BICHI_API_PORT ||
  '3001';
const apiProxyTarget = `http://127.0.0.1:${String(apiPort).trim()}`;
const extraAllowedHost = String(process.env.BICHI_PUBLIC_HOST || '').trim();
/** Origen del sitio (sin barra final). Override: PUBLIC_BICHI_SITE_URL. */
const siteOrigin = String(process.env.PUBLIC_BICHI_SITE_URL || 'http://127.0.0.1:4322').replace(/\/$/, '');
/** HMR en local: mismo host/puerto que `server.port` salvo que definas BICHI_HMR_* en .env. */
const hmrHost = String(process.env.BICHI_HMR_HOST || '127.0.0.1').trim() || '127.0.0.1';
const hmrClientPort = Number.parseInt(String(process.env.BICHI_HMR_CLIENT_PORT || '4322'), 10) || 4322;
const allowedHosts = ['localhost', '127.0.0.1'];
if (extraAllowedHost) allowedHosts.push(extraAllowedHost);

/** Docker Compose perfil `local`: volúmenes bind en Mac/Windows suelen necesitar polling para que Vite/Astro detecten cambios. */
const dockerDev =
  process.env.BICHI_DOCKER_DEV === '1' || String(process.env.CHOKIDAR_USEPOLLING || '') === 'true';

export default defineConfig({
  site: siteOrigin,
  server: {
    host: true,
    port: 4322,
  },

  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts,
      ...(dockerDev
        ? {
            watch: {
              usePolling: true,
              interval: 800,
            },
          }
        : {}),
      hmr: {
        protocol: 'ws',
        host: hmrHost,
        clientPort: hmrClientPort,
      },
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  },
});
