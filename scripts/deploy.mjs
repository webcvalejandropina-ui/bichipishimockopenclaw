/**
 * Producción local: instala deps, construye Astro → dist/, migra datos y arranca la API
 * con el mismo runtime que ejecutó este script (Node o Bun). Sin Docker.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });
const API = path.join(ROOT, 'metrics-api');
const DATA = path.join(ROOT, 'data');
const OLD = path.join(API, 'data');
const useBun = Boolean(process.versions.bun);

function runShell(cmd, cwd = ROOT) {
  const r = spawnSync(cmd, {
    stdio: 'inherit',
    cwd,
    shell: true,
    env: process.env,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

process.chdir(ROOT);

fs.mkdirSync(DATA, { recursive: true });
if (fs.existsSync(OLD)) {
  for (const f of ['settings.json', 'perf.sqlite', 'perf.sqlite-shm', 'perf.sqlite-wal']) {
    const a = path.join(OLD, f);
    const b = path.join(DATA, f);
    if (fs.existsSync(a) && !fs.existsSync(b)) {
      fs.copyFileSync(a, b);
      console.log(`Migrado metrics-api/data/${f} → data/${f}`);
    }
  }
}

if (useBun) {
  console.log('→ bun install (raíz + workspace metrics-api)');
  runShell('bun install', ROOT);
  console.log('→ bun run build:astro (Astro → dist/)');
  runShell('bun run build:astro', ROOT);
} else {
  const lock = path.join(ROOT, 'package-lock.json');
  if (fs.existsSync(lock)) {
    console.log('→ npm ci (reproducible; raíz + workspaces)');
    runShell('npm ci', ROOT);
  } else {
    console.log('→ npm install (genera package-lock.json; guárdalo en git para CI)');
    runShell('npm install', ROOT);
  }
  console.log('→ npm run build:astro (Astro → dist/)');
  runShell('npm run build:astro', ROOT);
}

const port = String(process.env.BICHI_API_PORT || process.env.PORT || '3001').trim();
const publicHost = String(process.env.BICHI_PUBLIC_HOST || 'bichipishi.home').trim() || 'bichipishi.home';
const rt = useBun ? 'Bun' : 'Node';
console.log(`\n→ Arrancando servidor (${rt}) en http://127.0.0.1:${port}/  (Ctrl+C para salir)`);
console.log(
  `→ Sin puerto en el navegador: http://${publicHost}/  (otra terminal: sudo caddy run --config ./config/caddy-bichipishi-prod.caddyfile)\n`,
);

const serverJs = path.join(API, 'server.js');
const r = spawnSync(process.execPath, [serverJs], {
  stdio: 'inherit',
  cwd: ROOT,
  env: { ...process.env },
});
process.exit(r.status ?? 0);
