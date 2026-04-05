#!/usr/bin/env node
/**
 * Actualiza hosts (Windows / macOS / Linux) con 127.0.0.1 + nombres de BICHI_SITE_HOST
 * que no resuelven solos (p. ej. bichipishi.home). Ignora nip.io, localtest.me, etc.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBichiSiteHostLine, REPO_ROOT } from './lib/site-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
void __dirname;

const MARK_BEGIN = '# >>> bichipishi-hosts';
const MARK_END = '# <<< bichipishi-hosts';

function shouldSkip(h) {
  if (h.includes('nip.io')) return true;
  if (h === 'localhost' || h === '127.0.0.1') return true;
  if (h === 'localtest.me' || h.endsWith('.localtest.me')) return true;
  return false;
}

function neededHosts(v) {
  const out = [];
  for (const tok of v.split(/\s+/).filter(Boolean)) {
    const ok =
      /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(tok) || /^[a-zA-Z0-9]$/.test(tok);
    if (!ok) continue;
    if (shouldSkip(tok)) continue;
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

function hostsFile() {
  if (process.platform === 'win32') {
    return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
  }
  return '/etc/hosts';
}

function stripBlock(content) {
  const lines = String(content).split(/\r?\n/);
  const out = [];
  let skip = false;
  for (const line of lines) {
    if (line === MARK_BEGIN) {
      skip = true;
      continue;
    }
    if (line === MARK_END) {
      skip = false;
      continue;
    }
    if (!skip) out.push(line);
  }
  return out.join('\n').replace(/\s+$/, '');
}

function buildContent(original, needed) {
  let base = stripBlock(original);
  if (base.length && !base.endsWith('\n')) base += '\n';
  if (needed.length === 0) {
    return base.length ? (base.endsWith('\n') ? base : `${base}\n`) : '';
  }
  const block = `${MARK_BEGIN}\n# bichipishi — config/site.env (node scripts/ensure-hosts.mjs)\n127.0.0.1 ${needed.join(' ')}\n${MARK_END}\n`;
  return `${base}${block}`;
}

function main() {
  if (process.env.BICHI_SKIP_HOSTS === '1' || process.env.CI === 'true') {
    console.log('bichi-ensure-hosts: omitido (BICHI_SKIP_HOSTS=1 o CI=true).');
    return;
  }

  const v = readBichiSiteHostLine();
  const needed = neededHosts(v);
  const dest = hostsFile();
  let original = '';
  try {
    original = fs.readFileSync(dest, 'utf8');
  } catch {
    original = '';
  }
  const next = buildContent(original, needed);

  if (next === original) {
    console.log('bichi-ensure-hosts: hosts ya está al día.');
    return;
  }

  if (needed.length) {
    console.log(`bichi-ensure-hosts: escribiendo en hosts: 127.0.0.1 ${needed.join(' ')}`);
  } else {
    console.log('bichi-ensure-hosts: quitando bloque bichipishi (solo DNS público en site.env).');
  }

  const tmp = path.join(os.tmpdir(), `bichi-hosts-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(tmp, next, 'utf8');

  if (process.platform === 'win32') {
    try {
      fs.copyFileSync(tmp, dest);
      fs.unlinkSync(tmp);
      console.log('bichi-ensure-hosts: listo (Windows).');
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      if (e && (e.code === 'EPERM' || e.code === 'EACCES')) {
        console.warn('bichi-ensure-hosts: hace falta administrador para editar hosts en Windows.');
        console.warn(`  PowerShell/CMD como admin: cd "${REPO_ROOT}" && node scripts/ensure-hosts.mjs`);
        console.warn('  Sin eso, abre la URL nip.io (primer nombre en config/site.env).');
        return;
      }
      throw e;
    }
    return;
  }

  const r = spawnSync('sudo', ['cp', tmp, dest], { stdio: 'inherit' });
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  if (r.status !== 0) {
    console.warn('bichi-ensure-hosts: sudo cancelado o fallido; usa la URL nip.io o edita /etc/hosts.');
    return;
  }
  console.log('bichi-ensure-hosts: listo.');
}

main();
