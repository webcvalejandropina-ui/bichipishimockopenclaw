/**
 * Comprueba si bichipishi.home está en /etc/hosts (no requiere sudo para leer).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenvOptional();

function dotenvOptional() {
  try {
    const p = path.join(ROOT, '.env');
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ignore */
  }
}

const want = String(process.env.BICHI_PUBLIC_HOST || 'bichipishi.home').trim() || 'bichipishi.home';
let hostsText = '';
try {
  hostsText = fs.readFileSync('/etc/hosts', 'utf8');
} catch {
  console.error('No se pudo leer /etc/hosts (¿Windows? Añade manualmente: 127.0.0.1 ' + want);
  process.exit(1);
}

const lines = hostsText.split(/\r?\n/);
const ok = lines.some((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return false;
  if (!t.includes(want)) return false;
  return /\b127\.0\.0\.1\b/.test(t) || /\b::1\b/.test(t);
});

if (ok) {
  console.log('OK: /etc/hosts incluye', want);
  console.log('Si el navegador sigue sin resolverlo, desactiva "DNS seguro" / Secure DNS (Brave, Chrome).');
  process.exit(0);
}

console.error('\n Falta resolver', want, 'localmente.\n');
console.error('Ejecuta en la terminal (te pedirá contraseña de administrador):\n');
console.error(
  `  sudo sh -c 'grep -q "${want}" /etc/hosts || echo "127.0.0.1 ${want}" >> /etc/hosts'\n`,
);
console.error('Luego prueba:  ping -c 1', want);
console.error('\n Brave / Chrome: Ajustes → Privacidad → usar DNS seguro → Desactivado (si no, a veces ignoran /etc/hosts).\n');
process.exit(1);
