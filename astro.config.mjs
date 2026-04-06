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
const publicHost = String(process.env.BICHI_PUBLIC_HOST || 'bichipishi.home').trim() || 'bichipishi.home';
/** Origen público del sitio (sin barra final). Canonical URLs y `import.meta.env.SITE`. */
const siteOrigin = String(process.env.PUBLIC_BICHI_SITE_URL || `http://${publicHost}`).replace(/\/$/, '');
/** Puerto que ve el navegador para HMR (80 con Caddy; 4322 si entras solo por Astro). */
const hmrClientPort = Number.parseInt(String(process.env.BICHI_HMR_CLIENT_PORT || '80'), 10) || 80;

export default defineConfig({
  site: siteOrigin,
  server: {
    host: true,
    port: 4322,
  },

  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: [publicHost, 'localhost', '127.0.0.1'],
      hmr: {
        protocol: 'ws',
        host: publicHost,
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
