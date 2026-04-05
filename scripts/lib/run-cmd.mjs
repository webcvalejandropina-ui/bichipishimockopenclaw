/**
 * Ejecuta npm y docker sin shell: true en Windows (evita ENOENT con cmd.exe / ComSpec roto).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';

function resolveNpmCli() {
  const nodeDir = path.dirname(process.execPath);
  const tries = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const t of tries) {
    if (fs.existsSync(t)) return t;
  }
  return null;
}

/** npm ci --omit=dev sin cmd.exe (Windows). */
export function npmCiOmitDev(cwd) {
  const cli = resolveNpmCli();
  if (cli) {
    const r = spawnSync(
      process.execPath,
      [cli, 'ci', '--omit=dev'],
      { stdio: 'inherit', cwd, env: process.env, shell: false, windowsHide: true },
    );
    if (r.error) throw r.error;
    if (r.status !== 0) {
      const err = new Error(`npm ci falló (código ${r.status})`);
      err.status = r.status;
      throw err;
    }
    return;
  }
  if (process.platform === 'win32') {
    throw new Error(
      'No se encuentra npm-cli.js junto a Node. Reinstala Node.js LTS desde nodejs.org (incluye npm).',
    );
  }
  execSync('npm ci --omit=dev', { stdio: 'inherit', cwd, shell: true, env: process.env });
}

function resolveDockerExe() {
  if (process.platform !== 'win32') return 'docker';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const cand = [
    path.join(pf, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
    path.join(pfx86, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
  ];
  for (const c of cand) {
    if (fs.existsSync(c)) return c;
  }
  return 'docker';
}

export function dockerCompose(args, cwd = process.cwd()) {
  const exe = resolveDockerExe();
  const r = spawnSync(exe, ['compose', ...args], {
    stdio: 'inherit',
    cwd,
    env: process.env,
    shell: false,
    windowsHide: true,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const err = new Error(`docker compose falló (código ${r.status})`);
    err.status = r.status;
    throw err;
  }
}

export function dockerInspectOk(name) {
  const exe = resolveDockerExe();
  const r = spawnSync(exe, ['inspect', name], {
    stdio: 'ignore',
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    windowsHide: true,
  });
  return r.status === 0;
}

export function dockerRmForce(name, cwd = process.cwd()) {
  const exe = resolveDockerExe();
  spawnSync(exe, ['rm', '-f', name], {
    stdio: 'inherit',
    cwd,
    env: process.env,
    shell: false,
    windowsHide: true,
  });
}
