/**
 * Desarrollo: API + Astro en paralelo, usando el mismo runtime (Node o Bun) que invocó este script.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });
const useBun = Boolean(process.versions.bun);
const execPath = process.execPath;
const serverJs = path.join(ROOT, 'metrics-api', 'server.js');

const concurrentlyMain = path.join(ROOT, 'node_modules', 'concurrently', 'dist', 'bin', 'concurrently.js');
if (!fs.existsSync(concurrentlyMain)) {
  console.error('Falta el paquete concurrently. En la raíz del repo ejecuta: bun install  o  npm install');
  process.exit(1);
}

/* Rutas relativas a ROOT: evitan que rutas con espacios rompan el shell bajo concurrently. */
const apiCmd = useBun ? 'bun ./metrics-api/server.js' : `node ./metrics-api/server.js`;
const astroCmd = useBun ? 'bunx astro dev --host' : 'npx astro dev --host';

if (!fs.existsSync(serverJs)) {
  console.error('No existe metrics-api/server.js');
  process.exit(1);
}

const publicHost = String(process.env.BICHI_PUBLIC_HOST || 'bichipishi.home').trim() || 'bichipishi.home';
const apiPort = String(process.env.BICHI_API_PORT || process.env.PUBLIC_BICHI_API_PORT || '3001').trim();
console.log(
  `\n\x1b[1mBichipishi (dev)\x1b[0m  ->  \x1b[32mhttp://${publicHost}/\x1b[0m  (sin puerto; requiere Caddy en :80)\n` +
    `  En otra terminal (desde la raíz del repo): \x1b[33msudo caddy run --config ./config/caddy-bichipishi-dev.caddyfile\x1b[0m\n` +
    `  o: \x1b[33mbun run proxy:dev\x1b[0m (suele necesitar sudo por el puerto 80)\n` +
    `  Interno: Astro 127.0.0.1:4322 | API 127.0.0.1:${apiPort} (/api lo proxea Vite)\n` +
    `  Si ${publicHost} no resuelve: ver \x1b[33mconfig/bichipishi.hosts\x1b[0m\n` +
    `  Solo sin Caddy: http://127.0.0.1:4322/ y en .env \x1b[33mBICHI_HMR_CLIENT_PORT=4322\x1b[0m\n`,
);

const child = spawn(
  execPath,
  [
    concurrentlyMain,
    '-k',
    '-n',
    'api,astro',
    '-c',
    'cyan,magenta',
    apiCmd,
    astroCmd,
  ],
  {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env },
  },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
