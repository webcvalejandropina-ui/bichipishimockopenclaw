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

export default defineConfig({
  server: {
    host: true,
    port: 4322,
  },

  vite: {
    plugins: [tailwindcss()],
    server: {
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
