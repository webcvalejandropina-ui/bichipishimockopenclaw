/**
 * Atajos para Docker Compose (Bun + Astro en todos los flujos).
 *
 * Uso:
 *   bun scripts/docker-local.mjs up [perfil ...]     # por defecto: production
 *   bun scripts/docker-local.mjs down                # baja todo el proyecto Compose
 *   bun scripts/docker-local.mjs logs [perfil ...]
 *   bun scripts/docker-local.mjs build [perfil ...]
 *
 * Perfiles típicos: production | local | full-host | tunnel
 * Ejemplo túnel (equivale a bun run docker:up:tunnel / docker:up:local:tunnel):
 *   bun scripts/docker-local.mjs up production tunnel
 *   bun scripts/docker-local.mjs up local tunnel
 */
import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const cmd = (argv[0] || 'up').toLowerCase();
const profileArgs = argv.slice(1);

if (cmd === 'up' && !existsSync(join(root, '.env'))) {
  copyFileSync(join(root, '.env.example'), join(root, '.env'));
  console.log('[docker-local] Creado .env desde .env.example (edítalo si lo necesitas).');
}

const defaultProfiles =
  cmd === 'up' || cmd === 'logs' || cmd === 'build' ? ['production'] : [];
const profiles = profileArgs.length > 0 ? profileArgs : defaultProfiles;

let args;
if (cmd === 'down') {
  args = ['compose', 'down', '--remove-orphans'];
} else if (cmd === 'up' || cmd === 'logs' || cmd === 'build') {
  args = ['compose'];
  for (const p of profiles) {
    args.push('--profile', p);
  }
  if (cmd === 'up') {
    args.push('up', '-d', '--build');
  } else if (cmd === 'logs') {
    args.push('logs', '-f');
  } else {
    args.push('build');
  }
} else {
  console.error(
    'Uso: bun scripts/docker-local.mjs [up|down|logs|build] [perfil ...]\n' +
      '  up production          → imagen prod (dist + API en :3001)\n' +
      '  up local               → Astro dev :4322 + API :3001 (montaje de fuentes)\n' +
      '  up full-host           → prod con acceso al host Linux\n' +
      '  up production tunnel   → prod + cloudflared; host :8080→:3001 por defecto (o: bun run docker:up:tunnel)\n' +
      '  up local tunnel        → dev + cloudflared; API en host :8080 por defecto (o: bun run docker:up:local:tunnel)\n' +
      'Perfil legacy equivalente a production: web-only',
  );
  process.exit(1);
}

/** Con perfil tunnel, puerto publicado en el host por defecto 8080 (Cloudflare sigue hablando con bichipishi:3001 o :4322 dentro de Docker). */
function envForCompose() {
  const env = { ...process.env };
  if (cmd !== 'up' || !profiles.includes('tunnel')) {
    return env;
  }
  const prodLike = profiles.some((p) =>
    ['production', 'web-only', 'full-host'].includes(p),
  );
  if (prodLike && (env.BICHI_PUBLISH === undefined || env.BICHI_PUBLISH === '')) {
    env.BICHI_PUBLISH = '8080';
    console.log(
      '[docker-local] Túnel: BICHI_PUBLISH=8080 (http://127.0.0.1:8080 en el host → API en contenedor). ' +
        'Define BICHI_PUBLISH en .env para otro puerto.',
    );
  }
  if (
    profiles.includes('local') &&
    (env.BICHI_DEV_API === undefined || env.BICHI_DEV_API === '')
  ) {
    env.BICHI_DEV_API = '8080';
    console.log(
      '[docker-local] Túnel: BICHI_DEV_API=8080 (API en el host). ' +
        'Define BICHI_DEV_API en .env para otro puerto.',
    );
  }
  return env;
}

const r = spawnSync('docker', args, { cwd: root, stdio: 'inherit', env: envForCompose() });
process.exit(r.status ?? 1);
