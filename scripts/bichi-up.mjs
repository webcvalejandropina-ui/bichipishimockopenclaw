#!/usr/bin/env node
/**
 * Arranque único (Windows, macOS, Linux): API en el host :3001 + Docker web + hosts opcional.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { primarySiteHost, REPO_ROOT } from './lib/site-env.mjs';
import {
  npmCiOmitDev,
  dockerCompose,
  dockerInspectOk,
  dockerRmForce,
} from './lib/run-cmd.mjs';

const PID_FILE = path.join(REPO_ROOT, '.bichi-api.pid');
const LOG_FILE = path.join(REPO_ROOT, '.bichi-api.log');
const METRICS_URL = 'http://127.0.0.1:3001/api/metrics';

function readWebPort() {
  const envPath = path.join(REPO_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\n/)) {
      const m = line.match(/^\s*BICHI_WEB_PORT\s*=\s*(\d+)/);
      if (m) return m[1];
    }
  }
  const e = String(process.env.BICHI_WEB_PORT || '').trim();
  return e || '80';
}

function sh(cmd, cwd = REPO_ROOT) {
  execSync(cmd, { stdio: 'inherit', cwd, shell: true, env: process.env });
}

async function apiOk() {
  try {
    const r = await fetch(METRICS_URL, { cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

function maybeDownFullDocker() {
  if (!dockerInspectOk('bichipishi-metrics')) return;
  console.log('Bajando stack anterior (API en contenedor) para usar la API en el equipo…');
  try {
    dockerCompose(['-f', 'docker-compose.full-docker.yml', 'down'], REPO_ROOT);
  } catch {
    dockerRmForce('bichipishi-metrics', REPO_ROOT);
  }
}

function readPid() {
  try {
    const s = fs.readFileSync(PID_FILE, 'utf8').trim();
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function startApiDetached() {
  const apiDir = path.join(REPO_ROOT, 'metrics-api');
  const logFd = fs.openSync(LOG_FILE, 'a');
  const opts = {
    cwd: apiDir,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, NODE_ENV: 'production' },
  };
  if (process.platform === 'win32') Object.assign(opts, { windowsHide: true });
  const child = spawn(process.execPath, ['server.js'], opts);
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
}

async function ensureApi() {
  if (await apiOk()) {
    console.log('API ya responde en :3001 (métricas del equipo).');
    return;
  }

  const old = readPid();
  if (old != null) {
    try {
      process.kill(old, 0);
      if (await apiOk()) return;
      console.log(`La API no respondía; reiniciando (PID ${old})…`);
      try {
        process.kill(old, 'SIGTERM');
      } catch {
        /* ignore */
      }
      await delay(600);
      try {
        process.kill(old, 0);
        process.kill(old, 'SIGKILL');
      } catch {
        /* ya terminó */
      }
    } catch {
      try {
        fs.unlinkSync(PID_FILE);
      } catch {
        /* ignore */
      }
    }
  }

  if (await apiOk()) return;

  const nm = path.join(REPO_ROOT, 'metrics-api', 'node_modules');
  if (!fs.existsSync(nm)) {
    console.log('Instalando dependencias de metrics-api…');
    npmCiOmitDev(path.join(REPO_ROOT, 'metrics-api'));
  }

  console.log('Iniciando metrics-api en el equipo (puerto 3001)…');
  startApiDetached();

  for (let i = 0; i < 45; i++) {
    if (await apiOk()) {
      console.log('API lista.');
      return;
    }
    await delay(300);
  }
  console.error(`Error: la API no arrancó en 3001. Revisa ${LOG_FILE}`);
  process.exit(1);
}

function ensureHosts() {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'ensure-hosts.mjs')], {
    stdio: 'inherit',
    cwd: REPO_ROOT,
    env: process.env,
  });
  if (r.status !== 0 && r.status != null) {
    console.warn('ensure-hosts: revisa el mensaje anterior (puedes usar la URL nip.io).');
  }
}

async function main() {
  process.chdir(REPO_ROOT);
  maybeDownFullDocker();
  await ensureApi();
  ensureHosts();
  console.log('Levantando contenedor web (Docker)…');
  dockerCompose(['up', '--build', '-d'], REPO_ROOT);

  const host = primarySiteHost();
  const port = readWebPort();
  const p = port === '80' ? '' : `:${port}`;
  const base = `http://${host}${p}`;

  console.log('');
  console.log('── Listo ──');
  console.log(`  Abre: ${base}/`);
  console.log(`  Misma app: http://127.0.0.1${p}/  ·  http://localtest.me${p}/`);
  console.log('  (API en tu PC :3001 + web en Docker. Comando corto: pnpm bichi)');
  console.log('  Parar: pnpm bichi:down');
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
