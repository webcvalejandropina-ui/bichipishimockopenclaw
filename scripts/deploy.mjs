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

/**
 * El árbol `node_modules/.bun/` rompe otros instaladores (p. ej. pnpm) si se mezcla sin limpiar.
 */
function removeNodeModulesIfBunLayout() {
  const nm = path.join(ROOT, 'node_modules');
  const bunMarker = path.join(nm, '.bun');
  if (!fs.existsSync(bunMarker)) return;
  console.log(
    '→ Eliminando node_modules generado por Bun (hay que reinstalar con pnpm sin mezclar layouts)…',
  );
  fs.rmSync(nm, { recursive: true, force: true });
  const apiNm = path.join(API, 'node_modules');
  if (fs.existsSync(apiNm)) fs.rmSync(apiNm, { recursive: true, force: true });
}

if (useBun) {
  console.log('→ bun install (raíz + workspace metrics-api)');
  runShell('bun install', ROOT);
  console.log('→ bun run build:astro (Astro → dist/)');
  runShell('bun run build:astro', ROOT);
} else {
  removeNodeModulesIfBunLayout();
  const pnpmLock = path.join(ROOT, 'pnpm-lock.yaml');
  if (fs.existsSync(pnpmLock)) {
    console.log('→ pnpm install --frozen-lockfile (raíz + workspaces; ver docs/PAQUETES.md)');
    runShell('pnpm install --frozen-lockfile', ROOT);
  } else {
    console.log('→ pnpm install (genera pnpm-lock.yaml; conviene commitearlo)');
    runShell('pnpm install', ROOT);
  }
  console.log('→ pnpm run build:astro:node (Astro → dist/)');
  runShell('pnpm run build:astro:node', ROOT);
}

const port = String(process.env.BICHI_API_PORT || process.env.PORT || '3001').trim();
const publicHost = String(process.env.BICHI_PUBLIC_HOST || '').trim();
const rt = useBun ? 'Bun' : 'Node';
console.log(`\n→ Servidor (${rt})  http://127.0.0.1:${port}/  (dist/ + API en el mismo puerto)`);
if (publicHost) console.log(`   Opcional: http://${publicHost}/  (BICHI_PUBLIC_HOST + hosts)`);
console.log('   Ctrl+C para salir\n');

const r = spawnSync(process.execPath, ['server.js'], {
  stdio: 'inherit',
  cwd: API,
  env: { ...process.env },
});
process.exit(r.status ?? 0);
