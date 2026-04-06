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
 * npm/arborist falla con el árbol `node_modules/.bun/` que crea Bun (`Cannot read properties of null (reading 'matches')`).
 * Antes de npm ci/install hay que borrar esas carpetas.
 */
function removeNodeModulesIfBunLayout() {
  const nm = path.join(ROOT, 'node_modules');
  const bunMarker = path.join(nm, '.bun');
  if (!fs.existsSync(bunMarker)) return;
  console.log(
    '→ Eliminando node_modules generado por Bun (incompatible con npm); se reinstalará con npm…',
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
console.log(
  `\n→ Abre en el navegador: http://${publicHost}/  (sin IP ni puerto; requiere hosts + Caddy :80)`,
);
console.log(
  `→ Servidor (${rt}) escuchando http://127.0.0.1:${port}/  (Ctrl+C)  ·  Caddy: config/caddy-bichipishi-prod.caddyfile\n`,
);

const serverJs = path.join(API, 'server.js');
const r = spawnSync(process.execPath, [serverJs], {
  stdio: 'inherit',
  cwd: ROOT,
  env: { ...process.env },
});
process.exit(r.status ?? 0);
