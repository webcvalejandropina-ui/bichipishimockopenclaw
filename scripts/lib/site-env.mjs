import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(__dirname, '..');

/** Última línea activa BICHI_SITE_HOST en config/site.env */
export function readBichiSiteHostLine() {
  const p = path.join(REPO_ROOT, 'config', 'site.env');
  if (!fs.existsSync(p)) return '';
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  let val = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^BICHI_SITE_HOST=(.*)$/);
    if (m) val = m[1].trim().replace(/^["']|["']$/g, '');
  }
  return val;
}

/** Primer nombre (URL principal que mostramos al usuario) */
export function primarySiteHost() {
  const v = readBichiSiteHostLine();
  const first = v.split(/\s+/).filter(Boolean)[0];
  return first || 'bichipishi.127.0.0.1.nip.io';
}
