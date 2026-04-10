const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: false,
});
const os = require('os');
const { promisify } = require('util');
const { spawn, spawnSync, execSync, execFile, execFileSync } = require('child_process');
const execFileAsync = promisify(execFile);
const si = require('systeminformation');
const cronParser = require('cron-parser');
const { recordPerfDailySample, queryPerfDailyJson } = require('./perf-db');

const PORT = Number.parseInt(process.env.BICHI_API_PORT || process.env.PORT || '3001', 10) || 3001;
/** Nombre de la app (UI, correos, textos). Opcional: BICHI_APP_NAME o PUBLIC_BICHI_APP_NAME en .env */
const APP_DISPLAY_NAME =
  String(process.env.BICHI_APP_NAME || process.env.PUBLIC_BICHI_APP_NAME || '').trim() || 'Bichipishi';
/** Si defines BICHI_PUBLIC_HOST, se muestra como URL adicional en el log de arranque. */
const PUBLIC_HOST_HINT = String(process.env.BICHI_PUBLIC_HOST || '').trim();
/** Procesos devueltos en `topCpu` (ordenados por % CPU); el total real va en `processCountTotal`. */
const TOP_CPU_PROCESSES = 48;
/** Origen permitido CORS (ej. https://tudominio.pages.dev). Por defecto * (solo recomendado en LAN/dev). */
const CORS_ORIGIN = String(process.env.BICHI_CORS_ORIGIN || '*').trim() || '*';
/** Si es 1, no se aceptan POST de ajustes ni prueba de correo (API expuesta a Internet sin token). */
const SETTINGS_WRITE_DISABLED = process.env.BICHI_DISABLE_SETTINGS_WRITE === '1';
/** Si está definido, POST /api/settings y test-mail exigen Authorization: Bearer <token> o cabecera X-Bichi-Token. */
const SETTINGS_WRITE_TOKEN = String(process.env.BICHI_SETTINGS_TOKEN || '').trim();
/** Si es 1, no se aceptan POST /api/host/* (señales a procesos ni acciones sobre servicios). */
const HOST_ACTIONS_DISABLED = process.env.BICHI_DISABLE_HOST_ACTIONS === '1';
/**
 * Si se define, exige este token para POST /api/host/* (además, si no hay uno propio, se usa BICHI_SETTINGS_TOKEN).
 * Sin token en env: mismas reglas que Docker (POST abiertos en LAN; no recomendado expuesto a Internet).
 */
const HOST_ACTION_TOKEN = String(process.env.BICHI_HOST_ACTION_TOKEN || '').trim();
/** Si es 1, no se consulta servicio externo para IPv4 pública (menos latencia / sin salida a Internet). */
const SKIP_PUBLIC_IP = process.env.BICHI_SKIP_PUBLIC_IP === '1';
const PUBLIC_IP_CACHE_MS = 5 * 60 * 1000;
let publicIpv4Cache = { ip: '', at: 0 };

/**
 * IPv4 pública del host (sale por la ruta por defecto hacia Internet).
 * Caché en memoria ~5 min; requiere HTTPS saliente. No usar secretos.
 */
async function fetchPublicIpv4() {
  if (SKIP_PUBLIC_IP) return '';
  const now = Date.now();
  if (publicIpv4Cache.ip && now - publicIpv4Cache.at < PUBLIC_IP_CACHE_MS) return publicIpv4Cache.ip;

  const looksV4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(s || '').trim());

  const tryJson = async (url) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 3200);
    try {
      const r = await fetch(url, {
        signal: c.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'bichipishi-metrics-api/1' },
      });
      if (!r.ok) return '';
      const j = await r.json();
      const ip = String(j?.ip || '').trim();
      return looksV4(ip) ? ip : '';
    } catch {
      return '';
    } finally {
      clearTimeout(t);
    }
  };

  const tryText = async (url) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 3200);
    try {
      const r = await fetch(url, {
        signal: c.signal,
        headers: { 'User-Agent': 'bichipishi-metrics-api/1' },
      });
      if (!r.ok) return '';
      const ip = (await r.text()).trim();
      return looksV4(ip) ? ip : '';
    } catch {
      return '';
    } finally {
      clearTimeout(t);
    }
  };

  let ip =
    (await tryJson('https://api.ipify.org?format=json')) ||
    (await tryJson('https://api64.ipify.org?format=json')) ||
    (await tryText('https://ipv4.icanhazip.com')) ||
    (await tryText('https://ifconfig.me/ip'));

  if (ip) publicIpv4Cache = { ip, at: now };
  return ip || publicIpv4Cache.ip || '';
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Bichi-Token',
    ...extra,
  };
}
const REPO_ROOT = path.join(__dirname, '..');
const DIST_DIR = process.env.DIST_DIR || path.join(REPO_ROOT, 'dist');
/** SQLite (perf) + settings.json: raíz del repo por defecto (`data/`), consistente con `bun run deploy`. */
const DATA_DIR = process.env.BICHI_DATA_DIR || path.join(REPO_ROOT, 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
/** Editar /etc/crontab (requiere que el proceso tenga permiso de escritura). */
const BICHI_CRON_ALLOW_SYSTEM = process.env.BICHI_CRON_ALLOW_SYSTEM === '1';

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error('[bichi] no se pudo crear DATA_DIR:', DATA_DIR, e && e.message ? e.message : e);
}

/** La API en Docker ve el contenedor Linux, no el PC anfitrión. */
function isRunningInDocker() {
  try {
    if (fs.existsSync('/.dockerenv')) return true;
    const cg = fs.readFileSync('/proc/self/cgroup', 'utf8');
    return /(docker|containerd|kubepods)/i.test(cg);
  } catch {
    return false;
  }
}

function envTrim(key) {
  return String(process.env[key] || '').trim();
}

/**
 * Ruta mostrable del ejecutable (o directorio/código) para la columna «Ruta» en /procesos.
 * systeminformation suele dar `path` como carpeta y `command` solo como nombre corto.
 */
function resolveProcessExecutableDisplayPath(p) {
  const nameRaw = String(p.name || '').replace(/^\((.+)\)$/, '$1').trim();
  const baseName = nameRaw.split(/[/\\]/).pop() || nameRaw;
  const pathField = String(p.path || '').trim();
  const command = String(p.command || '').trim();
  const params = String(p.params || '').trim();

  if (command.startsWith('/')) {
    const t = command.split(/\s+/)[0];
    if (t.startsWith('/')) return t;
  }
  const qm = command.match(/^["']([^"']+)["']/);
  if (qm && qm[1].startsWith('/')) return qm[1];

  if (pathField.startsWith('/')) {
    if (baseName) {
      const candidates = [
        path.join(pathField, baseName),
        path.join(pathField, 'MacOS', baseName),
      ];
      for (const c of candidates) {
        try {
          if (fs.existsSync(c) && !fs.statSync(c).isDirectory()) return c;
        } catch {
          /* ignore */
        }
      }
    }
    return pathField;
  }

  if (params) {
    const paramPaths = params.match(/(\/[^\s"')]+)/g);
    if (paramPaths && paramPaths.length) {
      const scriptish = paramPaths.find((x) => /\.(js|mjs|cjs|ts|tsx|py|wasm|json)$/i.test(x));
      const pick = scriptish || paramPaths[0];
      return String(pick || '').replace(/\)\s*$/, '');
    }
  }

  if (process.platform === 'linux' && p.pid != null) {
    const pid = Number(p.pid);
    if (Number.isFinite(pid)) {
      try {
        let ex = fs.readlinkSync(`/proc/${pid}/exe`);
        ex = String(ex || '').trim();
        if (ex.startsWith('/')) return ex.replace(/\s*\(deleted\)\s*$/i, '').trim();
      } catch {
        /* ignore */
      }
    }
  }

  return baseName || '';
}

/** PRETTY_NAME (o NAME+VERSION) desde os-release del anfitrión montado en el contenedor. */
function readHostOsReleasePretty(filePath) {
  if (!filePath) return '';
  try {
    if (!fs.existsSync(filePath)) return '';
    const raw = fs.readFileSync(filePath, 'utf8');
    const m = {};
    for (const line of raw.split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      m[k] = v;
    }
    if (m.PRETTY_NAME) return String(m.PRETTY_NAME).trim();
    const name = String(m.NAME || '').trim();
    const ver = String(m.VERSION || m.VERSION_ID || '').trim();
    if (name && ver) return `${name} ${ver}`;
    return name || ver || '';
  } catch {
    return '';
  }
}

/** Primera línea de /etc/hostname del anfitrión montado en el contenedor. */
function readHostHostnameFile(filePath) {
  if (!filePath) return '';
  try {
    if (!fs.existsSync(filePath)) return '';
    const line = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)[0];
    return String(line || '').trim();
  } catch {
    return '';
  }
}

function normalizeBrandAvatarUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.length > 2000) return '';
  if (s.startsWith('/') && !s.startsWith('//')) {
    if (s.includes('..') || /[\0\r\n]/.test(s)) return '';
    return s;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return s;
  } catch {
    return '';
  }
}

function normalizeBrandAppName(raw) {
  return String(raw ?? '')
    .trim()
    .slice(0, 80);
}

const DEFAULT_SETTINGS = {
  brand: {
    appName: '',
    avatarUrl: '',
  },
  thresholds: {
    diskWarn: 80,
    diskCrit: 95,
    memWarn: 78,
    memCrit: 92,
    cpuWarn: 60,
    cpuCrit: 85,
  },
  alerts: {
    emailEnabled: false,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    mailFrom: '',
    mailTo: '',
    subjectPrefix: `[${APP_DISPLAY_NAME}]`,
    notifyMinSeverity: 'warning',
    emailCooldownMinutes: 30,
  },
  /** Ficheros extra en la página Logs: { id, label, path, lineRegex? } */
  logStreams: [],
};

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch {
  /* dependencia opcional en tiempo de ejecución */
}

let lastThresholdEmailAt = 0;

function loadUserSettingsRaw() {
  try {
    const t = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const j = JSON.parse(t);
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

const MAX_LOG_STREAMS = 32;
const LOG_STREAM_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/i;

function normalizeLogFilePath(p) {
  const s = String(p ?? '').trim();
  if (!s || s.length > 4096) return '';
  if (/[\0\r\n]/.test(s)) return '';
  if (s.includes('..')) return '';
  if (!path.isAbsolute(s)) return '';
  return s;
}

function validateLogStreamsInput(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id ?? '').trim();
    if (!LOG_STREAM_ID_RE.test(id) || seen.has(id)) continue;
    const label = String(raw.label ?? '').trim().slice(0, 120);
    if (!label) continue;
    const fp = normalizeLogFilePath(raw.path);
    if (!fp) continue;
    const lineRegex = String(raw.lineRegex ?? '').trim().slice(0, 2000);
    if (lineRegex) {
      try {
        new RegExp(lineRegex);
      } catch {
        continue;
      }
    }
    seen.add(id);
    out.push({ id, label, path: fp, lineRegex });
    if (out.length >= MAX_LOG_STREAMS) break;
  }
  return out;
}

function mergeWithDefaults(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rb = r.brand && typeof r.brand === 'object' ? r.brand : {};
  return {
    brand: {
      appName: normalizeBrandAppName(rb.appName),
      avatarUrl: normalizeBrandAvatarUrl(rb.avatarUrl),
    },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(r.thresholds || {}) },
    alerts: { ...DEFAULT_SETTINGS.alerts, ...(r.alerts || {}) },
    logStreams: validateLogStreamsInput(r.logStreams),
  };
}

function coerceThresholds(t) {
  const out = { ...t };
  for (const k of ['diskWarn', 'diskCrit', 'memWarn', 'memCrit', 'cpuWarn', 'cpuCrit']) {
    const n = Number(out[k]);
    out[k] = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : DEFAULT_SETTINGS.thresholds[k];
  }
  return out;
}

function applyPartialSettings(currentRaw, body) {
  const merged = mergeWithDefaults(currentRaw);
  if (body.brand && typeof body.brand === 'object') {
    merged.brand = {
      appName: normalizeBrandAppName(body.brand.appName),
      avatarUrl: normalizeBrandAvatarUrl(body.brand.avatarUrl),
    };
  }
  if (body.thresholds && typeof body.thresholds === 'object') {
    merged.thresholds = coerceThresholds({ ...merged.thresholds, ...body.thresholds });
  }
  if (body.alerts && typeof body.alerts === 'object') {
    const { smtpPass, ...rest } = body.alerts;
    Object.assign(merged.alerts, rest);
    if (typeof smtpPass === 'string' && smtpPass.length > 0) {
      merged.alerts.smtpPass = smtpPass;
    }
  }
  merged.alerts.smtpPort = Number(merged.alerts.smtpPort) || DEFAULT_SETTINGS.alerts.smtpPort;
  merged.alerts.emailCooldownMinutes = Math.max(
    5,
    Math.min(
      24 * 60,
      Number(merged.alerts.emailCooldownMinutes) || DEFAULT_SETTINGS.alerts.emailCooldownMinutes,
    ),
  );
  const sev = String(merged.alerts.notifyMinSeverity || '').toLowerCase();
  merged.alerts.notifyMinSeverity = ['all', 'warning', 'critical'].includes(sev)
    ? sev
    : DEFAULT_SETTINGS.alerts.notifyMinSeverity;
  merged.alerts.emailEnabled = !!merged.alerts.emailEnabled;
  merged.alerts.smtpSecure = !!merged.alerts.smtpSecure;
  if (Array.isArray(body.logStreams)) {
    merged.logStreams = validateLogStreamsInput(body.logStreams);
  }
  return merged;
}

function sanitizeSettingsForResponse(merged) {
  const a = { ...merged.alerts };
  a.smtpPass = merged.alerts.smtpPass ? '********' : '';
  return {
    brand: merged.brand || { ...DEFAULT_SETTINGS.brand },
    thresholds: merged.thresholds,
    alerts: a,
    logStreams: Array.isArray(merged.logStreams) ? merged.logStreams : [],
  };
}

function saveUserSettings(merged) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
}

/** Marcas en `.env` para el bloque sincronizado desde Configuración (no editar entre marcas). */
const ENV_BLOCK_START = '# <<<BICHI_UI_CONFIG_START>>>';
const ENV_BLOCK_END = '# <<<BICHI_UI_CONFIG_END>>>';

function envFileLine(key, val) {
  if (typeof val === 'boolean') return `${key}=${val ? '1' : '0'}`;
  if (typeof val === 'number' && Number.isFinite(val)) return `${key}=${val}`;
  return `${key}=${JSON.stringify(val == null ? '' : String(val))}`;
}

function buildBichiUiEnvLines(merged) {
  const b = merged.brand || {};
  const th = merged.thresholds || DEFAULT_SETTINGS.thresholds;
  const a = merged.alerts || DEFAULT_SETTINGS.alerts;
  const ls = Array.isArray(merged.logStreams) ? merged.logStreams : [];
  return [
    envFileLine('PUBLIC_BICHI_APP_NAME', b.appName || ''),
    envFileLine('PUBLIC_BICHI_AVATAR_URL', b.avatarUrl || ''),
    envFileLine('BICHI_THRESHOLD_DISK_WARN', th.diskWarn),
    envFileLine('BICHI_THRESHOLD_DISK_CRIT', th.diskCrit),
    envFileLine('BICHI_THRESHOLD_MEM_WARN', th.memWarn),
    envFileLine('BICHI_THRESHOLD_MEM_CRIT', th.memCrit),
    envFileLine('BICHI_THRESHOLD_CPU_WARN', th.cpuWarn),
    envFileLine('BICHI_THRESHOLD_CPU_CRIT', th.cpuCrit),
    envFileLine('BICHI_ALERT_EMAIL_ENABLED', !!a.emailEnabled),
    envFileLine('BICHI_SMTP_HOST', a.smtpHost || ''),
    envFileLine('BICHI_SMTP_PORT', Number(a.smtpPort) || DEFAULT_SETTINGS.alerts.smtpPort),
    envFileLine('BICHI_SMTP_SECURE', !!a.smtpSecure),
    envFileLine('BICHI_SMTP_USER', a.smtpUser || ''),
    envFileLine('BICHI_SMTP_PASS', a.smtpPass || ''),
    envFileLine('BICHI_MAIL_FROM', a.mailFrom || ''),
    envFileLine('BICHI_MAIL_TO', a.mailTo || ''),
    envFileLine('BICHI_MAIL_SUBJECT_PREFIX', a.subjectPrefix || ''),
    envFileLine('BICHI_ALERT_NOTIFY_MIN_SEVERITY', a.notifyMinSeverity || 'warning'),
    envFileLine(
      'BICHI_ALERT_EMAIL_COOLDOWN_MIN',
      Number(a.emailCooldownMinutes) || DEFAULT_SETTINGS.alerts.emailCooldownMinutes,
    ),
    envFileLine('BICHI_LOG_STREAMS_JSON', JSON.stringify(ls)),
  ];
}

/**
 * Escribe/actualiza el bloque de variables en `.env` en la raíz del repo (mismos datos que `settings.json`).
 * Así el front (PUBLIC_*) y otras herramientas pueden leer valores tras reiniciar.
 */
function writeBichiUiEnvBlock(merged) {
  const envPath = path.join(REPO_ROOT, '.env');
  const blockBody = [
    ENV_BLOCK_START,
    '# Generado al guardar en Configuración (API). No edites entre las marcas.',
    ...buildBichiUiEnvLines(merged),
    ENV_BLOCK_END,
  ].join('\n');
  let existing = '';
  try {
    existing = fs.readFileSync(envPath, 'utf8');
  } catch {
    existing = '';
  }
  const s = existing.indexOf(ENV_BLOCK_START);
  const e = existing.indexOf(ENV_BLOCK_END);
  let out;
  if (s !== -1 && e !== -1 && e > s) {
    const head = existing.slice(0, s).replace(/\s*$/, '');
    const tail = existing.slice(e + ENV_BLOCK_END.length).replace(/^\s*/, '');
    out = (head ? head + '\n\n' : '') + blockBody + '\n' + (tail ? tail : '');
  } else {
    const trimmed = existing.trimEnd();
    out = (trimmed ? trimmed + '\n\n' : '') + blockBody + '\n';
  }
  fs.writeFileSync(envPath, out, 'utf8');
}

/**
 * Tras guardar ajustes: opcional `BICHI_RESTART_CMD` (shell), o relanzar este proceso si
 * `BICHI_RESTART_ON_SETTINGS_SAVE` no es `0` y no vamos bajo concurrently (`BICHI_IN_CONCURRENTLY`).
 */
function attachRestartAfterSettingsSave(res) {
  const cmd = String(process.env.BICHI_RESTART_CMD || '').trim();
  const inConcurrently = process.env.BICHI_IN_CONCURRENTLY === '1';
  const restartDisabled = process.env.BICHI_RESTART_ON_SETTINGS_SAVE === '0';
  res.once('finish', () => {
    if (cmd) {
      try {
        const c = spawn(cmd, { shell: true, detached: true, stdio: 'ignore' });
        c.unref();
      } catch (e) {
        console.error('[bichi] BICHI_RESTART_CMD:', e && e.message ? e.message : e);
      }
      return;
    }
    if (restartDisabled || inConcurrently) return;
    try {
      const child = spawn(process.execPath, process.argv.slice(1), {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd(),
        env: process.env,
      });
      child.unref();
      setTimeout(() => process.exit(0), 200);
    } catch (e) {
      console.error('[bichi] reinicio tras guardar:', e && e.message ? e.message : e);
    }
  });
}

function restartMetaForSettingsResponse() {
  const cmd = String(process.env.BICHI_RESTART_CMD || '').trim();
  const inConcurrently = process.env.BICHI_IN_CONCURRENTLY === '1';
  const restartDisabled = process.env.BICHI_RESTART_ON_SETTINGS_SAVE === '0';
  const scheduled = !restartDisabled && (!!cmd || !inConcurrently);
  let restartNote = null;
  if (!restartDisabled && inConcurrently && !cmd) {
    restartNote =
      'En modo dev (API+astro) reinicia manualmente el terminal con `bun run dev` para que Astro cargue las variables PUBLIC_* del .env.';
  }
  return { restartScheduled: scheduled, restartNote };
}

function readBody(req, maxBytes) {
  const max = maxBytes || 512_000;
  return new Promise((resolve, reject) => {
    let buf = '';
    let len = 0;
    req.on('data', (ch) => {
      len += ch.length;
      if (len > max) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      buf += ch.toString('utf8');
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function assertHostActionAuth(req, res) {
  if (HOST_ACTIONS_DISABLED) {
    json(res, 403, {
      ok: false,
      error: 'Acciones sobre procesos, servicios y tareas programadas desactivadas (BICHI_DISABLE_HOST_ACTIONS=1).',
    });
    return false;
  }
  const need = HOST_ACTION_TOKEN || SETTINGS_WRITE_TOKEN;
  if (!need) return true;
  const auth = String(req.headers.authorization || '');
  const x = String(req.headers['x-bichi-token'] || '');
  if (auth === `Bearer ${need}` || x === need) return true;
  json(res, 401, {
    ok: false,
    error:
      'Token requerido: BICHI_HOST_ACTION_TOKEN o BICHI_SETTINGS_TOKEN; cabecera Authorization: Bearer … o X-Bichi-Token (procesos, servicios, tareas programadas).',
  });
  return false;
}

function isSafeServiceName(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 240) return false;
  if (/[\r\n\0]/.test(t)) return false;
  if (/[;&|$`()]/.test(t)) return false;
  return /^[\w.\-@+\\ ]+$/i.test(t);
}

function runProcessSignal(pidRaw, signal) {
  const sig = signal === 'kill' ? 'kill' : 'term';
  const pid = Number(pidRaw);
  if (!Number.isInteger(pid) || pid < 2) return { ok: false, error: 'PID inválido' };
  if (pid === process.pid) {
    return { ok: false, error: 'No se puede señalar al propio proceso de la API de métricas' };
  }
  if (pid === 1 && process.platform !== 'win32') {
    return { ok: false, error: 'No se permite señalar al proceso con PID 1 (init del sistema).' };
  }
  if (process.platform === 'win32') {
    const args = ['/PID', String(pid)];
    if (sig === 'kill') args.push('/F');
    try {
      const r = spawnSync('taskkill', args, {
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
        timeout: 30000,
      });
      if (r.error) return { ok: false, error: r.error.message || String(r.error) };
      if (r.status !== 0) {
        const msg = (r.stderr || r.stdout || '').trim() || `taskkill terminó con código ${r.status}`;
        return { ok: false, error: msg };
      }
      return { ok: true, signal: sig };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }
  try {
    const nodeSig = sig === 'kill' ? 'SIGKILL' : 'SIGTERM';
    process.kill(pid, nodeSig);
    return { ok: true, signal: sig };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function runServiceHostAction(name, action) {
  if (!['stop', 'start', 'restart'].includes(action)) return { ok: false, error: 'Acción inválida' };
  if (!isSafeServiceName(name)) return { ok: false, error: 'Nombre de servicio no permitido' };

  if (process.platform === 'linux') {
    try {
      await execFileAsync('systemctl', [action, name], {
        timeout: 120000,
        windowsHide: true,
      });
      return { ok: true };
    } catch (e) {
      const msg =
        (e && e.stderr && String(e.stderr).trim()) ||
        (e && e.stdout && String(e.stdout).trim()) ||
        (e && e.message ? e.message : String(e));
      return { ok: false, error: msg };
    }
  }

  if (process.platform === 'win32') {
    const esc = String(name).replace(/'/g, "''");
    const ps =
      action === 'stop'
        ? `Stop-Service -Name '${esc}' -Force -ErrorAction Stop`
        : action === 'start'
          ? `Start-Service -Name '${esc}' -ErrorAction Stop`
          : `Restart-Service -Name '${esc}' -Force -ErrorAction Stop`;
    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        timeout: 120000,
        windowsHide: true,
      });
      return { ok: true };
    } catch (e) {
      const msg =
        (e && e.stderr && String(e.stderr).trim()) ||
        (e && e.stdout && String(e.stdout).trim()) ||
        (e && e.message ? e.message : String(e));
      return { ok: false, error: msg };
    }
  }

  return {
    ok: false,
    error:
      'Este sistema no expone systemctl ni servicios de Windows gestionables desde aquí (p. ej. macOS: filas informativas por proceso). Usa launchctl, la UI del sistema o ejecuta la API en Linux/WSL.',
  };
}

function serviceLocalCliMeta(platform) {
  if (platform === 'darwin') {
    return {
      shortHint:
        'macOS: la API no gestiona launchd. Cada tarjeta es una coincidencia heurística por nombre de proceso, no un servicio de Homebrew ni el label de un daemon.',
      cliStopTemplate: 'brew services stop {{name}}',
      cliStartTemplate: 'brew services start {{name}}',
      cliRestartTemplate: 'brew services restart {{name}}',
      cliNote:
        'Los comandos «brew services …» son solo ayuda: comprueba el nombre con brew services list. Si el programa no es de Homebrew, localiza el job con launchctl y la documentación de launchd; el título de la tarjeta suele ser el nombre del proceso, no el identificador del daemon.',
      openTerminal: 'open -a Terminal',
      openTerminalHelp:
        'Se copia en el portápapeles. Pégalo en Spotlight (⌘+Espacio), en “Ejecutar” de otra ventana o en un acceso directo.',
    };
  }
  if (platform === 'freebsd' || platform === 'openbsd' || platform === 'netbsd') {
    return {
      shortHint: 'BSD: comandos rc.d orientativos; el nombre exacto depende del script en rc.d.',
      cliStopTemplate: 'sudo service {{name}} onestop',
      cliStartTemplate: 'sudo service {{name}} onestart',
      cliRestartTemplate: 'sudo service {{name}} onerestart',
      cliNote: 'Comandos típicos de rc.d; el nombre puede variar según el script en /usr/local/etc/rc.d.',
      openTerminal: 'xterm',
      openTerminalHelp: 'Se copia el lanzador por defecto; abre un terminal desde el escritorio o usa SSH y pega el comando del servicio.',
    };
  }
  return {
    shortHint: 'Comando genérico tipo SysV/BSD; comprueba el init de tu sistema.',
    cliStopTemplate: 'sudo service {{name}} stop',
    cliStartTemplate: 'sudo service {{name}} start',
    cliRestartTemplate: 'sudo service {{name}} restart',
    cliNote: 'Comando genérico tipo SysV/BSD; comprueba el init de tu sistema.',
    openTerminal: 'x-terminal-emulator',
    openTerminalHelp: 'Se copia un lanzador genérico (Debian: update-alternatives x-terminal-emulator).',
  };
}

function hostActionsPayload(platform, metricsRepresentHost) {
  if (!metricsRepresentHost) return null;
  const processCtl = { term: true, kill: true };
  let serviceMode = 'none';
  let serviceHint = '';
  /** Plantillas CLI y “abrir terminal” cuando no hay API systemctl/Windows. */
  let cliStopTemplate = '';
  let cliStartTemplate = '';
  let cliRestartTemplate = '';
  let cliNote = '';
  let openTerminal = '';
  let openTerminalHelp = '';
  if (platform === 'linux') {
    serviceMode = 'systemd';
    serviceHint = 'Linux: systemctl start|stop|restart con el nombre exacto que devuelve la API.';
    cliStopTemplate = 'sudo systemctl stop {{name}}';
    cliStartTemplate = 'sudo systemctl start {{name}}';
    cliRestartTemplate = 'sudo systemctl restart {{name}}';
    cliNote = 'Referencia para copiar en terminal (misma acción que los botones si tienes permisos polkit/sudo).';
    openTerminal = 'gnome-terminal || x-terminal-emulator || konsole';
    openTerminalHelp =
      'Una sola línea con alternativas; copia y ejecuta en un shell o abre un terminal desde el menú del escritorio.';
  } else if (platform === 'win32') {
    serviceMode = 'windows';
    serviceHint = 'Windows: PowerShell Start/Stop/Restart-Service.';
    cliStopTemplate = 'Stop-Service -Name "{{name}}" -Force';
    cliStartTemplate = 'Start-Service -Name "{{name}}"';
    cliRestartTemplate = 'Restart-Service -Name "{{name}}" -Force';
    cliNote = 'Ejecuta en PowerShell elevado si el servicio lo requiere. Sustituye el nombre exacto (puede incluir espacios).';
    openTerminal = 'wt';
    openTerminalHelp = 'Copia `wt` para abrir Windows Terminal, o usa Win+X → Terminal (Windows 11).';
  } else {
    const loc = serviceLocalCliMeta(platform);
    serviceHint = loc.shortHint || loc.cliNote;
    cliStopTemplate = loc.cliStopTemplate;
    cliStartTemplate = loc.cliStartTemplate;
    cliRestartTemplate = loc.cliRestartTemplate;
    cliNote = loc.cliNote;
    openTerminal = loc.openTerminal;
    openTerminalHelp = loc.openTerminalHelp;
  }
  return {
    process: processCtl,
    service: {
      mode: serviceMode,
      hint: serviceHint,
      cliStopTemplate,
      cliStartTemplate,
      cliRestartTemplate,
      cliNote,
      openTerminal,
      openTerminalHelp,
    },
    authRequired: !!(HOST_ACTION_TOKEN || SETTINGS_WRITE_TOKEN),
  };
}

function severityMeetsEmailMin(sev, min) {
  const order = { warning: 1, critical: 2 };
  const s = order[sev] || 1;
  if (min === 'all') return true;
  if (min === 'critical') return s >= 2;
  return s >= 1;
}

function createMailTransport(alertCfg) {
  if (!nodemailer || !alertCfg.smtpHost) return null;
  return nodemailer.createTransport({
    host: alertCfg.smtpHost,
    port: Number(alertCfg.smtpPort) || 587,
    secure: !!alertCfg.smtpSecure,
    auth: alertCfg.smtpUser
      ? { user: String(alertCfg.smtpUser), pass: String(alertCfg.smtpPass || '') }
      : undefined,
  });
}

async function maybeSendThresholdEmails(alerts, settings) {
  const a = settings.alerts;
  if (!a.emailEnabled || !nodemailer) return;
  if (!a.smtpHost || !String(a.mailTo || '').trim()) return;

  const filtered = alerts.filter((al) => severityMeetsEmailMin(al.severity, a.notifyMinSeverity));
  if (!filtered.length) return;

  const cooldownMs = (Number(a.emailCooldownMinutes) || 30) * 60 * 1000;
  const now = Date.now();
  if (now - lastThresholdEmailAt < cooldownMs) return;

  const transporter = createMailTransport(a);
  if (!transporter) return;

  const subj = `${a.subjectPrefix || `[${APP_DISPLAY_NAME}]`} Alertas de umbrales`;
  const lines = filtered.map(
    (al) => `- [${al.severity}] ${al.title}: ${al.detail} (${al.host || ''})`,
  );
  const text = lines.join('\n');

  await transporter.sendMail({
    from: a.mailFrom || a.smtpUser || a.mailTo,
    to: a.mailTo,
    subject: subj,
    text,
  });
  lastThresholdEmailAt = Date.now();
}

async function sendTestMail(settings) {
  const a = settings.alerts;
  const transporter = createMailTransport(a);
  if (!transporter) throw new Error('SMTP no configurado (host vacío o nodemailer no disponible)');
  if (!String(a.mailTo || '').trim()) throw new Error('Indica al menos un destinatario (mailTo)');
  await transporter.sendMail({
    from: a.mailFrom || a.smtpUser || a.mailTo,
    to: a.mailTo,
    subject: `${a.subjectPrefix || `[${APP_DISPLAY_NAME}]`} Prueba de correo`,
    text: `Este es un mensaje de prueba desde ${APP_DISPLAY_NAME}. Si lo recibes, el SMTP está bien configurado.`,
  });
}

/**
 * macOS: systeminformation no enumera con '*'; se usa coincidencia por nombre en `ps`.
 * Linux/BSD: '*' → unidades reales (systemctl / service / init.d).
 * Windows: '*' → Win32_Service reales (PowerShell).
 */
const DARWIN_BSD_SERVICE_PATTERNS = [
  'sshd',
  'nginx',
  'httpd',
  'apache2',
  'apache',
  'caddy',
  'lighttpd',
  'traefik',
  'haproxy',
  'docker',
  'com.docker',
  'containerd',
  'buildkitd',
  'colima',
  'limactl',
  'podman',
  'kubelet',
  'k3s',
  'etcd',
  'redis-server',
  'redis',
  'mysqld',
  'mysql',
  'mariadbd',
  'postgres',
  'postmaster',
  'mongod',
  'rabbitmq',
  'memcached',
  'consul',
  'vault',
  'prometheus',
  'grafana',
  'elasticsearch',
  'kafka',
  'zookeeper',
  'minio',
  'mosquitto',
  'coturn',
  'turnserver',
  'dnsmasq',
  'unbound',
  'named',
  'bind',
  'cupsd',
  'cups',
  'smbd',
  'nmbd',
  'winbind',
  'nfsd',
  'rpcbind',
  'mDNSResponder',
  'bluetoothd',
  'syslog',
  'rsyslogd',
  'cron',
  'atd',
  'postfix',
  'sendmail',
  'exim',
  'fail2ban',
  'tailscaled',
  'wireguard',
  'openvpn',
  'strongswan',
  'ipsec',
  'pm2',
  'postgresql',
].filter((v, i, a) => a.indexOf(v) === i);

function servicesMaxCount() {
  const n = Number.parseInt(process.env.BICHI_SERVICES_MAX || '240', 10);
  if (!Number.isFinite(n) || n < 20) return 240;
  return Math.min(600, n);
}

/** Cadena para `systeminformation.services()`: env `BICHI_SERVICES`, o '*' (real salvo macOS), o lista POSIX. */
function monitoredServicesSpecifier() {
  const env = process.env.BICHI_SERVICES;
  if (env != null && String(env).trim() !== '') {
    return String(env).trim();
  }
  if (process.platform === 'darwin') {
    return DARWIN_BSD_SERVICE_PATTERNS.join(',');
  }
  return '*';
}

function serviceRowDescription(s, platform) {
  const sm = s.startmode != null && String(s.startmode).trim() !== '' ? String(s.startmode).trim() : '';
  if (platform === 'win32' && sm) {
    return `Modo de inicio: ${sm}`;
  }
  const n = (s.name || '').toString();
  if (/\.(service|socket|timer|mount)$/i.test(n)) {
    return 'Unidad systemd';
  }
  if (platform === 'darwin') {
    return 'Coincidencia por nombre en procesos (no es el label launchd ni el nombre en brew services)';
  }
  if (platform === 'freebsd' || platform === 'openbsd' || platform === 'netbsd') {
    return 'Daemon / proceso del sistema (detección por ps)';
  }
  if (platform === 'win32') {
    return 'Servicio de Windows';
  }
  return 'Servicio del sistema';
}

function normalizeServicesList(svcList, platform) {
  const max = servicesMaxCount();
  const rows = (svcList || [])
    .filter((s) => s && s.name != null && String(s.name).trim() !== '')
    .map((s) => ({
      name: (s.name || 'service').toString(),
      desc: serviceRowDescription(s, platform),
      active: s.startmode ? String(s.startmode).toLowerCase() !== 'disabled' : true,
      running: !!s.running,
      startmode: s.startmode ? String(s.startmode) : '',
    }));

  const seen = new Set();
  const deduped = [];
  for (const r of rows) {
    const k = r.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }

  deduped.sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  if (deduped.length > max) {
    return deduped.slice(0, max);
  }
  return deduped;
}

function timed(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]).catch(() => fallback);
}

/** Resumen GPU desde `si.graphics()` (uso solo si el driver expone utilizationGpu, p. ej. NVIDIA con nvidia-smi). */
function summarizeGpuFromGraphics(graphicsData) {
  const ctrls =
    graphicsData && Array.isArray(graphicsData.controllers) ? graphicsData.controllers.filter(Boolean) : [];
  if (!ctrls.length) {
    return { gpu: null, gpuModel: null, gpuVramMb: null, gpuControllers: [] };
  }
  let bestUtil = null;
  for (const c of ctrls) {
    const u = Number(c.utilizationGpu);
    if (Number.isFinite(u)) {
      const cl = Math.min(100, Math.max(0, u));
      bestUtil = bestUtil == null ? cl : Math.max(bestUtil, cl);
    }
  }
  const primary = ctrls.reduce((acc, cur) => {
    const va = Number(acc.vram) || 0;
    const vb = Number(cur.vram) || 0;
    return vb > va ? cur : acc;
  });
  const vendor = String(primary.vendor || '').trim();
  const model = String(primary.model || '')
    .trim()
    .replace(/^Apple\s+Apple\s+/i, 'Apple ');
  const vLow = vendor.toLowerCase();
  const mLow = model.toLowerCase();
  let gpuModel = null;
  if (vendor && model) {
    if (mLow === vLow || mLow.startsWith(`${vLow} `) || mLow.startsWith(`${vLow}(`)) gpuModel = model;
    else gpuModel = `${vendor} ${model}`.trim();
  } else {
    gpuModel = vendor || model || null;
  }
  const vramN = Number(primary.vram);
  const gpuVramMb = Number.isFinite(vramN) && vramN > 0 ? Math.round(vramN) : null;
  if (gpuModel) {
    gpuModel = String(gpuModel).replace(/\bApple\s+Apple\b/gi, 'Apple').trim();
  }
  const gpuControllers = ctrls.map((c) => ({
    vendor: String(c.vendor || '').trim(),
    model: String(c.model || '').trim(),
    vramMb: Number.isFinite(Number(c.vram)) && Number(c.vram) > 0 ? Math.round(Number(c.vram)) : null,
    utilization:
      Number.isFinite(Number(c.utilizationGpu))
        ? Math.min(100, Math.max(0, Math.round(Number(c.utilizationGpu))))
        : null,
  }));
  return { gpu: bestUtil, gpuModel, gpuVramMb, gpuControllers };
}

/**
 * Si `systeminformation` no lista GPU (frecuente en Windows sin WMI completo), intenta Win32_VideoController.
 * Misma forma que espera `summarizeGpuFromGraphics` (vram en MB).
 */
async function tryWindowsGpuControllersFromWmi() {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'Get-CimInstance Win32_VideoController | Where-Object { $_.Name } | Select-Object Name, AdapterRAM | ConvertTo-Json -Compress',
      ],
      { timeout: 9000, windowsHide: true, maxBuffer: 512 * 1024 },
    );
    const raw = JSON.parse(String(stdout || '').trim());
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const junk = /microsoft basic|parsec|virtual display|remote desktop|teamviewer|sunlogin|rdp|mirror|dummy/i;
    const mapped = rows
      .map((r) => {
        const name = String(r.Name || '').trim();
        const bytes = Number(r.AdapterRAM) || 0;
        const vramMb = bytes > 0 ? Math.round(bytes / (1024 * 1024)) : null;
        return { vendor: '', model: name, vram: vramMb, utilizationGpu: undefined };
      })
      .filter((c) => c.model);
    const good = mapped.filter((c) => !junk.test(c.model));
    return good.length ? good : mapped;
  } catch (e) {
    console.warn('[bichi] Win32_VideoController (GPU):', e && e.message ? e.message : e);
    return [];
  }
}

function resolveOpenClawBin() {
  const explicit = String(process.env.OPENCLAW_BIN || process.env.OPENCLAW_BINARY || '').trim();
  const candidates = [
    explicit,
    'openclaw',
    path.join(os.homedir(), '.npm-global', 'bin', 'openclaw'),
    path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'openclaw', 'openclaw.mjs'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const r = spawnSync(candidate, ['--version'], {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
        shell: false,
      });
      if (r.status === 0) return candidate;
    } catch {
      /* ignore */
    }
  }

  return explicit || 'openclaw';
}

function checkOpenClawAvailable() {
  if (process.env.OPENCLAW_FORCE === '1') return true;
  if (process.env.OPENCLAW_FORCE === '0') return false;
  const logPath = envTrim('OPENCLAW_LOG_PATH');
  if (logPath) {
    try {
      if (fs.existsSync(logPath)) return true;
    } catch {
      /* ignore */
    }
  }
  const bin = resolveOpenClawBin();
  try {
    const r = spawnSync(bin, ['--version'], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
      shell: false,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function pickMainFs(fsSize) {
  if (!fsSize || !fsSize.length) return null;
  const skipRe = /^(tmpfs|devtmpfs|overlay|squashfs|ramfs|proc|sys|devfs|loop)/i;
  const usable = fsSize.filter((f) => f && f.size > 0 && !skipRe.test(f.type || '') && String(f.mount || '').length);
  if (!usable.length) return fsSize[0];
  /** macOS APFS: `/` suele ser el volumen del sistema sellado (pequeño); los datos van en Data. */
  if (process.platform === 'darwin') {
    const dataVol = usable.find((f) => String(f.mount || '') === '/System/Volumes/Data');
    if (dataVol) return dataVol;
    const darwinCandidates = usable.filter((f) => {
      const m = String(f.mount || '');
      return m === '/' || m.startsWith('/System/Volumes/');
    });
    if (darwinCandidates.length) {
      return darwinCandidates.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
    }
  }
  const root = usable.find((f) => f.mount === '/' || /^[A-Za-z]:$/.test(String(f.mount).replace(/\\/g, '')));
  if (root) return root;
  return usable.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
}

/**
 * macOS: `systeminformation.fsSize()` suele mezclar APFS (total del contenedor de datos vs usado del volumen sellado).
 * Usamos `df` y/o `fs.statfsSync` y elegimos el volumen grande (no el de ~15–20 GiB del sistema).
 */
function parseDfPkDataLine(line) {
  const parts = line.trim().split(/\s+/);
  const capIdx = parts.findIndex((p) => /^\d+%$/.test(p));
  if (capIdx < 4) return null;
  const blocks = Number.parseInt(parts[capIdx - 3], 10);
  const used = Number.parseInt(parts[capIdx - 2], 10);
  const avail = Number.parseInt(parts[capIdx - 1], 10);
  if (!Number.isFinite(blocks) || blocks <= 0) return null;
  const mount = parts.slice(capIdx + 1).join(' ').trim();
  const size = blocks * 1024;
  const usedB = Number.isFinite(used) && used >= 0 ? used * 1024 : 0;
  const availB = Number.isFinite(avail) && avail >= 0 ? avail * 1024 : Math.max(0, size - usedB);
  const usePct = size > 0 ? Math.min(100, Math.max(0, (usedB / size) * 100)) : 0;
  return { size, used: usedB, available: availB, mount, use: usePct };
}

function dfExecutableForPlatform() {
  if (process.platform === 'darwin' && fs.existsSync('/bin/df')) return '/bin/df';
  return 'df';
}

function statFsNumber(v) {
  if (typeof v === 'bigint') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Alineado con “espacio disponible” del usuario (bavail). */
function statfsToDiskRow(mountPath) {
  if (typeof fs.statfsSync !== 'function') return null;
  try {
    const s = fs.statfsSync(mountPath);
    const bsize = statFsNumber(s.bsize);
    const blocks = statFsNumber(s.blocks);
    const bavail = statFsNumber(s.bavail);
    if (!(bsize > 0) || !(blocks > 0) || !Number.isFinite(bavail) || bavail < 0) return null;
    const size = blocks * bsize;
    const available = bavail * bsize;
    const used = Math.max(0, Math.min(size, size - available));
    const usePct = size > 0 ? Math.min(100, Math.max(0, (used / size) * 100)) : 0;
    return { size, used, available, mount: mountPath, use: usePct, type: 'statfs' };
  } catch {
    return null;
  }
}

function tryDfPkForPath(mountPath) {
  try {
    const exe = dfExecutableForPlatform();
    const r = spawnSync(exe, ['-Pk', mountPath], {
      encoding: 'utf8',
      timeout: 9000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    if (r.error || r.status !== 0 || !String(r.stdout || '').trim()) return null;
    const lines = String(r.stdout).trim().split('\n');
    if (lines.length < 2) return null;
    const row = parseDfPkDataLine(lines[1]);
    if (!row) return null;
    return { ...row, type: 'df' };
  } catch {
    return null;
  }
}

/**
 * @param {string} [rootPrefix] nativo: ''; en Docker: prefijo montaje del host (p. ej. `/host`).
 */
function darwinLikeDiskFromPaths(rootPrefix) {
  const base = rootPrefix == null ? '' : String(rootPrefix).replace(/\/$/, '');
  const paths = base
    ? [`${base}/System/Volumes/Data`, base]
    : ['/System/Volumes/Data', '/'];
  const extra = envTrim('BICHI_DISK_EXTRA_MOUNT');
  if (extra) {
    for (const raw of extra.split(/[,;]+/)) {
      const p = String(raw || '').trim();
      if (!p) continue;
      paths.push(base ? `${base}${p.startsWith('/') ? p : `/${p}`}` : p);
    }
  }

  const rows = [];
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
    } catch {
      continue;
    }
    const dfRow = tryDfPkForPath(p);
    if (dfRow) rows.push(dfRow);
    const st = statfsToDiskRow(p);
    if (st) rows.push(st);
  }

  const byMount = new Map();
  for (const r of rows) {
    const m = String(r.mount || '').trim() || '(unknown)';
    const cur = byMount.get(m);
    if (!cur || (r.type === 'df' && cur.type !== 'df')) byMount.set(m, r);
  }

  let list = [...byMount.values()].filter((r) => r && r.size > 0);
  if (!list.length) return null;

  /** Excluye el volumen sellado ~10–20 GiB si ya tenemos un candidato mayor (típico APFS). */
  const MIN_MAIN_VOL = 20 * 1024 ** 3;
  const big = list.filter((r) => r.size >= MIN_MAIN_VOL);
  if (big.length) list = big;

  list.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return (b.used || 0) - (a.used || 0);
  });

  return list[0];
}

function mergeMainFsWithFree(fsRow) {
  if (!fsRow) return null;
  const size = Number(fsRow.size) || 0;
  const used = Number(fsRow.used) || 0;
  let available = Number(fsRow.available);
  if (!Number.isFinite(available) || available < 0) {
    available = Math.max(0, size - used);
  }
  const use =
    Number.isFinite(Number(fsRow.use)) && fsRow.use >= 0
      ? Math.min(100, Math.max(0, Number(fsRow.use)))
      : size > 0
        ? Math.min(100, Math.max(0, (used / size) * 100))
        : 0;
  return { ...fsRow, size, used, available, use };
}

function formatBytes(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  let v = Number(n);
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return i === 0 ? `${Math.round(v)} ${u[i]}` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/**
 * Socket/pipe del motor Docker (Linux, Docker Desktop macOS/Windows, rootless).
 * Override: `BICHI_DOCKER_SOCKET` o `DOCKER_HOST=unix:///ruta`.
 */
function resolveDockerEngineSocket() {
  const explicit = process.env.BICHI_DOCKER_SOCKET && String(process.env.BICHI_DOCKER_SOCKET).trim();
  if (explicit) return explicit;
  const dh = process.env.DOCKER_HOST && String(process.env.DOCKER_HOST).trim();
  if (dh && dh.startsWith('unix://')) {
    const p = dh.slice('unix://'.length);
    return p || '/var/run/docker.sock';
  }
  if (process.platform === 'win32') return '//./pipe/docker_engine';
  return '/var/run/docker.sock';
}

const DOCKER_ENGINE_SOCKET = resolveDockerEngineSocket();

/**
 * GET al API del daemon vía http.request + socketPath.
 * Un socket net crudo + esperar `end` falla si Docker responde HTTP/1.1 con keep-alive (timeout → []).
 */
function dockerEngineGet(pathAndQuery, timeoutMs = 12000) {
  const rel = String(pathAndQuery || '').replace(/^\//, '');
  if (!rel) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    /** Evita colgarse indefinidamente si el pipe/socket no emite `end` ni `timeout` (p. ej. Docker Desktop en Windows). */
    let req = null;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardDeadline);
      resolve(val);
    };

    const hardDeadline = setTimeout(() => {
      try {
        if (req) req.destroy();
      } catch {
        /* ignore */
      }
      finish(null);
    }, timeoutMs + 4000);

    try {
      req = http.request(
        {
          socketPath: DOCKER_ENGINE_SOCKET,
          path: `/${rel}`,
          method: 'GET',
          headers: {
            Host: 'localhost',
            Connection: 'close',
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const code = res.statusCode || 0;
              if (code < 200 || code >= 300) {
                finish(null);
                return;
              }
              const body = Buffer.concat(chunks).toString('utf8').trim();
              if (!body) {
                finish(null);
                return;
              }
              finish(JSON.parse(body));
            } catch {
              finish(null);
            }
          });
        },
      );
    } catch {
      return finish(null);
    }

    req.on('error', () => finish(null));
    req.on('timeout', () => {
      try {
        req.destroy();
      } catch {
        /* ignore */
      }
      finish(null);
    });
    req.end();
  });
}

async function loadDockerImagesForMetrics() {
  const data = await dockerEngineGet('images/json', 15000);
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const tags = row.RepoTags;
    let primary = '<sin etiqueta>';
    let allTags = [];
    if (Array.isArray(tags) && tags.length) {
      allTags = tags;
      primary = tags[0];
    }
    const idFull = String(row.Id || '');
    const idShort = idFull.replace(/^sha256:/, '').slice(0, 12) || '—';
    const sz = Number(row.Size) || 0;
    let created = 0;
    if (typeof row.Created === 'number' && Number.isFinite(row.Created)) {
      created = row.Created > 1e12 ? Math.round(row.Created / 1000) : row.Created;
    } else if (typeof row.Created === 'string') {
      const n = Number(row.Created);
      if (Number.isFinite(n)) {
        created = n > 1e12 ? Math.round(n / 1000) : n;
      } else {
        const d = Date.parse(row.Created);
        if (Number.isFinite(d)) created = Math.round(d / 1000);
      }
    }
    return {
      id: idShort,
      repo: primary,
      tags: allTags,
      size: sz,
      sizeLabel: formatBytes(sz),
      created,
    };
  });
}

async function loadDockerVolumesForMetrics() {
  const data = await dockerEngineGet('volumes', 10000);
  const vols = data && Array.isArray(data.Volumes) ? data.Volumes : [];
  return vols.map((v) => ({
    name: v.Name || '—',
    driver: (v.Driver || 'local').toString(),
    mountpoint: (v.Mountpoint || '').toString(),
    scope: (v.Scope || '').toString(),
    created: v.CreatedAt ? Math.round(new Date(v.CreatedAt).getTime() / 1000) : 0,
  }));
}

/** Primeros 12 hex del digest de imagen (como en `docker images`). */
function dockerImageIdShortFromField(imageIdField) {
  const raw = String(imageIdField || '')
    .trim()
    .replace(/^sha256:/i, '');
  if (raw.length >= 12) return raw.slice(0, 12).toLowerCase();
  return '';
}

function containerRowReferencesImage(im, c) {
  const cShort = dockerImageIdShortFromField(c.ImageID || c.imageID);
  const imId = String(im.id || '').toLowerCase();
  if (cShort && imId && cShort === imId) return true;
  const iref = String(c.Image || c.image || '').trim();
  if (!iref) return false;
  const irefBase = iref.split('@')[0];
  if (im.repo && im.repo !== '<sin etiqueta>' && (iref === im.repo || irefBase === im.repo)) return true;
  if (Array.isArray(im.tags)) {
    for (const t of im.tags) {
      if (!t) continue;
      if (iref === t || irefBase === t) return true;
      const tb = t.split('@')[0];
      if (irefBase === tb || iref === tb) return true;
    }
  }
  return false;
}

function enrichDockerImagesWithUsage(images, containersJson) {
  if (!Array.isArray(images)) return [];
  const cis = Array.isArray(containersJson) ? containersJson : [];
  return images.map((im) => {
    const ids = new Set();
    for (const c of cis) {
      if (containerRowReferencesImage(im, c)) ids.add(String(c.Id || c.ID || ''));
    }
    const n = ids.size;
    return { ...im, inUse: n > 0, usedByContainers: n };
  });
}

function enrichDockerVolumesWithUsage(volumes, containersJson) {
  if (!Array.isArray(volumes)) return [];
  const cis = Array.isArray(containersJson) ? containersJson : [];
  const nameToIds = new Map();
  for (const c of cis) {
    const cid = String(c.Id || c.ID || '');
    const mounts = Array.isArray(c.Mounts) ? c.Mounts : [];
    for (const m of mounts) {
      if (String(m.Type || m.type || '').toLowerCase() === 'volume' && m.Name) {
        if (!nameToIds.has(m.Name)) nameToIds.set(m.Name, new Set());
        if (cid) nameToIds.get(m.Name).add(cid);
      }
    }
  }
  return volumes.map((v) => {
    const set = nameToIds.get(v.name) || new Set();
    const n = set.size;
    return { ...v, inUse: n > 0, usedByContainers: n };
  });
}

function formatDockerPorts(ports) {
  if (!ports || !ports.length) return '—';
  return ports
    .map((p) => {
      const priv = p.PrivatePort;
      const pub = p.PublicPort;
      if (pub && priv) return `${pub}->${priv}`;
      if (priv) return String(priv);
      return '';
    })
    .filter(Boolean)
    .slice(0, 4)
    .join(', ') || '—';
}

function normalizeLoad() {
  if (process.platform === 'win32') return null;
  const la = os.loadavg();
  return [la[0], la[1], la[2]];
}

/** Entorno C para `vm_stat` / sysctl (evita etiquetas localizadas). */
const SUBPROC_C_LOCALE = { ...process.env, LANG: 'C', LC_ALL: 'C' };

/**
 * macOS: Monitor de actividad usa “Memoria usada” ≈ app + cableada + comprimida.
 * Las páginas especulativas son recuperables y al sumarlas se dispara el % (p. ej. ~99 % con ~90 % reales).
 * vm_stat en inglés (LANG=C).
 */
function darwinMemoryActivityMonitorStyle() {
  if (process.platform !== 'darwin') return null;
  try {
    const pageSize = Number.parseInt(
      execSync('/usr/sbin/sysctl -n hw.pagesize', { encoding: 'utf8', env: SUBPROC_C_LOCALE }).trim(),
      10,
    );
    const total = Number.parseInt(
      execSync('/usr/sbin/sysctl -n hw.memsize', { encoding: 'utf8', env: SUBPROC_C_LOCALE }).trim(),
      10,
    );
    if (!Number.isFinite(pageSize) || pageSize <= 0 || !Number.isFinite(total) || total <= 0) return null;
    const out = execSync('/usr/bin/vm_stat', { encoding: 'utf8', maxBuffer: 256 * 1024, env: SUBPROC_C_LOCALE });
    const counts = {};
    for (const line of out.split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const raw = line
        .slice(idx + 1)
        .trim()
        .replace(/\.$/, '')
        .replace(/,/g, '');
      const n = Number.parseInt(raw, 10);
      if (!Number.isNaN(n) && key) counts[key] = n;
    }
    const wired = counts['Pages wired down'] || 0;
    const active = counts['Pages active'] || 0;
    const compressed =
      counts['Pages occupied by compressor'] ||
      counts['Pages stored in compressor'] ||
      0;
    const usedPages = wired + active + compressed;
    if (usedPages <= 0) return null;
    let used = usedPages * pageSize;
    if (used > total) used = total;
    return { total, used, free: Math.max(0, total - used) };
  } catch {
    return null;
  }
}

function applyDarwinMemIfNeeded(mem) {
  const dm = darwinMemoryActivityMonitorStyle();
  if (!dm || !mem) return false;
  mem.total = dm.total;
  mem.used = dm.used;
  mem.free = dm.free;
  mem.available = dm.free;
  return true;
}

/** RAM física según sysctl (macOS); útil si vm_stat falla y `si.mem()` devuelve totales raros. */
function darwinHwMemsizeBytes() {
  if (process.platform !== 'darwin') return null;
  try {
    const total = Number.parseInt(
      execSync('/usr/sbin/sysctl -n hw.memsize', { encoding: 'utf8', env: SUBPROC_C_LOCALE }).trim(),
      10,
    );
    return Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    return null;
  }
}

/** Nombre amistoso del equipo (p. ej. Información del sistema en macOS). */
function getDeviceDisplayName(osInfo) {
  if (process.platform === 'darwin') {
    try {
      const n = execSync('/usr/sbin/scutil --get ComputerName', {
        encoding: 'utf8',
        env: SUBPROC_C_LOCALE,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (n) return n;
    } catch {
      /* ignore */
    }
  }
  if (process.platform === 'win32') {
    const n = String(process.env.COMPUTERNAME || '').trim();
    if (n) return n;
  }
  if (process.platform === 'linux') {
    try {
      const out = execFileSync('hostnamectl', ['--json'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
        env: SUBPROC_C_LOCALE,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const j = JSON.parse(out);
      const pretty = String(j?.StaticHostname || j?.Hostname || '').trim();
      if (pretty && pretty !== '(none)') return pretty;
    } catch {
      /* sin systemd / Alpine en Docker: hostnamectl no existe */
    }
  }
  return (osInfo && osInfo.hostname) || os.hostname() || '';
}

/** Hostname de red local (Bonjour), coherente con Información del sistema en macOS. */
function getTechnicalHostname(osInfo) {
  if (process.platform === 'darwin') {
    try {
      const lh = execSync('/usr/sbin/scutil --get LocalHostName', {
        encoding: 'utf8',
        env: SUBPROC_C_LOCALE,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (lh) return `${lh}.local`;
    } catch {
      /* ignore */
    }
  }
  return (osInfo && osInfo.hostname) || os.hostname() || '';
}

function darwinIpconfigIpv4Fallback() {
  if (process.platform !== 'darwin') return [];
  const ifaces = ['en0', 'en1', 'en2', 'en3', 'en4', 'en5', 'en6'];
  const out = [];
  const seen = new Set();
  for (const iface of ifaces) {
    try {
      const addr = execSync(`/usr/sbin/ipconfig getifaddr ${iface}`, {
        encoding: 'utf8',
        env: SUBPROC_C_LOCALE,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (addr && /^\d{1,3}(\.\d{1,3}){3}$/.test(addr) && !addr.startsWith('127.') && !seen.has(addr)) {
        seen.add(addr);
        out.push(addr);
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Toda IPv4 salvo loopback (incluye “internal”, Docker, bridges — a veces es la única forma de ver la IP). */
function collectHostIpv4NonLoopback() {
  const ifs = os.networkInterfaces();
  if (!ifs) return [];
  const seen = new Set();
  const out = [];
  for (const arr of Object.values(ifs)) {
    if (!Array.isArray(arr)) continue;
    for (const a of arr) {
      const fam = a.family;
      if (fam !== 'IPv4' && fam !== 4) continue;
      const addr = String(a.address || '').trim();
      if (!addr || addr.startsWith('127.')) continue;
      if (seen.has(addr)) continue;
      seen.add(addr);
      out.push(addr);
    }
  }
  return out;
}

/** IPv4 priorizando interfaces habituales (misma lógica que antes, sin filtrar internal). */
function collectHostIpv4List() {
  const ifs = os.networkInterfaces();
  if (!ifs) return [];
  const prefer = ['en0', 'en1', 'en2', 'eth0', 'wlan0', 'Wi-Fi', 'Ethernet', 'bridge100'];
  const seen = new Set();
  const out = [];
  function addFrom(name) {
    const arr = ifs[name];
    if (!Array.isArray(arr)) return;
    for (const a of arr) {
      const fam = a.family;
      if (fam !== 'IPv4' && fam !== 4) continue;
      const addr = String(a.address || '').trim();
      if (!addr || addr.startsWith('127.') || seen.has(addr)) continue;
      seen.add(addr);
      out.push(addr);
    }
  }
  for (const n of prefer) addFrom(n);
  for (const n of Object.keys(ifs).sort()) addFrom(n);
  return out.slice(0, 8);
}

function linuxDefaultRouteIpv4() {
  if (process.platform !== 'linux') return [];
  try {
    const o = execSync('ip -4 route get 1.1.1.1 2>/dev/null', { encoding: 'utf8', env: SUBPROC_C_LOCALE }).trim();
    const m = o.match(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (m) return [m[1]];
  } catch {
    /* ignore */
  }
  return [];
}

/** systeminformation: no descartar internal ni link-local (pueden ser la única IP útil). */
function collectHostIpv4FromSi(siNics) {
  if (!Array.isArray(siNics) || !siNics.length) return [];
  const seen = new Set();
  const out = [];
  const ordered = [...siNics].sort((a, b) => {
    const da = a.default ? 1 : 0;
    const db = b.default ? 1 : 0;
    return db - da;
  });
  for (const nic of ordered) {
    const addr = String(nic.ip4 || '').trim();
    if (!addr || addr.startsWith('127.')) continue;
    if (seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

function mergeIpv4Lists(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const ip of list) {
      const s = String(ip || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out.slice(0, 12);
}

function darwinSwVersSync() {
  if (process.platform !== 'darwin') return null;
  try {
    const lines = execSync('/usr/bin/sw_vers', { encoding: 'utf8', env: SUBPROC_C_LOCALE }).split('\n');
    const o = {};
    for (const line of lines) {
      const m = line.match(/^\s*(\w+)\s*:\s*(.+)\s*$/);
      if (m) o[m[1]] = m[2].trim();
    }
    if (o.ProductName || o.ProductVersion) return o;
  } catch {
    /* ignore */
  }
  return null;
}

/** GiB binarios (1024³). Totales en entero (p. ej. 8 GB de fábrica → 8). */
function bytesToGiBTotalInt(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / 1024 ** 3);
}

/** GiB en uso con un decimal (RAM/disco usado). */
function bytesToGiBUsedOneDec(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / 1024 ** 3) * 10) / 10;
}

function formatHostOsLabel(osInfo) {
  if (!osInfo) return process.platform;
  if (process.platform === 'darwin') {
    let name = String(osInfo.distro || '').trim();
    let rel = String(osInfo.release || '').trim();
    let code = String(osInfo.codename || '').trim();
    if (!name || name === 'unknown' || !rel || rel === 'unknown') {
      const sw = darwinSwVersSync();
      if (sw) {
        if (!name || name === 'unknown') name = sw.ProductName || 'macOS';
        if (!rel || rel === 'unknown') rel = sw.ProductVersion || '';
      }
    }
    if (!name || name === 'unknown') name = 'macOS';
    if (/^darwin$/i.test(name)) name = 'macOS';
    else if (/^darwin\b/i.test(name)) {
      const rest = name.replace(/^darwin\b/i, '').trim();
      name = rest || 'macOS';
    }
    const ver = rel.split(/\s+/)[0] || '';
    const codeUse = code && !/^macos$/i.test(code) ? code : '';
    if (ver && codeUse) return `${name} ${ver} (${codeUse})`;
    if (ver) return `${name} ${ver}`;
    return name;
  }
  if (process.platform === 'win32') {
    const a = String(osInfo.distro || '').trim();
    const b = String(osInfo.release || osInfo.kernel || '').trim();
    if (a && b) return `${a} · ${b}`;
    return a || b || 'Windows';
  }
  const distro = String(osInfo.distro || '').trim();
  const rel = String(osInfo.release || '').trim();
  if (distro && rel) return `${distro} · ${rel}`;
  if (distro) return distro;
  return process.platform;
}

function buildThresholdAlerts(hostname, memPct, diskPct, cpuPct, mem, mainFs, thresholds) {
  const th = coerceThresholds({ ...DEFAULT_SETTINGS.thresholds, ...(thresholds || {}) });
  const now = Date.now();
  const warnings = [];
  const alerts = [];

  if (diskPct >= th.diskCrit) {
    const msg = `Espacio en ${mainFs?.mount || 'disco'} crítico (${diskPct.toFixed(0)}% usado)`;
    warnings.push(msg);
    alerts.push({
      severity: 'critical',
      code: 'DISK_THRESHOLD',
      title: 'Disco casi lleno',
      detail: msg,
      source: 'host',
      host: hostname,
      at: now - 2 * 60 * 1000,
    });
  } else if (diskPct >= th.diskWarn) {
    const msg = `Disco ${mainFs?.mount || ''} al ${diskPct.toFixed(0)}% — conviene liberar espacio`;
    warnings.push(msg);
    alerts.push({
      severity: 'warning',
      code: 'DISK_WARN',
      title: 'Uso de disco elevado',
      detail: msg,
      source: 'host',
      host: hostname,
      at: now - 8 * 60 * 1000,
    });
  }

  if (memPct >= th.memCrit) {
    const msg = `RAM al ${memPct.toFixed(0)}% (${bytesToGiBUsedOneDec(mem.used)} / ${bytesToGiBTotalInt(mem.total)} GiB)`;
    warnings.push(msg);
    alerts.push({
      severity: 'critical',
      code: 'MEM_THRESHOLD',
      title: 'Memoria bajo presión',
      detail: msg,
      source: 'host',
      host: hostname,
      at: now - 4 * 60 * 1000,
    });
  } else if (memPct >= th.memWarn) {
    const msg = `Uso de RAM elevado (${memPct.toFixed(0)}%)`;
    warnings.push(msg);
    alerts.push({
      severity: 'warning',
      code: 'MEM_WARN',
      title: 'RAM alta',
      detail: msg,
      source: 'host',
      host: hostname,
      at: now - 12 * 60 * 1000,
    });
  }

  if (cpuPct >= th.cpuCrit) {
    const msg = `CPU al ${cpuPct.toFixed(0)}% — carga muy alta`;
    warnings.push(msg);
    alerts.push({
      severity: 'critical',
      code: 'CPU_THRESHOLD',
      title: 'CPU crítica',
      detail: msg,
      source: 'host',
      host: hostname,
      at: now - 3 * 60 * 1000,
    });
  } else if (cpuPct >= th.cpuWarn) {
    const msg = `Uso de CPU elevado (${cpuPct.toFixed(0)}%)`;
    warnings.push(msg);
    alerts.push({
      severity: 'warning',
      code: 'CPU_WARN',
      title: 'CPU alta',
      detail: msg,
      source: 'host',
      host: hostname,
      at: now - 10 * 60 * 1000,
    });
  }

  return { warnings, alerts };
}

/** Valores seguros si `systeminformation` tarda demasiado o falla (evita que /api/metrics cuelgue). */
function memFallbackFromOs() {
  const total = Math.max(1, os.totalmem() || 1);
  const free = Math.max(0, os.freemem() || 0);
  return { total, used: Math.min(total, total - free) };
}

async function collectMetrics() {
  const openclawAvailable = checkOpenClawAvailable();

  const [
    currentLoad,
    mem,
    fsSize,
    osInfo,
    cpuData,
    procData,
    svcList,
    dockerList,
    dockerImages,
    dockerVolumes,
    siNics,
    publicIp,
    graphicsData,
    dockerContainersJson,
  ] = await Promise.all([
    timed(si.currentLoad(), 15000, { currentLoad: 0 }),
    timed(si.mem(), 15000, memFallbackFromOs()),
    timed(si.fsSize(), 20000, []),
    timed(si.osInfo(), 12000, { hostname: os.hostname() || '' }),
    timed(si.cpu(), 15000, { cores: os.cpus().length || 1, brand: 'CPU', manufacturer: '' }),
    timed(si.processes().catch(() => ({ list: [] })), 25000, { list: [] }),
    timed(si.services(monitoredServicesSpecifier()).catch(() => []), 20000, []),
    timed(si.dockerContainers(true), 8000, []),
    timed(loadDockerImagesForMetrics(), 22000, []),
    timed(loadDockerVolumesForMetrics(), 18000, []),
    timed(si.networkInterfaces().catch(() => []), 15000, []),
    fetchPublicIpv4().catch(() => ''),
    timed(si.graphics().catch(() => ({ controllers: [] })), 12000, { controllers: [] }),
    timed(dockerEngineGet('containers/json?all=true', 12000), 12000, null),
  ]);

  let graphicsForGpu = graphicsData;
  if (!graphicsForGpu?.controllers?.length && process.platform === 'win32') {
    const wmiCtrls = await tryWindowsGpuControllersFromWmi();
    if (wmiCtrls.length) {
      graphicsForGpu = { controllers: wmiCtrls };
    }
  }
  const gpuBase = summarizeGpuFromGraphics(graphicsForGpu);

  const memMacActivityMonitor = applyDarwinMemIfNeeded(mem);
  if (process.platform === 'darwin') {
    const hwT = darwinHwMemsizeBytes();
    if (hwT) mem.total = hwT;
  }
  const gibEnv = Number.parseFloat(String(process.env.BICHI_MEM_TOTAL_GIB || '').trim(), 10);
  if (Number.isFinite(gibEnv) && gibEnv > 0) {
    mem.total = Math.round(gibEnv * 1024 ** 3);
  }
  const usedGibEnv = Number.parseFloat(envTrim('BICHI_MEM_USED_GIB'), 10);
  if (isRunningInDocker() && Number.isFinite(usedGibEnv) && usedGibEnv >= 0 && (mem.total || 0) > 0) {
    mem.used = Math.min(mem.total, Math.round(usedGibEnv * 1024 ** 3));
  }
  if ((mem.total || 0) > 0 && (mem.used || 0) > mem.total) {
    mem.used = mem.total;
  }

  const cpuPct = Math.min(100, Math.max(0, Number(currentLoad.currentLoad) || 0));
  const memTotal = mem.total || 1;
  const memPct = Math.min(100, Math.max(0, ((mem.used || 0) / memTotal) * 100));

  const hostDiskRootEnv = envTrim('BICHI_HOST_DISK_ROOT');
  const hostDiskRoot =
    hostDiskRootEnv || (isRunningInDocker() && fs.existsSync('/host') ? '/host' : '');

  let mainFsRaw = pickMainFs(fsSize);
  if (process.platform === 'darwin') {
    const acc = darwinLikeDiskFromPaths('');
    if (acc) mainFsRaw = acc;
  } else if (hostDiskRoot) {
    const acc = darwinLikeDiskFromPaths(hostDiskRoot);
    if (acc) mainFsRaw = acc;
  }
  const mainFs = mergeMainFsWithFree(mainFsRaw);
  const diskPct = mainFs && mainFs.size > 0
    ? Math.min(100, Math.max(0, mainFs.use || ((mainFs.used / mainFs.size) * 100)))
    : 0;

  let hostname = getTechnicalHostname(osInfo);
  let deviceName = getDeviceDisplayName(osInfo) || hostname;
  const hostIpv4 = mergeIpv4Lists(
    darwinIpconfigIpv4Fallback(),
    linuxDefaultRouteIpv4(),
    collectHostIpv4NonLoopback(),
    collectHostIpv4FromSi(siNics),
    collectHostIpv4List(),
  );
  let cpuBrand = (cpuData.brand || cpuData.manufacturer || 'CPU').trim();
  let cores = cpuData.cores || cpuData.physicalCores || os.cpus().length || 1;

  const load = normalizeLoad();

  const list = Array.isArray(procData.list) ? procData.list : [];
  const processCountTotal = list.filter((p) => p && (p.pid || p.pid === 0)).length;
  const topCpu = list
    .filter((p) => p && (p.pid || p.pid === 0))
    .sort((a, b) => (Number(b.cpu) || 0) - (Number(a.cpu) || 0))
    .slice(0, TOP_CPU_PROCESSES)
    .map((p) => {
      const pathResolved = resolveProcessExecutableDisplayPath(p);
      const cmdLine = [String(p.command || '').trim(), String(p.params || '').trim()].filter(Boolean).join(' ').trim();
      const cmdOut = cmdLine || String(p.command || p.path || p.name || '').trim();
      return {
        comm: (p.name || p.command || '?').toString().split(/[\s\\/]/).pop() || '?',
        desc: '',
        pid: p.pid,
        path: pathResolved,
        cmd: cmdOut,
        cpu: Math.round((Number(p.cpu) || 0) * 10) / 10,
        mem: Math.round((Number(p.mem) || 0) * 10) / 10,
      };
    });

  const services = normalizeServicesList(svcList, process.platform);

  const containers = (dockerList || [])
    .filter(Boolean)
    .map((c) => {
      const st = String(c.state || '').toLowerCase();
      const up = st === 'running';
      return {
        name: c.name || '—',
        status: up ? 'Up' : (c.state || 'Detenido'),
        ports: formatDockerPorts(c.ports),
        cpu: typeof c.cpuPercent === 'number' ? Math.round(c.cpuPercent * 10) / 10 : 0,
        mem: typeof c.memPercent === 'number' ? Math.round(c.memPercent * 10) / 10 : 0,
      };
    });

  const containersJsonForUsage = Array.isArray(dockerContainersJson) ? dockerContainersJson : [];
  const dockerImagesSafe = enrichDockerImagesWithUsage(
    Array.isArray(dockerImages) ? dockerImages : [],
    containersJsonForUsage,
  );
  const dockerVolumesSafe = enrichDockerVolumesWithUsage(
    Array.isArray(dockerVolumes) ? dockerVolumes : [],
    containersJsonForUsage,
  );
  const dockerImagesTotalBytes = dockerImagesSafe.reduce((s, im) => s + (im.size || 0), 0);

  let hostOsLabel = formatHostOsLabel(osInfo);
  let uptimeOut = Math.floor(os.uptime());
  let hostMetricsNote = '';
  /** API en Docker sin BICHI_HOST_* ni montajes /host → no representa el PC del usuario (p. ej. Windows). */
  let misleadingDocker = false;
  if (isRunningInDocker()) {
    const osRelFile =
      envTrim('BICHI_HOST_OS_RELEASE_FILE') ||
      (fs.existsSync('/host/etc/os-release') ? '/host/etc/os-release' : '');
    const hnFile =
      envTrim('BICHI_HOST_HOSTNAME_FILE') ||
      (fs.existsSync('/host/etc/hostname') ? '/host/etc/hostname' : '');
    const osFromHostFile = readHostOsReleasePretty(osRelFile);
    const hnFromHostFile = readHostHostnameFile(hnFile);

    const hHost = envTrim('BICHI_HOST_HOSTNAME');
    const hDev = envTrim('BICHI_HOST_DEVICE_NAME');
    const hOs = envTrim('BICHI_HOST_OS');
    if (hHost) hostname = hHost;
    else if (hnFromHostFile) hostname = hnFromHostFile;
    if (hDev) deviceName = hDev;
    else if (hHost) deviceName = hHost;
    else if (hnFromHostFile) deviceName = hnFromHostFile;
    if (hOs) hostOsLabel = hOs;
    else if (osFromHostFile) hostOsLabel = osFromHostFile;
    const upt = Number.parseInt(envTrim('BICHI_HOST_UPTIME_SEC'), 10);
    if (Number.isFinite(upt) && upt >= 0) uptimeOut = upt;
    const hCpu = envTrim('BICHI_HOST_CPU_MODEL');
    if (hCpu) cpuBrand = hCpu;
    const hCores = Number.parseInt(envTrim('BICHI_HOST_CPU_CORES'), 10);
    if (Number.isFinite(hCores) && hCores > 0) cores = hCores;

    const hasHostId = !!(hHost || hnFromHostFile);
    const hasOsId = !!(hOs || osFromHostFile);
    misleadingDocker = !hasHostId || !hasOsId;
    if (misleadingDocker) {
      hostMetricsNote =
        'La API corre en un contenedor Linux: aquí no mostramos CPU/RAM/disco como si fueran tu PC. Para métricas reales: ejecuta la API en el host (bun run deploy o bun start desde el repo).';
    }
  }

  if (
    !misleadingDocker &&
    isRunningInDocker() &&
    process.platform === 'linux' &&
    /mac\s*os|darwin/i.test(hostOsLabel) &&
    !hostDiskRoot
  ) {
    const diskHint =
      'El disco que ves es el del contenedor. Para el volumen del Mac: monta la raíz del sistema en el contenedor (p. ej. -v /:/host:ro en Docker Desktop) o define BICHI_HOST_DISK_ROOT=/host.';
    hostMetricsNote = hostMetricsNote ? `${hostMetricsNote}\n\n${diskHint}` : diskHint;
  }

  const userSettings = mergeWithDefaults(loadUserSettingsRaw());
  let warnings;
  let alerts;
  if (misleadingDocker) {
    warnings = [];
    alerts = [];
  } else {
    const b = buildThresholdAlerts(
      deviceName || hostname,
      memPct,
      diskPct,
      cpuPct,
      mem,
      mainFs,
      userSettings.thresholds,
    );
    warnings = b.warnings;
    alerts = b.alerts;
  }

  const mailP = maybeSendThresholdEmails(alerts, userSettings);
  if (mailP && typeof mailP.catch === 'function') {
    mailP.catch((e) => console.error('[bichi] alert mail:', e && e.message ? e.message : e));
  }

  if (!misleadingDocker) {
    try {
      recordPerfDailySample(DATA_DIR, cpuPct, memPct, diskPct);
    } catch (e) {
      console.error('[bichi] perf sqlite:', e && e.message ? e.message : e);
    }
  }

  const metricsRepresentHost = !misleadingDocker;
  const outCpu = misleadingDocker ? null : cpuPct;
  const outMem = misleadingDocker ? null : memPct;
  const outDisk = misleadingDocker ? null : diskPct;
  const outTopCpu = misleadingDocker ? [] : topCpu;
  const outServices = misleadingDocker ? [] : services;
  const outLoad = misleadingDocker ? [] : load;
  const outUptime = misleadingDocker ? -1 : uptimeOut;
  const outProcTotal = misleadingDocker ? 0 : processCountTotal;

  return {
    platform: process.platform,
    metricsRepresentHost,
    cpu: outCpu,
    mem: outMem,
    disk: outDisk,
    memUsed: misleadingDocker ? null : bytesToGiBUsedOneDec(mem.used || 0),
    memTotal: misleadingDocker ? null : bytesToGiBTotalInt(mem.total || 0),
    memNote: memMacActivityMonitor
      ? 'macOS: “Memoria usada” aproximada como Monitor de actividad (vm_stat: activas + cableadas + comprimidas; GiB = 1024³).'
      : '',
    diskUsed: misleadingDocker || !mainFs ? null : bytesToGiBUsedOneDec(mainFs.used || 0),
    diskTotal: misleadingDocker || !mainFs ? null : bytesToGiBTotalInt(mainFs.size || 0),
    diskFree: misleadingDocker || !mainFs ? null : bytesToGiBUsedOneDec(mainFs.available || 0),
    diskMount: misleadingDocker || !mainFs ? null : String(mainFs.mount || '').trim() || null,
    diskNote:
      misleadingDocker || !mainFs
        ? ''
        : process.platform === 'darwin'
          ? 'macOS: df/statfs del volumen de datos (APFS). “Almacenamiento” puede redondear en GB decimal o contar snapshots/purgable distinto.'
          : hostDiskRoot && String(mainFs.mount || '').startsWith(hostDiskRoot)
            ? 'Disco del host vía montaje (BICHI_HOST_DISK_ROOT o /host).'
            : '',
    hostOs: hostOsLabel,
    hostname,
    deviceName,
    hostMetricsNote,
    hostIpv4,
    publicIp: String(publicIp || '').trim(),
    processCountTotal: outProcTotal,
    cpuModel: cpuBrand,
    cpuCores: cores,
    gpu: misleadingDocker ? null : gpuBase.gpu,
    gpuModel: misleadingDocker ? null : gpuBase.gpuModel,
    gpuVramMb: misleadingDocker ? null : gpuBase.gpuVramMb,
    gpuControllers: misleadingDocker ? [] : gpuBase.gpuControllers,
    load: outLoad,
    uptime: outUptime,
    timestamp: Date.now(),
    topCpu: outTopCpu,
    hostActions: hostActionsPayload(process.platform, metricsRepresentHost),
    services: outServices,
    containers,
    dockerImages: dockerImagesSafe,
    dockerVolumes: dockerVolumesSafe,
    dockerImagesTotalBytes,
    dockerImagesCount: dockerImagesSafe.length,
    dockerVolumesCount: dockerVolumesSafe.length,
    warnings,
    alerts,
    openclawAvailable,
  };
}

/* ── Logs reales (archivo, journalctl u OpenClaw) ── */

function systemLogsEmptyHint() {
  if (process.platform === 'win32') {
    return 'Define la variable de entorno LOG_FILE con la ruta a un archivo de log del sistema.';
  }
  if (process.platform === 'darwin') {
    return 'En macOS no hay journalctl por defecto. Define LOG_FILE (p. ej. /var/log/system.log o un log propio) o monta un archivo en Docker.';
  }
  return 'Sin LOG_FILE: en Linux usa journald o monta un archivo de log (véase README).';
}

function readTailLines(filePath, maxLines) {
  try {
    const st = fs.statSync(filePath);
    if (st.size > 1_500_000) {
      const fd = fs.openSync(filePath, 'r');
      const chunkSize = Math.min(400_000, st.size);
      const buf = Buffer.alloc(chunkSize);
      fs.readSync(fd, buf, 0, chunkSize, st.size - chunkSize);
      fs.closeSync(fd);
      return buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-maxLines);
    }
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}

function inferSystemLevel(line) {
  const l = line.toLowerCase();
  if (/\berror\b|\bcrit\b|\bcritical\b|\bfatal\b|\bemerg\b/.test(l)) return 'error';
  if (/\bwarn\b|\bwarning\b/.test(l)) return 'warn';
  if (/\bdebug\b/.test(l)) return 'debug';
  return 'info';
}

function extractTimePrefix(line) {
  const iso = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  if (iso) return iso[1].replace('T', ' ');
  const classic = line.match(/^([A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/);
  if (classic) return classic[1];
  return '';
}

function linesToSystemEntries(lines) {
  return lines.map((raw) => {
    const msg = raw.trim();
    if (!msg) return null;
    const time = extractTimePrefix(msg) || '';
    return {
      time,
      level: inferSystemLevel(msg),
      msg,
    };
  }).filter(Boolean);
}

function linesToOpenclawEntries(lines) {
  return lines.map((raw) => {
    const msg = raw.trim();
    if (!msg) return null;
    let level = 'out';
    if (/^\$\s?/.test(msg) || msg.startsWith('$')) level = 'cmd';
    if (/\berror\b/i.test(msg)) level = 'error';
    const time = extractTimePrefix(msg) || '';
    return { time, level, msg };
  }).filter(Boolean);
}

function collectSystemLogs() {
  const maxLines = Number.parseInt(process.env.LOG_MAX_LINES || '120', 10) || 120;
  const logFile = process.env.LOG_FILE;
  if (logFile && fs.existsSync(logFile)) {
    const lines = readTailLines(logFile, maxLines);
    return {
      entries: linesToSystemEntries(lines),
      hint: null,
      source: logFile,
    };
  }

  if (process.platform !== 'win32') {
    try {
      const out = execSync('journalctl -n 80 --no-pager -o short-iso 2>/dev/null', {
        encoding: 'utf8',
        timeout: 8000,
        maxBuffer: 2_000_000,
        shell: true,
        windowsHide: true,
      });
      const lines = out.split(/\r?\n/).filter(Boolean);
      if (lines.length) {
        return { entries: linesToSystemEntries(lines), hint: null, source: 'journalctl' };
      }
    } catch { /* vacío */ }
  }

  return {
    entries: [],
    hint: systemLogsEmptyHint(),
    source: null,
  };
}

function collectOpenclawLogs() {
  const p = process.env.OPENCLAW_LOG_PATH;
  if (!p || !fs.existsSync(p)) {
    return {
      entries: [],
      hint: 'Define OPENCLAW_LOG_PATH apuntando al archivo de log de OpenClaw, o deja vacío si no aplica.',
      source: null,
    };
  }
  const maxLines = Number.parseInt(process.env.LOG_MAX_LINES || '120', 10) || 120;
  const lines = readTailLines(p, maxLines);
  return { entries: linesToOpenclawEntries(lines), hint: null, source: p };
}

function collectCustomLog(idRaw) {
  const id = String(idRaw || '').trim();
  const merged = mergeWithDefaults(loadUserSettingsRaw());
  const items = merged.logStreams || [];
  const item = items.find((x) => x && x.id === id);
  if (!item) {
    return {
      entries: [],
      hint: 'No hay ningún log con esta clave en Configuración → Logs.',
      source: null,
      label: null,
    };
  }
  const p = item.path;
  let st;
  try {
    st = fs.existsSync(p) ? fs.statSync(p) : null;
  } catch {
    st = null;
  }
  if (!st) {
    return {
      entries: [],
      hint: 'El fichero no existe en el servidor (revisa la ruta absoluta).',
      source: p,
      label: item.label,
    };
  }
  if (!st.isFile()) {
    return {
      entries: [],
      hint: 'La ruta existe pero no es un fichero regular.',
      source: p,
      label: item.label,
    };
  }
  const maxLines = Number.parseInt(process.env.LOG_MAX_LINES || '120', 10) || 120;
  let lines = readTailLines(p, maxLines);
  const reStr = String(item.lineRegex || '').trim();
  if (reStr) {
    try {
      const re = new RegExp(reStr);
      lines = lines.filter((ln) => re.test(ln));
    } catch {
      return {
        entries: [],
        hint: 'El regex guardado en configuración no es válido.',
        source: p,
        label: item.label,
      };
    }
  }
  return { entries: linesToSystemEntries(lines), hint: null, source: p, label: item.label };
}

/* ── OpenClaw: snapshot completo (CLI) + cron del host ── */

function getOpenClawBin() {
  return resolveOpenClawBin();
}

function tryParseJsonOutput(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

async function runOpenClawArgs(args, timeoutMs) {
  const bin = getOpenClawBin();
  const fullArgs = args[0] === '--no-color' ? args : ['--no-color', ...args];
  try {
    const { stdout, stderr } = await execFileAsync(bin, fullArgs, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 25_000_000,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', OPENCLAW_NONINTERACTIVE: '1' },
    });
    const out = (stdout || '').trim();
    const err = (stderr || '').trim();
    return {
      ok: true,
      exitCode: 0,
      stdout: out,
      stderr: err,
      parsed: tryParseJsonOutput(out),
    };
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return {
        ok: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        parsed: null,
        error: 'ENOENT',
      };
    }
    const stdout = e.stdout != null ? String(e.stdout).trim() : '';
    const stderr = e.stderr != null ? String(e.stderr).trim() : '';
    const exitCode = typeof e.code === 'number' && !Number.isNaN(e.code) ? e.code : 1;
    return {
      ok: false,
      exitCode,
      stdout,
      stderr: stderr || String(e.message || e || ''),
      parsed: tryParseJsonOutput(stdout),
    };
  }
}

/**
 * Subcomandos con salida JSON (--json) cuando el CLI lo soporta.
 * Timeouts por sonda; todo en paralelo (tiempo total ≈ el más lento).
 */
const OPENCLAW_CLI_PROBES = [
  { key: 'version', args: ['-V'], ms: 8000 },
  { key: 'status', args: ['status', '--json'], ms: 25000 },
  { key: 'health', args: ['health', '--json'], ms: 15000 },
  { key: 'directory', args: ['directory', '--json'], ms: 12000 },
  { key: 'skills_list', args: ['skills', 'list', '--json'], ms: 25000 },
  { key: 'skills_check', args: ['skills', 'check', '--json'], ms: 20000 },
  { key: 'agents_list', args: ['agents', 'list', '--json'], ms: 20000 },
  { key: 'agents_bindings', args: ['agents', 'bindings', '--json'], ms: 20000 },
  { key: 'plugins_list', args: ['plugins', 'list', '--json'], ms: 20000 },
  { key: 'channels_list', args: ['channels', 'list', '--json'], ms: 25000 },
  { key: 'channels_status', args: ['channels', 'status', '--json'], ms: 20000 },
  { key: 'cron_status', args: ['cron', 'status', '--json'], ms: 12000 },
  { key: 'cron_list', args: ['cron', 'list', '--json'], ms: 25000 },
  { key: 'tasks_list', args: ['tasks', 'list', '--json'], ms: 20000 },
  { key: 'tasks_flow', args: ['tasks', 'flow', 'list', '--json'], ms: 15000 },
  { key: 'gateway_status', args: ['gateway', 'status', '--json'], ms: 15000 },
  { key: 'gateway_health', args: ['gateway', 'health', '--json'], ms: 15000 },
  { key: 'gateway_probe', args: ['gateway', 'probe', '--json'], ms: 20000 },
  { key: 'models_list', args: ['models', 'list', '--json'], ms: 25000 },
  { key: 'memory_status', args: ['memory', 'status', '--json'], ms: 15000 },
  { key: 'mcp_list', args: ['mcp', 'list', '--json'], ms: 15000 },
  { key: 'hooks_list', args: ['hooks', 'list', '--json'], ms: 15000 },
  { key: 'nodes', args: ['nodes', '--json'], ms: 20000 },
  { key: 'devices_list', args: ['devices', 'list', '--json'], ms: 15000 },
  { key: 'pairing_list', args: ['pairing', 'list', '--json'], ms: 15000 },
  { key: 'approvals_get', args: ['approvals', 'get', '--json'], ms: 12000 },
  { key: 'sandbox_list', args: ['sandbox', 'list', '--json'], ms: 15000 },
  { key: 'config_file', args: ['config', 'file'], ms: 8000 },
  { key: 'config_validate', args: ['config', 'validate', '--json'], ms: 20000 },
  { key: 'security_audit', args: ['security', 'audit', '--json'], ms: 30000 },
  { key: 'doctor', args: ['doctor', '--non-interactive'], ms: 35000 },
];

/**
 * Relleno ilustrativo legado (Pine, agentes ficticios). Solo si OPENCLAW_DEMO_FILL=1.
 * Por defecto la UI usa datos vivos del CLI y del disco (`buildOpenClawLiveFill`).
 */
function getOpenClawLegacyDemoFill() {
  return {
    note: 'Bloque ilustrativo legado (OPENCLAW_DEMO_FILL=1). Desactiva esta variable para ver solo CLI + disco.',
    personality: {
      displayName: 'Pine · asistente del monitor',
      role: 'Puente amable entre el host, los logs y los agentes OpenClaw.',
      tone: 'Cálido y directo; evita jerga si el usuario es nuevo.',
      locale: 'es-ES',
      traits: ['Curioso ante errores raros', 'Cauto con rm/dd/format', 'Detallista en rutas y puertos'],
      voice: 'Neutro, ritmo pausado; sin sarcasmo en producción.',
      quirks: [
        'Propone tablas cuando hay más de tres métricas.',
        'Recuerda revisar Docker y cron antes de culpar a la red.',
      ],
      systemPromptPreview:
        `Eres el copiloto del entorno ${APP_DISPLAY_NAME}. Prioriza seguridad, cita rutas absolutas y resume antes de ejecutar comandos destructivos.`,
      boundaries: ['No exfiltra secretos', 'No desactiva backups sin confirmación explícita'],
    },
    agentsPreview: [
      {
        id: 'default',
        label: 'Agente principal',
        binding: '* · canal por defecto',
        persona: 'Generalista: código, logs y preguntas del sistema.',
      },
      {
        id: 'coding',
        label: 'coding',
        binding: 'telegram · cuenta alerts',
        persona: 'Enfocado en PRs, tests y revisiones largas.',
      },
      {
        id: 'ops',
        label: 'ops',
        binding: 'slack · #infra',
        persona: 'Docker, cron, métricas y reinicios controlados.',
      },
    ],
    workspace: {
      path: '~/.openclaw/workspace',
      skillsDirs: ['~/.openclaw/skills', '~/.openclaw/workspace/skills', '.cursor/skills'],
      memoryFiles: ['MEMORY.md', 'memory/contexto.md'],
    },
    style: {
      markdown: 'Encabezados cortos, listas con viñetas, bloques de código con idioma.',
      citations: 'Enlaza documentación oficial cuando el usuario pida “por qué”.',
    },
    legacyDemo: true,
  };
}

function ocAsArray(x) {
  if (x == null) return [];
  if (Array.isArray(x)) return x;
  return [];
}

function ocIsMockObject(o) {
  return !!(o && typeof o === 'object' && o.mock === true);
}

/** Normaliza filas de agentes desde `agents list --json` y enriquece con `agents bindings --json` si encaja. */
function extractOpenClawAgentRows(agentsParsed, bindingsParsed) {
  if (!agentsParsed || typeof agentsParsed !== 'object' || ocIsMockObject(agentsParsed)) return [];
  let raw = agentsParsed;
  if (agentsParsed.agents != null) raw = agentsParsed.agents;
  else if (agentsParsed.items != null) raw = agentsParsed.items;
  else if (agentsParsed.data != null && typeof agentsParsed.data === 'object') {
    raw = agentsParsed.data.agents ?? agentsParsed.data.items ?? agentsParsed.data;
  }
  const list = ocAsArray(raw).filter((x) => x && typeof x === 'object' && !ocIsMockObject(x));
  const bindMap = new Map();
  if (bindingsParsed && typeof bindingsParsed === 'object' && !ocIsMockObject(bindingsParsed)) {
    let br = bindingsParsed.bindings ?? bindingsParsed.items ?? bindingsParsed.agents ?? bindingsParsed;
    if (typeof br === 'object' && !Array.isArray(br) && br.list) br = br.list;
    const bl = ocAsArray(br).filter((x) => x && typeof x === 'object' && !ocIsMockObject(x));
    for (const b of bl) {
      const bid = b.agentId ?? b.agent ?? b.id ?? b.name ?? b.slug;
      if (bid != null) bindMap.set(String(bid), b);
    }
  }
  return list.map((a) => {
    const id = a.id ?? a.agentId ?? a.name ?? a.slug ?? '—';
    const label = a.label ?? a.displayName ?? a.title ?? a.name ?? id;
    const bind = bindMap.get(String(id));
    let binding = '—';
    if (typeof a.binding === 'string') binding = a.binding;
    else if (a.channel != null) binding = String(a.channel);
    else if (bind) {
      binding =
        bind.channel != null
          ? String(bind.channel)
          : bind.binding != null
            ? String(bind.binding)
            : bind.target != null
              ? String(bind.target)
              : '—';
    }
    const persona = a.persona ?? a.description ?? a.role ?? a.summary ?? '—';
    return { id: String(id), label: String(label), binding: String(binding), persona: String(persona) };
  });
}

/** Skills desde `skills list --json` más carpetas con SKILL.md del layout en disco. */
function extractOpenClawSkillRows(skillsParsed, installSkills) {
  const rows = [];
  const seen = new Set();
  if (skillsParsed && typeof skillsParsed === 'object' && !ocIsMockObject(skillsParsed)) {
    let raw = skillsParsed.skills ?? skillsParsed.items ?? skillsParsed.data ?? skillsParsed;
    if (typeof raw === 'object' && !Array.isArray(raw) && raw.list) raw = raw.list;
    const list = ocAsArray(raw).filter((x) => x !== null && (typeof x === 'string' || (typeof x === 'object' && !ocIsMockObject(x))));
    for (const s of list) {
      if (typeof s === 'string') {
        const name = s.trim() || '—';
        if (seen.has(name)) continue;
        seen.add(name);
        rows.push({ name, path: '—', source: 'cli' });
      } else {
        const name = String(s.name ?? s.id ?? s.skill ?? s.slug ?? '—');
        const pth = s.path != null ? String(s.path) : s.dir != null ? String(s.dir) : '—';
        if (seen.has(name)) continue;
        seen.add(name);
        rows.push({ name, path: pth, source: 'cli' });
      }
    }
  }
  if (installSkills && Array.isArray(installSkills.items)) {
    for (const it of installSkills.items) {
      const n = it.skillDir || '—';
      if (seen.has(n)) continue;
      seen.add(n);
      rows.push({
        name: String(n),
        path: String(it.skillMdPath || '—'),
        source: 'disk',
        hasSkillMd: !!it.exists,
      });
    }
  }
  return rows;
}

function openclawFirstParagraph(text) {
  if (!text || typeof text !== 'string') return '';
  const t = text.trim();
  if (!t) return '';
  const para = t.split(/\n\n|\r\n\r\n/)[0] || t.split(/\n/)[0];
  return para.slice(0, 480);
}

/** Personalidad resumida desde AGENTS.md / SOUL.md / IDENTITY.md leídos del workspace. */
function personalityFromWorkspaceFiles(wf) {
  if (!wf || typeof wf !== 'object') return null;
  const pick = (key) => {
    const ent = wf[key];
    return ent && ent.exists && typeof ent.content === 'string' ? ent.content.trim() : '';
  };
  const soulT = pick('SOUL');
  const agT = pick('AGENTS');
  const idT = pick('IDENTITY');
  if (!soulT && !agT && !idT) return null;
  let displayName = '—';
  const hm = idT.match(/^#\s+(.+)$/m);
  if (hm) displayName = hm[1].trim().slice(0, 120);
  const role = openclawFirstParagraph(agT) || openclawFirstParagraph(soulT) || openclawFirstParagraph(idT) || '—';
  const preview = soulT || agT || idT;
  return {
    displayName,
    role,
    tone: '—',
    locale: '—',
    traits: [],
    voice: '—',
    quirks: [],
    systemPromptPreview: preview ? preview.slice(0, 2400) : '',
    boundaries: [],
    fromWorkspace: true,
  };
}

function workspaceFillFromInstall(il) {
  if (!il || typeof il !== 'object' || !il.roots) return null;
  const { roots } = il;
  const skillsDirs = [];
  if (roots.workspace) skillsDirs.push(path.join(roots.workspace, 'skills'));
  if (roots.skills) skillsDirs.push(roots.skills);
  const uniqDirs = [...new Set(skillsDirs)];
  const memFiles = [];
  if (il.memory && Array.isArray(il.memory.entries)) {
    for (const e of il.memory.entries.slice(0, 16)) {
      if (e && e.name) memFiles.push(e.path ? String(e.path) : `memory/${e.name}`);
    }
  }
  const wfMem = il.workspaceFiles && il.workspaceFiles.MEMORY;
  if (wfMem && wfMem.exists && wfMem.path && !memFiles.includes(String(wfMem.path))) {
    memFiles.unshift(String(wfMem.path));
  }
  return {
    path: roots.workspace ? String(roots.workspace) : '—',
    skillsDirs: uniqDirs,
    memoryFiles: memFiles.length ? memFiles : [],
  };
}

/** Filas de agentes plausibles cuando el CLI no devuelve filas parseables (marcadas con mock: true). */
function getOpenClawPlausibleMockAgents() {
  return [
    {
      id: 'default',
      label: 'Principal',
      binding: 'gateway · predeterminado',
      persona: 'Asistente del workspace; canales según la config del gateway.',
      mock: true,
    },
    {
      id: 'ops',
      label: 'Operaciones',
      binding: 'cron · host',
      persona: 'Tareas programadas, servicios del sistema y métricas del host.',
      mock: true,
    },
    {
      id: 'skills',
      label: 'Skills / docs',
      binding: 'filesystem · catálogo',
      persona: 'Lectura de SKILL.md y documentación empaquetada con OpenClaw.',
      mock: true,
    },
  ];
}

/** Skills de ejemplo con rutas creíbles (env / layout / defaults del proyecto). */
function getOpenClawPlausibleMockSkills(installLayout) {
  const roots = installLayout && installLayout.roots;
  const ws = roots && roots.workspace ? String(roots.workspace) : openclawEnvPath('OPENCLAW_WORKSPACE', OPENCLAW_PATH_DEFAULTS.workspace);
  const sk = roots && roots.skills ? String(roots.skills) : openclawEnvPath('OPENCLAW_SKILLS', OPENCLAW_PATH_DEFAULTS.skills);
  return [
    { name: 'orchestrator', path: path.join(sk, 'orchestrator', 'SKILL.md'), source: 'mock', hasSkillMd: null },
    { name: 'workspace-tools', path: path.join(ws, 'skills', 'workspace-tools', 'SKILL.md'), source: 'mock', hasSkillMd: null },
    { name: 'openclaw-docs', path: path.join(sk, 'openclaw-docs', 'SKILL.md'), source: 'mock', hasSkillMd: null },
  ];
}

function getOpenClawPlausibleMockPersonality() {
  return {
    displayName: 'Asistente del entorno',
    role: `Copiloto del host (${APP_DISPLAY_NAME}): métricas, rutas, cron y agentes OpenClaw cuando el CLI esté disponible.`,
    tone: 'Técnico y directo; no inventa salidas del CLI.',
    locale: 'es-ES',
    traits: ['Cauteloso con comandos destructivos', 'Cita rutas absolutas'],
    voice: 'Neutro',
    quirks: ['Resume tablas cuando hay varias métricas'],
    systemPromptPreview:
      '(Simulación plausible) Si existen AGENTS.md o SOUL.md en el workspace, este bloque se sustituye por el texto leído del disco.',
    boundaries: ['No afirmar bindings reales sin salida de agents list --json'],
    fromWorkspace: false,
    mock: true,
  };
}

/** Rutas típicas cuando no hay layout legible (sigue OPENCLAW_* / defaults). */
function getOpenClawPlausibleMockWorkspace(installLayout) {
  const roots = installLayout && installLayout.roots;
  const w =
    roots && roots.workspace
      ? String(roots.workspace)
      : openclawEnvPath('OPENCLAW_WORKSPACE', OPENCLAW_PATH_DEFAULTS.workspace);
  const s =
    roots && roots.skills
      ? String(roots.skills)
      : openclawEnvPath('OPENCLAW_SKILLS', OPENCLAW_PATH_DEFAULTS.skills);
  return {
    path: w,
    skillsDirs: [...new Set([path.join(w, 'skills'), s])],
    memoryFiles: [],
    mock: true,
  };
}

/**
 * Datos para la tarjeta «Perfil, agentes y estilo»: CLI (--json) + lectura FS (installLayout).
 * Si falta algún bloque, se rellena con mocks plausibles (mock: true / source: mock) para que la UI no quede vacía.
 */
function buildOpenClawLiveFill(probes, installLayout, { available, mockMode }) {
  let agentsPreview = extractOpenClawAgentRows(
    probes.agents_list && probes.agents_list.parsed,
    probes.agents_bindings && probes.agents_bindings.parsed,
  );
  let skillsPreview = extractOpenClawSkillRows(
    probes.skills_list && probes.skills_list.parsed,
    installLayout && installLayout.skills,
  );
  let personality = personalityFromWorkspaceFiles(installLayout && installLayout.workspaceFiles);
  let workspace = workspaceFillFromInstall(installLayout);

  const usedAgentMock = !agentsPreview.length;
  const usedSkillMock = !skillsPreview.length;
  const usedPersonaMock = !personality;
  const usedWsMock = !workspace;

  if (usedAgentMock) agentsPreview = getOpenClawPlausibleMockAgents();
  if (usedSkillMock) skillsPreview = getOpenClawPlausibleMockSkills(installLayout);
  if (usedPersonaMock) personality = getOpenClawPlausibleMockPersonality();
  if (usedWsMock) workspace = getOpenClawPlausibleMockWorkspace(installLayout);

  const alProbe = probes.agents_list;
  const slProbe = probes.skills_list;
  if (alProbe && alProbe.mock && agentsPreview.length) {
    agentsPreview = agentsPreview.map((r) => ({ ...r, mock: true }));
  }
  if (slProbe && slProbe.mock && skillsPreview.length) {
    skillsPreview = skillsPreview.map((r) => (r.source === 'disk' ? r : { ...r, source: 'mock' }));
  }

  let note = null;
  if (mockMode || !available) {
    note =
      'Sin CLI OpenClaw en el PATH de la API: cada sección de sondas incluye JSON de vista previa de lo que suelen exponer los comandos (agentes, skills y permisos, bindings, canales, plugins, MCP, hooks, gateway, modelos, memoria, cron/tareas, nodos, dispositivos, pairing, aprobaciones, sandbox, validación de config y auditoría). La tarjeta «Instalación en disco» sigue leyendo rutas reales si existen.';
  }

  const synthParts = [];
  if (usedAgentMock) synthParts.push('agentes');
  if (usedSkillMock) synthParts.push('skills');
  if (usedPersonaMock) synthParts.push('personalidad');
  if (usedWsMock) synthParts.push('workspace');
  let syntheticNote =
    synthParts.length > 0
      ? `Faltan datos reales para: ${synthParts.join(', ')}. Las tablas muestran valores simulados plausibles (no son salida del binario ni del disco).`
      : null;
  if (mockMode) {
    const catalog =
      'Despliega las sondas inferiores: verás `_openclawPreview` y ejemplos de capabilities, permissionsRequired, exposedSurfaces y políticas de aprobación.';
    syntheticNote = syntheticNote ? `${syntheticNote} ${catalog}` : catalog;
  }

  return {
    note,
    syntheticNote,
    personality,
    agentsPreview,
    skillsPreview,
    workspace,
    style: null,
    live: true,
    syntheticMock: synthParts.length > 0,
  };
}

function resolveOpenClawFillForSnapshot(probes, installLayout, ctx) {
  if (process.env.OPENCLAW_DEMO_FILL === '1') {
    const legacy = getOpenClawLegacyDemoFill();
    if (legacy) return legacy;
  }
  return buildOpenClawLiveFill(probes, installLayout, ctx);
}

/**
 * JSON ilustrativo por sonda cuando no hay CLI: muestra la superficie que suelen exponer los subcomandos
 * (agentes, skills, permisos, aprobaciones, MCP, gateway, seguridad, etc.).
 */
function getOpenClawDisconnectedProbeParsed(key) {
  const home = os.homedir();
  const ws = openclawEnvPath('OPENCLAW_WORKSPACE', OPENCLAW_PATH_DEFAULTS.workspace);
  const sk = openclawEnvPath('OPENCLAW_SKILLS', OPENCLAW_PATH_DEFAULTS.skills);
  const docs = openclawEnvPath('OPENCLAW_DOCS', OPENCLAW_PATH_DEFAULTS.docs);
  const media = openclawEnvPath('OPENCLAW_MEDIA_INBOUND', OPENCLAW_PATH_DEFAULTS.mediaInbound);
  const cfg = path.join(home, '.openclaw', 'openclaw.json');
  const m = () => ({
    _openclawPreview: true,
    _disconnected: true,
    _explain:
      'Simulación sin CLI en el PATH de la API: campos típicos de `openclaw … --json`. Instala el binario o define OPENCLAW_BIN para salida real.',
  });

  switch (key) {
    case 'version':
      return { ...m(), version: 'preview', channel: 'disconnected', binary: 'openclaw (no resuelto en la API)' };
    case 'status':
      return {
        ...m(),
        cliReachable: false,
        workspaceRoot: ws,
        configFile: cfg,
        skillsRoot: sk,
        gatewayRunning: null,
        activeChannels: 0,
        agentsLoaded: 0,
      };
    case 'health':
      return {
        ...m(),
        ok: false,
        checks: [
          { id: 'binary', ok: false, detail: 'Ejecutable no encontrado en el entorno de metrics-api' },
          { id: 'gateway', ok: null, detail: 'No comprobable sin CLI' },
          { id: 'workspace', ok: true, detail: 'Rutas OPENCLAW_* / por defecto definidas para lectura FS' },
        ],
      };
    case 'directory':
      return {
        ...m(),
        roots: [
          { role: 'workspace', path: ws },
          { role: 'skills_pack', path: sk },
          { role: 'docs', path: docs },
          { role: 'media_inbound', path: media },
          { role: 'config', path: cfg },
        ],
      };
    case 'skills_list':
      return {
        ...m(),
        skills: [
          {
            name: 'orchestrator',
            path: path.join(sk, 'orchestrator', 'SKILL.md'),
            permissions: ['read_workspace', 'invoke_subagents'],
            risk: 'medium',
          },
          {
            name: 'filesystem-tools',
            path: path.join(ws, 'skills', 'filesystem-tools', 'SKILL.md'),
            permissions: ['read_file', 'list_dir', 'write_file_scoped'],
            risk: 'high',
          },
          {
            name: 'openclaw-docs',
            path: path.join(sk, 'openclaw-docs', 'SKILL.md'),
            permissions: ['read_packaged_docs'],
            risk: 'low',
          },
        ],
      };
    case 'skills_check':
      return {
        ...m(),
        results: [
          { skill: 'orchestrator', valid: true, issues: [] },
          { skill: 'filesystem-tools', valid: false, issues: ['SKILL.md falta frontmatter name'] },
        ],
      };
    case 'agents_list':
      return {
        ...m(),
        agents: [
          {
            id: 'default',
            label: 'Principal',
            channel: 'gateway',
            persona: 'Generalista workspace + canales',
            capabilities: ['read_memory', 'use_skills', 'request_approval'],
          },
          {
            id: 'ops',
            label: 'Operaciones',
            channel: 'slack',
            persona: 'Infra, cron, servicios',
            capabilities: ['read_logs', 'propose_exec', 'docker_readonly'],
          },
          {
            id: 'coding',
            label: 'Código',
            channel: 'telegram',
            persona: 'PRs, tests, revisiones',
            capabilities: ['read_repo', 'diff', 'run_tests_sandbox'],
          },
        ],
      };
    case 'agents_bindings':
      return {
        ...m(),
        bindings: [
          { agentId: 'default', target: 'gateway:default', channelType: 'multi' },
          { agentId: 'ops', target: 'slack:#infra', channelType: 'slack' },
          { agentId: 'coding', target: 'telegram:alerts_bot', channelType: 'telegram' },
        ],
      };
    case 'plugins_list':
      return {
        ...m(),
        plugins: [
          { id: 'channels.telegram', enabled: true, version: '0.x', exposes: ['inbound', 'outbound'] },
          { id: 'channels.slack', enabled: true, version: '0.x', exposes: ['slash', 'events'] },
          { id: 'hooks.cron-bridge', enabled: false, version: '0.x', exposes: ['schedule'] },
        ],
      };
    case 'channels_list':
      return {
        ...m(),
        channels: [
          { id: 'tg-main', type: 'telegram', agentId: 'coding', secretsFrom: 'env:TELEGRAM_BOT_TOKEN' },
          { id: 'slack-infra', type: 'slack', agentId: 'ops', secretsFrom: 'openclaw.json → slack.token' },
        ],
      };
    case 'channels_status':
      return {
        ...m(),
        channels: [
          { id: 'tg-main', connected: false, lastError: 'Sin CLI: no hay handshake real' },
          { id: 'slack-infra', connected: false, lastError: 'Sin CLI: no hay handshake real' },
        ],
      };
    case 'cron_status':
      return { ...m(), enabled: true, scope: 'user', note: 'Estado interno OpenClaw (no confundir con cron del host en otra tarjeta)' };
    case 'cron_list':
      return {
        ...m(),
        jobs: [
          { id: 'oc-heartbeat', schedule: '*/5 * * * *', command: 'openclaw tasks run heartbeat' },
          { id: 'oc-digest', schedule: '0 8 * * *', command: 'openclaw tasks run daily-digest' },
        ],
      };
    case 'tasks_list':
      return {
        ...m(),
        tasks: [
          { id: 'heartbeat', agentId: 'default', triggers: ['cron', 'manual'] },
          { id: 'ingest-media', agentId: 'default', triggers: ['webhook'], permissions: ['read', media] },
        ],
      };
    case 'tasks_flow':
      return {
        ...m(),
        flows: [{ id: 'on-message', steps: ['classify', 'skill_router', 'respond', 'log'] }],
      };
    case 'gateway_status':
      return { ...m(), listening: null, bind: '127.0.0.1:18765', tls: false, auth: 'token|mtls' };
    case 'gateway_health':
      return { ...m(), reachable: false, latencyMs: null, lastProbe: null };
    case 'gateway_probe':
      return { ...m(), routes: ['/v1/chat', '/v1/agents', '/health'], cors: 'restricted', rateLimit: 'enabled' };
    case 'models_list':
      return {
        ...m(),
        models: [
          { id: 'gpt-4.1', provider: 'openai', default: true },
          { id: 'claude-sonnet', provider: 'anthropic', default: false },
        ],
      };
    case 'memory_status':
      return {
        ...m(),
        backend: 'workspace+index',
        workspaceRoot: ws,
        entriesApprox: 0,
        paths: [path.join(ws, 'MEMORY.md'), path.join(ws, 'memory')],
      };
    case 'mcp_list':
      return {
        ...m(),
        servers: [
          {
            name: 'workspace-fs',
            tools: ['read_file', 'list_dir', 'search'],
            rootsAllowlist: [ws],
            permissions: ['read scoped to workspace'],
          },
          { name: 'git', tools: ['status', 'diff', 'log'], permissions: ['read .git'] },
          { name: 'exec-sandbox', tools: ['run_command'], permissions: ['deny-by-default', 'approval_on_write'] },
        ],
      };
    case 'hooks_list':
      return {
        ...m(),
        hooks: [
          { event: 'message.inbound', handler: 'hooks/on-message.ts', canMutate: ['memory', 'tasks'] },
          { event: 'task.complete', handler: 'hooks/audit.ts', canMutate: ['logs'] },
        ],
      };
    case 'nodes':
      return {
        ...m(),
        nodes: [
          { id: 'node-local', role: 'primary', host: '127.0.0.1', labels: ['gateway', 'skills'] },
          { id: 'node-edge', role: 'worker', host: '10.0.0.12', labels: ['channels'] },
        ],
      };
    case 'devices_list':
      return {
        ...m(),
        devices: [
          { id: 'dev-mobile-1', type: 'mobile', paired: false, lastSeen: null },
          { id: 'dev-cli', type: 'terminal', paired: true, agentId: 'default' },
        ],
      };
    case 'pairing_list':
      return {
        ...m(),
        sessions: [
          { code: 'OC-XXXX', expiresInSec: 600, scope: 'add_device', requiresApproval: true },
        ],
      };
    case 'approvals_get':
      return {
        ...m(),
        policy: 'Human-in-the-loop para exec, escritura fuera del workspace y salida de sandbox',
        pending: [
          {
            id: 'appr-exec-1',
            scope: 'exec(host)',
            command: 'systemctl restart openclaw-gateway',
            agentId: 'ops',
            risk: 'high',
            permissionsRequired: ['host.exec', 'systemd'],
          },
          {
            id: 'appr-fs-1',
            scope: 'filesystem(write)',
            path: path.join(ws, 'MEMORY.md'),
            agentId: 'default',
            risk: 'medium',
            permissionsRequired: ['workspace.write'],
          },
          {
            id: 'appr-net-1',
            scope: 'network(outbound)',
            target: 'https://api.example.com',
            agentId: 'coding',
            risk: 'low',
            permissionsRequired: ['egress.allowlist'],
          },
        ],
      };
    case 'sandbox_list':
      return {
        ...m(),
        sandboxes: [
          {
            id: 'sb-default',
            isolation: 'process|container',
            allowedRead: [ws, sk],
            allowedWrite: [path.join(ws, 'tmp')],
            network: 'egress-deny-by-default',
          },
        ],
      };
    case 'config_validate':
      return {
        ...m(),
        valid: true,
        warnings: [
          'Ejemplo: token de canal caduca en N días — rotar en openclaw.json o env',
          'Ejemplo: gateway bind 0.0.0.0 expone la API en todas las interfaces',
        ],
        pathsRead: [cfg],
      };
    case 'security_audit':
      return {
        ...m(),
        summary: { critical: 0, high: 1, medium: 3, low: 5, info: 6 },
        exposedSurfaces: [
          { area: 'CLI', detail: 'Todos los subcomandos leen la config efectiva del usuario que ejecuta openclaw' },
          { area: 'workspace', path: ws, readable: ['*.md', 'memory/**', 'skills/**'] },
          { area: 'secrets', detail: 'Canales: tokens en env y openclaw.json; no registrar en logs' },
          { area: 'gateway_http', detail: 'Rutas /v1/* si el gateway está activo; autenticación obligatoria' },
          { area: 'MCP', detail: 'Herramientas de terceros heredan permisos del proceso del agente' },
        ],
        recommendations: [
          'Restringir quién puede llamar a /api/openclaw en la API de métricas',
          'OPENCLAW_BIN solo en hosts de confianza',
          'Revisar aprobaciones y sandbox antes de habilitar exec',
        ],
      };
    default:
      return { ...m(), commandKey: key, hint: 'Plantilla genérica: con el CLI instalado verás el JSON real de esta sonda.' };
  }
}

/**
 * Sondas simuladas cuando no hay binario: salida JSON rica (superficie expuesta) + mock: true en el envoltorio.
 */
function buildOpenClawMockProbes() {
  const out = {};
  for (const p of OPENCLAW_CLI_PROBES) {
    const cmdLine = `openclaw --no-color ${p.args.join(' ')}`;
    let parsed;
    let stdout;
    if (p.key === 'config_file') {
      parsed = null;
      stdout = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    } else if (p.key === 'doctor') {
      parsed = null;
      stdout = [
        'OpenClaw doctor (vista previa sin CLI)',
        '— binary: no encontrado en PATH de metrics-api',
        '— workspace: revisar OPENCLAW_WORKSPACE',
        '— gateway: no verificable sin binario',
        'Instala openclaw o define OPENCLAW_BIN para comprobaciones reales.',
      ].join('\n');
    } else {
      parsed = getOpenClawDisconnectedProbeParsed(p.key);
    }
    const stdoutFinal = stdout != null ? stdout : JSON.stringify(parsed, null, 2);
    out[p.key] = {
      ok: true,
      exitCode: 0,
      stdout: stdoutFinal,
      stderr: '',
      parsed: parsed != null ? parsed : tryParseJsonOutput(stdoutFinal),
      cmd: cmdLine,
      mock: true,
    };
  }
  return out;
}

/** Rutas por defecto (VPS típico); override con OPENCLAW_WORKSPACE, OPENCLAW_DOCS, OPENCLAW_SKILLS, OPENCLAW_MEDIA_INBOUND */
const OPENCLAW_PATH_DEFAULTS = {
  workspace: '/home/openclaw_vps/.openclaw/workspace',
  docs: '/home/openclaw_vps/.npm-global/lib/node_modules/openclaw/docs',
  skills: '/home/openclaw_vps/.npm-global/lib/node_modules/openclaw/skills',
  mediaInbound: '/home/openclaw_vps/.openclaw/media/inbound',
};

const OPENCLAW_WORKSPACE_CANONICAL = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'IDENTITY.md',
  'TOOLS.md',
  'MEMORY.md',
  'HEARTBEAT.md',
];

const OPENCLAW_READ_CAP_WORKSPACE = 131072;
const OPENCLAW_READ_CAP_SKILL = 65536;
const OPENCLAW_READ_CAP_MEMORY = 49152;
const OPENCLAW_DOCS_MAX_FILES = 120;
const OPENCLAW_DOCS_MAX_DEPTH = 8;

function openclawEnvPath(key, fallback) {
  const v = String(process.env[key] || '').trim();
  return v || fallback;
}

function safeRealRoot(dir) {
  try {
    const r = fs.realpathSync(dir);
    return r;
  } catch {
    return null;
  }
}

/** Comprueba que candidate (normalizado) está bajo rootReal. */
function isPathInsideRoot(rootReal, candidateAbs) {
  if (!rootReal || !candidateAbs) return false;
  const rel = path.relative(rootReal, candidateAbs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function readUtf8FileCapped(absPath, maxBytes) {
  const buf = await fsp.readFile(absPath);
  const slice = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;
  const truncated = buf.length > maxBytes;
  let text = slice.toString('utf8');
  const re = /\uFFFD/;
  if (re.test(text)) {
    text = `[binario o no UTF-8; ${buf.length} bytes]\n`;
  }
  return { text, truncated, size: buf.length };
}

async function collectOpenClawInstallLayout() {
  if (process.env.OPENCLAW_FS_DISABLE === '1') {
    return { disabled: true, message: 'OPENCLAW_FS_DISABLE=1' };
  }

  const roots = {
    workspace: openclawEnvPath('OPENCLAW_WORKSPACE', OPENCLAW_PATH_DEFAULTS.workspace),
    docs: openclawEnvPath('OPENCLAW_DOCS', OPENCLAW_PATH_DEFAULTS.docs),
    skills: openclawEnvPath('OPENCLAW_SKILLS', OPENCLAW_PATH_DEFAULTS.skills),
    mediaInbound: openclawEnvPath('OPENCLAW_MEDIA_INBOUND', OPENCLAW_PATH_DEFAULTS.mediaInbound),
  };

  const out = {
    roots,
    at: Date.now(),
    workspaceExists: false,
    workspaceFiles: {},
    memory: { dir: '', exists: false, entries: [] },
    skills: { dir: '', exists: false, items: [] },
    docs: { dir: '', exists: false, files: [], fileCount: 0, capped: false },
    mediaInbound: { dir: '', exists: false, fileCount: 0, sample: [] },
    workspaceSubdirs: {},
  };

  const wsRoot = roots.workspace;
  const wsReal = safeRealRoot(wsRoot);
  out.workspaceExists = !!wsReal;

  for (const name of OPENCLAW_WORKSPACE_CANONICAL) {
    const key = name.replace(/\.md$/i, '').replace(/[^a-z0-9_]/gi, '_');
    if (!wsReal) {
      out.workspaceFiles[key] = { name, path: path.join(wsRoot, name), exists: false, error: 'Workspace no accesible' };
      continue;
    }
    const abs = path.join(wsReal, name);
    if (!isPathInsideRoot(wsReal, abs)) {
      out.workspaceFiles[key] = { name, path: abs, exists: false, error: 'Ruta inválida' };
      continue;
    }
    try {
      const st = await fsp.stat(abs);
      if (!st.isFile()) {
        out.workspaceFiles[key] = { name, path: abs, exists: false, error: 'No es un fichero' };
        continue;
      }
      const { text, truncated, size } = await readUtf8FileCapped(abs, OPENCLAW_READ_CAP_WORKSPACE);
      out.workspaceFiles[key] = {
        name,
        path: abs,
        exists: true,
        content: text,
        truncated,
        size,
      };
    } catch (e) {
      const code = e && e.code;
      out.workspaceFiles[key] = {
        name,
        path: abs,
        exists: code !== 'ENOENT',
        error: code === 'ENOENT' ? 'No encontrado' : String(e.message || e),
      };
    }
  }

  const memDir = wsReal ? path.join(wsReal, 'memory') : path.join(wsRoot, 'memory');
  out.memory.dir = memDir;
  try {
    const mr = wsReal ? safeRealRoot(memDir) : null;
    if (mr && isPathInsideRoot(wsReal, mr)) {
      out.memory.exists = true;
      const names = await fsp.readdir(mr);
      const mdFiles = names.filter((n) => /\.md$/i.test(n)).sort().reverse();
      for (const n of mdFiles.slice(0, 40)) {
        const abs = path.join(mr, n);
        try {
          const st = await fsp.stat(abs);
          if (!st.isFile()) continue;
          const { text, truncated, size } = await readUtf8FileCapped(abs, OPENCLAW_READ_CAP_MEMORY);
          out.memory.entries.push({
            name: n,
            path: abs,
            size,
            mtimeMs: st.mtimeMs,
            content: text,
            truncated,
          });
        } catch (e) {
          out.memory.entries.push({ name: n, path: abs, error: String(e.message || e) });
        }
      }
    } else {
      try {
        await fsp.access(memDir);
        out.memory.exists = true;
        out.memory.error = 'No se pudo validar ruta bajo workspace';
      } catch {
        out.memory.exists = false;
      }
    }
  } catch (e) {
    out.memory.error = String(e.message || e);
  }

  const skillsRoot = roots.skills;
  const skReal = safeRealRoot(skillsRoot);
  out.skills.dir = skillsRoot;
  out.skills.exists = !!skReal;
  if (skReal) {
    try {
      const dirs = await fsp.readdir(skReal, { withFileTypes: true });
      for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!d.isDirectory()) continue;
        const skillAbs = path.join(skReal, d.name, 'SKILL.md');
        try {
          await fsp.access(skillAbs);
        } catch {
          out.skills.items.push({
            skillDir: d.name,
            skillMdPath: skillAbs,
            exists: false,
            error: 'SKILL.md no encontrado',
          });
          continue;
        }
        if (!isPathInsideRoot(skReal, path.dirname(skillAbs))) continue;
        try {
          const { text, truncated, size } = await readUtf8FileCapped(skillAbs, OPENCLAW_READ_CAP_SKILL);
          out.skills.items.push({
            skillDir: d.name,
            skillMdPath: skillAbs,
            exists: true,
            content: text,
            truncated,
            size,
          });
        } catch (e) {
          out.skills.items.push({ skillDir: d.name, skillMdPath: skillAbs, exists: false, error: String(e.message || e) });
        }
      }
    } catch (e) {
      out.skills.error = String(e.message || e);
    }
  }

  const docsRoot = roots.docs;
  const docsReal = safeRealRoot(docsRoot);
  out.docs.dir = docsRoot;
  out.docs.exists = !!docsReal;
  if (docsReal) {
    const collected = [];
    async function walk(cur, depth) {
      if (collected.length >= OPENCLAW_DOCS_MAX_FILES || depth > OPENCLAW_DOCS_MAX_DEPTH) return;
      let entries;
      try {
        entries = await fsp.readdir(cur, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (collected.length >= OPENCLAW_DOCS_MAX_FILES) break;
        const full = path.join(cur, ent.name);
        if (ent.isDirectory()) {
          await walk(full, depth + 1);
        } else {
          try {
            const st = await fsp.stat(full);
            const rel = path.relative(docsReal, full).replace(/\\/g, '/');
            collected.push({ path: rel, size: st.size, mtimeMs: st.mtimeMs });
          } catch {
            /* skip */
          }
        }
      }
    }
    try {
      await walk(docsReal, 0);
      out.docs.files = collected;
      out.docs.fileCount = collected.length;
      out.docs.capped = collected.length >= OPENCLAW_DOCS_MAX_FILES;
    } catch (e) {
      out.docs.error = String(e.message || e);
    }
  }

  const mediaDir = roots.mediaInbound;
  out.mediaInbound.dir = mediaDir;
  try {
    const medReal = safeRealRoot(mediaDir);
    if (medReal) {
      out.mediaInbound.exists = true;
      const entries = await fsp.readdir(medReal, { withFileTypes: true });
      let n = 0;
      const sample = [];
      for (const ent of entries) {
        if (ent.isFile()) n += 1;
        if (sample.length < 12 && ent.isFile()) sample.push(ent.name);
      }
      out.mediaInbound.fileCount = n;
      out.mediaInbound.sample = sample.sort();
    }
  } catch (e) {
    out.mediaInbound.error = String(e.message || e);
  }

  if (wsReal) {
    for (const sub of ['memory', 'logs', 'proyectos']) {
      const p = path.join(wsReal, sub);
      try {
        const st = await fsp.stat(p);
        out.workspaceSubdirs[sub] = {
          path: p,
          exists: st.isDirectory(),
          isDirectory: st.isDirectory(),
        };
        if (st.isDirectory()) {
          const ch = await fsp.readdir(p);
          out.workspaceSubdirs[sub].entryCount = ch.length;
        }
      } catch {
        out.workspaceSubdirs[sub] = { path: p, exists: false };
      }
    }
  }

  const wf = out.workspaceFiles;
  out.hasRealWorkspaceContent = Object.keys(wf).some((k) => wf[k] && wf[k].exists && wf[k].content);

  return out;
}

async function collectOpenClawFullSnapshot() {
  let installLayout = null;
  if (process.env.OPENCLAW_FS_DISABLE === '1') {
    installLayout = { disabled: true, message: 'OPENCLAW_FS_DISABLE=1' };
  } else {
    try {
      installLayout = await collectOpenClawInstallLayout();
    } catch (e) {
      installLayout = { error: String(e && e.message ? e.message : e), roots: {} };
    }
  }

  const av = checkOpenClawAvailable();

  if (process.env.OPENCLAW_SNAPSHOT_DISABLE === '1') {
    const d = new Date();
    const cronSystem = await collectCronPayload(d.getFullYear(), d.getMonth() + 1);
    return {
      at: Date.now(),
      available: av,
      binary: getOpenClawBin(),
      platform: process.platform,
      cronSystem,
      probes: {},
      disabled: true,
      message: 'OPENCLAW_SNAPSHOT_DISABLE=1',
      openclawFill: resolveOpenClawFillForSnapshot({}, installLayout, { available: av, mockMode: !av }),
      installLayout,
      suppressDemoFill: false,
    };
  }

  if (!av) {
    const d = new Date();
    const cronSystem = await collectCronPayload(d.getFullYear(), d.getMonth() + 1);
    const mockProbes = buildOpenClawMockProbes();
    return {
      at: Date.now(),
      available: false,
      mockMode: true,
      binary: getOpenClawBin(),
      platform: process.platform,
      probes: mockProbes,
      openclawFill: resolveOpenClawFillForSnapshot(mockProbes, installLayout, { available: false, mockMode: true }),
      cronSystem,
      installLayout,
      suppressDemoFill: false,
    };
  }

  const d = new Date();
  const [cronSystem, probeResults] = await Promise.all([
    collectCronPayload(d.getFullYear(), d.getMonth() + 1),
    Promise.all(
      OPENCLAW_CLI_PROBES.map(async (p) => {
        const cmdLine = `openclaw --no-color ${p.args.join(' ')}`;
        const r = await runOpenClawArgs(p.args, p.ms);
        return [p.key, { ...r, cmd: cmdLine }];
      }),
    ),
  ]);

  const probes = Object.fromEntries(probeResults);
  return {
    at: Date.now(),
    available: av,
    binary: getOpenClawBin(),
    platform: process.platform,
    cronSystem,
    probes,
    openclawFill: resolveOpenClawFillForSnapshot(probes, installLayout, { available: true, mockMode: false }),
    installLayout,
    suppressDemoFill: false,
  };
}

/**
 * Si el snapshot completo falla (timeout, bug, SO distinto…), devolvemos 200 + JSON usable
 * para que la página OpenClaw no rompa el panel en máquinas sin CLI o con rutas raras.
 */
async function collectOpenClawSnapshotOnFailure(err) {
  const d = new Date();
  let cronSystem = { jobs: [], dates: {}, hint: null, platform: process.platform };
  try {
    cronSystem = await collectCronPayload(d.getFullYear(), d.getMonth() + 1);
  } catch {
    /* ignorar */
  }
  const mockProbes = buildOpenClawMockProbes();
  const installLayout = { error: true, message: String(err && err.message ? err.message : err) };
  let openclawFill;
  try {
    openclawFill = resolveOpenClawFillForSnapshot(mockProbes, installLayout, {
      available: false,
      mockMode: true,
    });
  } catch {
    openclawFill = {};
  }
  return {
    at: Date.now(),
    available: false,
    degraded: true,
    mockMode: true,
    snapshotError: String(err && err.message ? err.message : err),
    binary: getOpenClawBin(),
    platform: process.platform,
    probes: mockProbes,
    cronSystem,
    openclawFill,
    installLayout,
    suppressDemoFill: true,
    message:
      'No se pudo completar el snapshot OpenClaw en el servidor; se muestra vista previa. OpenClaw es opcional: el resto de Bichipishi funciona sin el CLI.',
  };
}

/* ── Crontab real (usuario, /etc/crontab, CRON_EXTRA_FILE) ── */

const CRON_MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymdLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function inferCronKind(expr) {
  if (!expr) return 'custom';
  const p = expr.trim().split(/\s+/);
  if (p.length < 5) return 'custom';
  const [min, hour, dom, mon, dow] = p;
  if (dom === '*' && mon === '*' && dow === '*' && min !== '*' && hour !== '*') return 'daily';
  if (dom === '*' && mon === '*' && dow !== '*') return 'weekly';
  if (dom !== '*' && mon === '*' && dow === '*') return 'monthly';
  return 'custom';
}

function parseUserStyleCronLine(line, sourcePrefix, index) {
  const raw = line.trim();
  if (!raw || raw.startsWith('#')) return null;
  let schedule;
  let command;
  let expr;
  if (raw.startsWith('@')) {
    const sp = raw.indexOf(' ');
    const macro = sp === -1 ? raw : raw.slice(0, sp).trim();
    command = sp === -1 ? '' : raw.slice(sp + 1).trim();
    if (macro === '@reboot') {
      return {
        id: `${sourcePrefix}-reboot-${index}`,
        source: sourcePrefix,
        schedule: macro,
        command,
        kind: 'custom',
        user: null,
        line: raw,
        _expr: null,
      };
    }
    expr = CRON_MACROS[macro];
    if (!expr) return null;
    schedule = macro;
  } else {
    const m = raw.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!m) return null;
    schedule = `${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`;
    command = m[6].trim();
    expr = schedule;
  }
  return {
    id: `${sourcePrefix}-${index}`,
    source: sourcePrefix,
    schedule,
    command,
    kind: inferCronKind(expr),
    user: null,
    line: raw,
    _expr: expr,
  };
}

function parseEtcCrontabLine(line, index) {
  const raw = line.trim();
  if (!raw || raw.startsWith('#')) return null;
  if (/^(SHELL|PATH|MAILTO)=/i.test(raw)) return null;
  const m = raw.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
  if (!m) return null;
  const schedule = `${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`;
  const user = m[6];
  const command = m[7].trim();
  const expr = schedule;
  return {
    id: `system-${index}`,
    source: 'system',
    schedule,
    command,
    kind: inferCronKind(expr),
    user,
    line: raw,
    _expr: expr,
  };
}

function listUserCrontabLines() {
  if (process.platform === 'win32') return [];
  try {
    const out = execSync('crontab -l 2>/dev/null', {
      encoding: 'utf8',
      maxBuffer: 500_000,
      timeout: 5000,
      shell: true,
      windowsHide: true,
    });
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function listEtcCrontabLines() {
  if (process.platform === 'win32') return [];
  try {
    const p = '/etc/crontab';
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

/** Rutas relativas respecto a la raíz del repo (no al cwd), para que funcione con deploy/cron desde metrics-api/. */
function resolveCronExtraFilePath() {
  const raw = envTrim('CRON_EXTRA_FILE');
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.join(REPO_ROOT, raw);
  }
  const def = path.join(REPO_ROOT, 'config', 'cron.extra');
  return fs.existsSync(def) ? def : '';
}

function listExtraCronFileLines() {
  const p = resolveCronExtraFilePath();
  if (!p || !fs.existsSync(p)) return [];
  try {
    return fs.readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function resolveExtraCronWritePath() {
  const p = resolveCronExtraFilePath();
  if (p) return p;
  return path.join(REPO_ROOT, 'config', 'cron.extra');
}

function readExtraCronLinesForWrite() {
  const p = resolveExtraCronWritePath();
  if (!fs.existsSync(p)) return [];
  try {
    return fs.readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function writeExtraCronLines(lines) {
  const p = resolveExtraCronWritePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  return { ok: true };
}

function isSafeCronCommand(cmd) {
  const t = String(cmd || '').trim();
  if (!t || t.length > 4000) return false;
  return !/[\r\n\0]/.test(t);
}

function buildCronLineFromScheduleAndCommand(scheduleRaw, commandRaw) {
  const sch = String(scheduleRaw || '').trim();
  const cmd = String(commandRaw || '').trim();
  if (!sch || !cmd) return { ok: false, error: 'Programación y comando requeridos' };
  if (!isSafeCronCommand(cmd)) return { ok: false, error: 'Comando inválido' };
  if (sch.startsWith('@')) {
    if (sch === '@reboot') return { ok: true, line: `${sch} ${cmd}` };
    if (!CRON_MACROS[sch]) return { ok: false, error: 'Macro @ no reconocida' };
    const line = `${sch} ${cmd}`;
    if (!parseUserStyleCronLine(line, 'user', 0)) return { ok: false, error: 'Línea cron inválida' };
    return { ok: true, line };
  }
  const parts = sch.split(/\s+/);
  if (parts.length !== 5) return { ok: false, error: 'Usa 5 campos o una macro (@daily, @hourly, @reboot, …)' };
  const line = `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]} ${parts[4]} ${cmd}`;
  if (!parseUserStyleCronLine(line, 'user', 0)) return { ok: false, error: 'Línea cron inválida' };
  return { ok: true, line };
}

function writeUserCrontabLines(lines) {
  if (process.platform === 'win32') return { ok: false, error: 'No hay crontab de usuario en Windows' };
  const text = lines.length ? `${lines.map((l) => String(l).trimEnd()).join('\n')}\n` : '';
  try {
    const r = spawnSync('crontab', ['-'], {
      input: text,
      encoding: 'utf8',
      maxBuffer: 500_000,
      windowsHide: true,
    });
    if (r.error) return { ok: false, error: r.error.message || String(r.error) };
    if (r.status !== 0) {
      const msg = (r.stderr || r.stdout || '').trim() || `crontab terminó con código ${r.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function parseCronMutationId(idRaw) {
  const s = String(idRaw || '').trim();
  const rb = s.match(/^(user|extra)-reboot-(\d+)$/);
  if (rb) return { target: rb[1], lineIndex: Number(rb[2]), reboot: true };
  const m = s.match(/^(user|extra|system|windows)-(\d+)$/);
  if (!m || !Number.isFinite(Number(m[2]))) return null;
  return { target: m[1], lineIndex: Number(m[2]), reboot: false };
}

function getLinesForCronTarget(target) {
  if (target === 'user') return [...listUserCrontabLines()];
  if (target === 'extra') return readExtraCronLinesForWrite();
  if (target === 'system') {
    try {
      const p = '/etc/crontab';
      if (!fs.existsSync(p)) return [];
      return fs.readFileSync(p, 'utf8').split(/\r?\n/);
    } catch {
      return [];
    }
  }
  return null;
}

function writeLinesForCronTarget(target, lines) {
  if (target === 'user') return writeUserCrontabLines(lines);
  if (target === 'extra') return writeExtraCronLines(lines);
  if (target === 'system') {
    if (!BICHI_CRON_ALLOW_SYSTEM) {
      return { ok: false, error: 'Editar /etc/crontab requiere BICHI_CRON_ALLOW_SYSTEM=1 y permisos de escritura' };
    }
    try {
      const p = '/etc/crontab';
      fs.writeFileSync(p, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }
  return { ok: false, error: 'Destino no soportado' };
}

function cronDeleteLine(target, lineIndex) {
  const lines = getLinesForCronTarget(target);
  if (!lines) return { ok: false, error: 'Destino no soportado' };
  if (lineIndex < 0 || lineIndex >= lines.length) return { ok: false, error: 'Índice de línea inválido' };
  lines.splice(lineIndex, 1);
  return writeLinesForCronTarget(target, lines);
}

function cronReplaceLine(target, lineIndex, newLine) {
  const lines = getLinesForCronTarget(target);
  if (!lines) return { ok: false, error: 'Destino no soportado' };
  if (lineIndex < 0 || lineIndex >= lines.length) return { ok: false, error: 'Índice de línea inválido' };
  lines[lineIndex] = newLine;
  return writeLinesForCronTarget(target, lines);
}

function cronAppendLine(target, newLine) {
  const lines = getLinesForCronTarget(target);
  if (!lines) return { ok: false, error: 'Destino no soportado' };
  lines.push(newLine);
  return writeLinesForCronTarget(target, lines);
}

async function deleteWindowsCronTaskByIndex(idx) {
  windowsTasksCache = { at: 0, list: [] };
  const list = await fetchWindowsTasksRaw();
  const t = list[idx];
  if (!t) return { ok: false, error: 'Tarea de Windows no encontrada (índice)' };
  const tn = String(t.name || '').replace(/'/g, "''");
  const tp = String(t.path || '\\').replace(/'/g, "''");
  const cmd = `Unregister-ScheduledTask -TaskName '${tn}' -TaskPath '${tp}' -Confirm:$false`;
  try {
    await execFileAsync(
      getPowerShellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      { timeout: 25000, windowsHide: true, maxBuffer: 2_000_000 },
    );
    windowsTasksCache = { at: 0, list: [] };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function sanitizeWindowsTaskName(n) {
  return String(n || '')
    .replace(/[^\w\-. ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Ruta ejecutable única para schtasks /TR: si no parece .exe/.com, se envuelve en cmd.exe /c … */
function buildSchtasksTaskRun(command) {
  const t = String(command || '').trim();
  if (!t) return '';
  const firstTok = t.split(/\s+/)[0].replace(/^["']|["']$/g, '');
  if (/\.(exe|com)$/i.test(firstTok) && !/^cmd\.exe$/i.test(firstTok)) {
    return t;
  }
  if (/\.(bat|cmd)$/i.test(firstTok)) {
    return `cmd.exe /c ${t}`;
  }
  if (/^cmd\.exe\s/i.test(t)) return t;
  return `cmd.exe /c ${t}`;
}

function formatSchtasksSt(hour, minute) {
  const h = Math.min(23, Math.max(0, Number(hour) || 0));
  const m = Math.min(59, Math.max(0, Number(minute) || 0));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatSchtasksOnceDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

async function createWindowsCronTask(body) {
  const name = sanitizeWindowsTaskName(body.winTaskName || body.name);
  if (!name) return { ok: false, error: 'Nombre de tarea inválido' };
  const cmd = String(body.command || '').trim();
  if (!isSafeCronCommand(cmd)) return { ok: false, error: 'Comando inválido' };
  const tr = buildSchtasksTaskRun(cmd);
  if (!tr) return { ok: false, error: 'Comando vacío' };

  const mode = String(body.winSchedule || 'daily').toLowerCase();
  const hour = Math.min(23, Math.max(0, Number(body.dailyHour) || 9));
  const minute = Math.min(59, Math.max(0, Number(body.dailyMinute) || 0));
  const st = formatSchtasksSt(hour, minute);

  let args;
  if (mode === 'minute' || mode === 'test' || mode === 'everyminute') {
    /* Prueba: cada minuto (schtasks /SC MINUTE /MO 1) */
    args = ['/Create', '/TN', name, '/TR', tr, '/SC', 'MINUTE', '/MO', '1', '/F'];
  } else if (mode === 'once' || mode === 'one') {
    let runDay = new Date();
    const [hh, mm] = st.split(':').map((x) => Number(x));
    const at = new Date(runDay.getFullYear(), runDay.getMonth(), runDay.getDate(), hh, mm, 0, 0);
    if (at <= new Date()) {
      runDay = new Date(runDay.getTime() + 86400000);
    }
    const sd = formatSchtasksOnceDate(runDay);
    args = ['/Create', '/TN', name, '/TR', tr, '/SC', 'ONCE', '/SD', sd, '/ST', st, '/F'];
  } else {
    /* Diaria (por defecto) */
    args = ['/Create', '/TN', name, '/TR', tr, '/SC', 'DAILY', '/ST', st, '/F'];
  }

  const runLevel = String(process.env.BICHI_WIN_SCHTASKS_RL || '').toUpperCase();
  if (runLevel === 'HIGHEST' || runLevel === 'LIMITED') {
    args.push('/RL', runLevel);
  }

  try {
    const r = spawnSync('schtasks', args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 45000,
      maxBuffer: 2_000_000,
    });
    if (r.error) return { ok: false, error: r.error.message || String(r.error) };
    if (r.status !== 0) {
      const raw = `${r.stderr || ''}\n${r.stdout || ''}`.trim();
      const msg = raw || `schtasks terminó con código ${r.status}`;
      return { ok: false, error: msg };
    }
    windowsTasksCache = { at: 0, list: [] };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function mutateHostCronTask(body) {
  const op = String(body.op || '').toLowerCase();

  if (op === 'delete') {
    const parsed = parseCronMutationId(body.id);
    if (!parsed) return { ok: false, error: 'id inválido' };
    if (parsed.target === 'windows') {
      if (process.platform !== 'win32') return { ok: false, error: 'Tareas Windows solo en win32' };
      return deleteWindowsCronTaskByIndex(parsed.lineIndex);
    }
    if (parsed.target === 'system' && !BICHI_CRON_ALLOW_SYSTEM) {
      return { ok: false, error: 'No se puede borrar /etc/crontab sin BICHI_CRON_ALLOW_SYSTEM=1' };
    }
    if (parsed.target === 'user' && process.platform === 'win32') {
      return { ok: false, error: 'No hay crontab de usuario en Windows' };
    }
    return cronDeleteLine(parsed.target, parsed.lineIndex);
  }

  if (op === 'create') {
    const target = String(body.target || 'user').toLowerCase();
    if (target === 'windows') {
      if (process.platform !== 'win32') return { ok: false, error: 'Crear tarea Windows solo en win32' };
      return createWindowsCronTask(body);
    }
    const built = buildCronLineFromScheduleAndCommand(body.schedule, body.command);
    if (!built.ok) return built;
    if (target === 'user' && process.platform === 'win32') {
      return { ok: false, error: 'En Windows usa target "windows" o "extra" (archivo cron.extra)' };
    }
    if (target !== 'user' && target !== 'extra') {
      return { ok: false, error: "target debe ser 'user', 'extra' o 'windows'" };
    }
    return cronAppendLine(target, built.line);
  }

  if (op === 'update') {
    const parsed = parseCronMutationId(body.id);
    if (!parsed) return { ok: false, error: 'id inválido' };
    if (parsed.target === 'windows') {
      return { ok: false, error: 'Editar tareas Windows: elimina y crea de nuevo desde la UI' };
    }
    if (parsed.target === 'system' && !BICHI_CRON_ALLOW_SYSTEM) {
      return { ok: false, error: 'Editar /etc/crontab requiere BICHI_CRON_ALLOW_SYSTEM=1' };
    }
    if (parsed.target === 'user' && process.platform === 'win32') {
      return { ok: false, error: 'No hay crontab de usuario en Windows' };
    }
    const built = buildCronLineFromScheduleAndCommand(body.schedule, body.command);
    if (!built.ok) return built;
    return cronReplaceLine(parsed.target, parsed.lineIndex, built.line);
  }

  return { ok: false, error: "op debe ser 'create', 'update' o 'delete'" };
}

function occurrencesForMonth(expr, year, month1to12) {
  if (!expr) return [];
  const m0 = month1to12 - 1;
  const start = new Date(year, m0, 1, 0, 0, 0, 0);
  const end = new Date(year, m0 + 1, 0, 23, 59, 59, 999);
  const out = new Set();
  /* Hasta ~31×24×60 disparos/mes (cada minuto); 400 cortaba @hourly a ~16 días. */
  const maxSteps = Math.min(120_000, Math.max(5000, end.getDate() * 24 * 60 + 500));
  try {
    const interval = cronParser.parseExpression(expr, { currentDate: start });
    let n = 0;
    while (n++ < maxSteps) {
      const step = interval.next();
      const cronDate = step && typeof step.toDate === 'function' ? step : step && step.value;
      if (!cronDate || typeof cronDate.toDate !== 'function') break;
      const d = cronDate.toDate();
      if (d > end) break;
      if (d >= start) out.add(ymdLocal(d));
    }
  } catch {
    /* expresión inválida para cron-parser */
  }
  return [...out];
}

/** Ruta estable a PowerShell (evita fallos si PATH no incluye System32). */
function getPowerShellPath() {
  const root = process.env.SystemRoot || process.env.windir;
  if (root) {
    const full = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(full)) return full;
  }
  return 'powershell.exe';
}

function decodePsStdout(buf) {
  if (!buf || !buf.length) return '';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le').trim();
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '').trim();
}

function parseJsonRelaxed(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* continuar */
  }
  const arr = text.match(/\[[\s\S]*\]/);
  if (arr) {
    try {
      return JSON.parse(arr[0]);
    } catch {
      /* */
    }
  }
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch {
      /* */
    }
  }
  return null;
}

let windowsTasksCache = { at: 0, list: [] };
const WINDOWS_TASKS_CACHE_MS = Number.parseInt(process.env.WINDOWS_TASKS_CACHE_MS || '45000', 10) || 45000;

/** Tareas programadas de Windows — asíncrono para no bloquear /api/metrics (execFileSync congelaba todo el servidor). */
async function fetchWindowsTasksRaw() {
  if (process.platform !== 'win32') return [];
  if (process.env.WINDOWS_TASKS_DISABLE === '1') return [];
  if (
    windowsTasksCache.at > 0 &&
    Date.now() - windowsTasksCache.at < WINDOWS_TASKS_CACHE_MS
  ) {
    return windowsTasksCache.list;
  }
  const scriptPath = path.join(__dirname, 'win-scheduled-tasks.ps1');
  if (!fs.existsSync(scriptPath)) {
    windowsTasksCache = { at: Date.now(), list: [] };
    return [];
  }
  try {
    const { stdout } = await execFileAsync(
      getPowerShellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        timeout: 25000,
        maxBuffer: 20_000_000,
        windowsHide: true,
      },
    );
    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout || ''), 'utf8');
    const out = decodePsStdout(buf);
    if (!out) {
      windowsTasksCache = { at: Date.now(), list: [] };
      return [];
    }
    const data = parseJsonRelaxed(out);
    if (data === null || data === undefined) {
      windowsTasksCache = { at: Date.now(), list: [] };
      return [];
    }
    const list = Array.isArray(data) ? data.filter(Boolean) : [data].filter(Boolean);
    windowsTasksCache = { at: Date.now(), list };
    return list;
  } catch {
    windowsTasksCache = { at: Date.now(), list: [] };
    return [];
  }
}

function mapWinPatternToKind(p) {
  if (p === 'daily') return 'daily';
  if (p === 'weekly') return 'weekly';
  if (p === 'monthly') return 'monthly';
  return 'custom';
}

function expandWindowsTaskDates(pattern, nextRunIso, year, month1to12) {
  const m0 = month1to12 - 1;
  const start = new Date(year, m0, 1, 0, 0, 0, 0);
  const end = new Date(year, m0 + 1, 0, 23, 59, 59, 999);
  const out = new Set();
  const next = nextRunIso ? new Date(nextRunIso) : null;

  if (pattern === 'daily') {
    const lastDom = end.getDate();
    for (let day = 1; day <= lastDom; day++) {
      out.add(ymdLocal(new Date(year, m0, day)));
    }
    return [...out];
  }

  if (pattern === 'weekly' && next && !Number.isNaN(next.getTime())) {
    const t = new Date(next.getTime());
    while (t > start) t.setDate(t.getDate() - 7);
    while (t < start) t.setDate(t.getDate() + 7);
    while (t <= end) {
      if (t >= start) out.add(ymdLocal(t));
      t.setDate(t.getDate() + 7);
    }
    return [...out];
  }

  if (pattern === 'monthly' && next && !Number.isNaN(next.getTime())) {
    const dom = next.getDate();
    const hit = new Date(year, m0, dom, 12, 0, 0, 0);
    if (hit >= start && hit <= end && hit.getMonth() === m0) out.add(ymdLocal(hit));
    return [...out];
  }

  if (next && !Number.isNaN(next.getTime()) && next >= start && next <= end) {
    out.add(ymdLocal(next));
  }
  return [...out];
}

function pushDatesForJob(dates, jobId, list) {
  for (const ds of list) {
    if (!dates[ds]) dates[ds] = [];
    if (!dates[ds].includes(jobId)) dates[ds].push(jobId);
  }
}

async function collectCronPayload(year, month) {
  const jobs = [];
  let u = 0;
  for (const line of listUserCrontabLines()) {
    const j = parseUserStyleCronLine(line, 'user', u++);
    if (j) jobs.push(j);
  }
  let s = 0;
  for (const line of listEtcCrontabLines()) {
    const j = parseEtcCrontabLine(line, s++);
    if (j) jobs.push(j);
  }
  let e = 0;
  for (const line of listExtraCronFileLines()) {
    const j = parseUserStyleCronLine(line, 'extra', e++);
    if (j) jobs.push(j);
  }

  const winRaw = await fetchWindowsTasksRaw();
  let w = 0;
  for (const t of winRaw) {
    const taskPath = (t.path || '').toString();
    const taskName = (t.name || '').toString();
    const fullPath = `${taskPath}${taskName}`;
    const pattern = (t.pattern || 'custom').toString().toLowerCase();
    jobs.push({
      id: `windows-${w++}`,
      source: 'windows',
      schedule: `${fullPath} · ${pattern}`,
      command: (t.command || '—').toString().slice(0, 2000),
      kind: mapWinPatternToKind(pattern),
      user: null,
      line: fullPath,
      winPath: (t.path || '').toString(),
      winName: (t.name || '').toString(),
      _expr: null,
      _winPattern: pattern,
      _winNextRun: t.nextRun || null,
    });
  }

  const dates = {};
  for (const job of jobs) {
    if (job._expr) {
      pushDatesForJob(dates, job.id, occurrencesForMonth(job._expr, year, month));
    } else if (job._winPattern) {
      pushDatesForJob(
        dates,
        job.id,
        expandWindowsTaskDates(job._winPattern, job._winNextRun, year, month),
      );
    }
  }

  const publicJobs = jobs.map(({ _expr, _winPattern, _winNextRun, ...pub }) => pub);

  let hint = null;
  if (!publicJobs.length) {
    hint =
      process.platform === 'win32'
        ? 'Sin entradas: sin tareas programadas visibles (prueba WINDOWS_TASKS_ALL=1), sin CRON_EXTRA_FILE, o PowerShell bloqueado.'
        : 'Sin entradas: crontab -l vacío, /etc/crontab ilegible o sin CRON_EXTRA_FILE. En Docker monta un fichero o ejecuta la API en el host.';
  }

  return { jobs: publicJobs, dates, hint, platform: process.platform };
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function assertSettingsWrite(req, res) {
  if (SETTINGS_WRITE_DISABLED) {
    json(res, 403, { error: 'Escritura de ajustes desactivada en este servidor.' });
    return false;
  }
  if (!SETTINGS_WRITE_TOKEN) return true;
  const auth = String(req.headers.authorization || '');
  const x = String(req.headers['x-bichi-token'] || '');
  if (auth === `Bearer ${SETTINGS_WRITE_TOKEN}` || x === SETTINGS_WRITE_TOKEN) return true;
  json(res, 401, { error: 'Token inválido o ausente para modificar ajustes.' });
  return false;
}

function serveStatic(req, res) {
  const raw = req.url.split('?')[0] || '/';
  let pathname = raw.replace(/\/+$/, '') || '/';
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (pathname.includes('\0') || pathname.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
  };

  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (path.isAbsolute(rel) || rel.startsWith(path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const candidates = [
    path.join(DIST_DIR, rel),
    path.join(DIST_DIR, rel, 'index.html'),
    path.join(DIST_DIR, `${rel}.html`),
  ];

  function fallbackIndexHtml() {
    fs.readFile(path.join(DIST_DIR, 'index.html'), (err2, data2) => {
      if (err2) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      }
    });
  }

  let i = 0;
  function tryNext() {
    if (i >= candidates.length) {
      fallbackIndexHtml();
      return;
    }
    const p = path.normalize(candidates[i++]);
    if (!p.startsWith(DIST_DIR)) {
      tryNext();
      return;
    }
    fs.readFile(p, (err, data) => {
      if (err) {
        tryNext();
        return;
      }
      const ext = path.extname(p);
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      });
      res.end(data);
    });
  }
  tryNext();
}

function serveApi(req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const pathname = (u.pathname.replace(/\/+$/, '') || '/');

  if (pathname === '/api/settings' && req.method === 'GET') {
    const merged = mergeWithDefaults(loadUserSettingsRaw());
    json(res, 200, sanitizeSettingsForResponse(merged));
    return;
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    if (!assertSettingsWrite(req, res)) return;
    readBody(req)
      .then((raw) => {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          json(res, 400, { error: 'JSON inválido' });
          return;
        }
        if (!body || typeof body !== 'object') {
          json(res, 400, { error: 'Cuerpo inválido' });
          return;
        }
        const next = applyPartialSettings(loadUserSettingsRaw(), body);
        saveUserSettings(next);
        let envSynced = false;
        try {
          writeBichiUiEnvBlock(next);
          envSynced = true;
        } catch (e) {
          console.error('[bichi] sincronizar .env:', e && e.message ? e.message : e);
        }
        const meta = restartMetaForSettingsResponse();
        attachRestartAfterSettingsSave(res);
        json(res, 200, {
          ok: true,
          settings: sanitizeSettingsForResponse(next),
          envSynced,
          ...meta,
        });
      })
      .catch((e) => json(res, 400, { error: String(e && e.message ? e.message : e) }));
    return;
  }

  if (pathname === '/api/settings/test-mail' && req.method === 'POST') {
    if (!assertSettingsWrite(req, res)) return;
    readBody(req)
      .then(() => {
        const merged = mergeWithDefaults(loadUserSettingsRaw());
        return sendTestMail(merged).then(() => json(res, 200, { ok: true }));
      })
      .catch((e) =>
        json(res, 500, { error: String(e && e.message ? e.message : e) }),
      );
    return;
  }

  if (pathname === '/api/metrics') {
    const METRICS_MAX_MS = Number.parseInt(String(process.env.BICHI_METRICS_MAX_MS || '75000'), 10) || 75000;
    Promise.race([
      collectMetrics(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('METRICS_DEADLINE')), METRICS_MAX_MS),
      ),
    ])
      .then((data) => json(res, 200, data))
      .catch((err) => {
        const msg = String(err && err.message ? err.message : err);
        if (msg === 'METRICS_DEADLINE') {
          console.error('[bichi] /api/metrics: tiempo máximo excedido (' + METRICS_MAX_MS + ' ms)');
          json(res, 503, {
            error: 'La recolección de métricas excedió el tiempo máximo',
            code: 'METRICS_TIMEOUT',
          });
          return;
        }
        json(res, 500, { error: msg });
      });
    return;
  }

  if (pathname === '/api/perf/daily' && req.method === 'GET') {
    try {
      const n = Number.parseInt(u.searchParams.get('days') || '90', 10);
      json(res, 200, queryPerfDailyJson(DATA_DIR, n));
    } catch (err) {
      json(res, 500, { error: String(err && err.message ? err.message : err) });
    }
    return;
  }

  if (pathname === '/api/openclaw' && req.method === 'GET') {
    collectOpenClawFullSnapshot()
      .then((data) => json(res, 200, data))
      .catch((err) => {
        console.warn('[bichi] /api/openclaw snapshot:', err && err.message ? err.message : err);
        collectOpenClawSnapshotOnFailure(err)
          .then((data) => json(res, 200, data))
          .catch((e2) => {
            console.warn('[bichi] /api/openclaw degraded:', e2);
            json(res, 200, {
              at: Date.now(),
              available: false,
              degraded: true,
              mockMode: true,
              message:
                'OpenClaw es opcional. Sin CLI en PATH, esta página muestra vista previa; define OPENCLAW_BIN o OPENCLAW_FORCE=0.',
              cronSystem: { jobs: [], dates: {}, hint: null, platform: process.platform },
              probes: buildOpenClawMockProbes(),
            });
          });
      });
    return;
  }

  if (pathname === '/api/logs') {
    const stream = u.searchParams.get('stream') || 'system';
    if (stream === 'custom') {
      const cid = u.searchParams.get('id') || '';
      json(res, 200, collectCustomLog(cid));
      return;
    }
    const payload = stream === 'openclaw' ? collectOpenclawLogs() : collectSystemLogs();
    json(res, 200, payload);
    return;
  }

  if (pathname === '/api/cron') {
    const y = Number.parseInt(u.searchParams.get('year') || String(new Date().getFullYear()), 10);
    const mo = Number.parseInt(u.searchParams.get('month') || String(new Date().getMonth() + 1), 10);
    const year = Number.isFinite(y) ? y : new Date().getFullYear();
    const month = Math.min(12, Math.max(1, Number.isFinite(mo) ? mo : 1));
    collectCronPayload(year, month)
      .then((payload) => json(res, 200, payload))
      .catch((err) =>
        json(res, 500, { error: String(err && err.message ? err.message : err) }),
      );
    return;
  }

  // ── Host: procesos (señales) y servicios ──────────────────────────────────

  if (pathname === '/api/host/process/signal' && req.method === 'POST') {
    if (!assertHostActionAuth(req, res)) return;
    readBody(req, 4096)
      .then((raw) => {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          json(res, 400, { ok: false, error: 'JSON inválido' });
          return;
        }
        const signal = String(body.signal || 'term').toLowerCase();
        if (signal !== 'term' && signal !== 'kill') {
          json(res, 400, { ok: false, error: "signal debe ser 'term' o 'kill'" });
          return;
        }
        const r = runProcessSignal(body.pid, signal);
        json(res, r.ok ? 200 : 400, r);
      })
      .catch((e) => json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) }));
    return;
  }

  if (pathname === '/api/host/service/action' && req.method === 'POST') {
    if (!assertHostActionAuth(req, res)) return;
    readBody(req, 4096)
      .then(async (raw) => {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          json(res, 400, { ok: false, error: 'JSON inválido' });
          return;
        }
        const name = body && body.name != null ? String(body.name).trim() : '';
        const action = String(body.action || '').toLowerCase();
        if (!name) {
          json(res, 400, { ok: false, error: 'name requerido' });
          return;
        }
        if (!['stop', 'start', 'restart'].includes(action)) {
          json(res, 400, { ok: false, error: "action debe ser 'stop', 'start' o 'restart'" });
          return;
        }
        const r = await runServiceHostAction(name, action);
        json(res, r.ok ? 200 : 400, r);
      })
      .catch((e) => json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) }));
    return;
  }

  if (pathname === '/api/host/cron/task' && req.method === 'POST') {
    if (!assertHostActionAuth(req, res)) return;
    readBody(req, 96 * 1024)
      .then(async (raw) => {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          json(res, 400, { ok: false, error: 'JSON inválido' });
          return;
        }
        try {
          const r = await mutateHostCronTask(body);
          json(res, r.ok ? 200 : 400, r);
        } catch (e) {
          json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
        }
      })
      .catch((e) => json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) }));
    return;
  }

  // ── Docker container actions ──────────────────────────────────────────────

  if (/\/api\/docker\/ctnr\/(start|stop|restart|delete)$/.test(pathname) && req.method === 'POST') {
    const action = pathname.replace(/^\/api\/docker\/ctnr\//, '');
    readBody(req, 4096)
      .then((raw) => {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          json(res, 400, { ok: false, error: 'JSON inválido' });
          return;
        }
        const name = body && body.name ? String(body.name).trim() : '';
        if (!name) {
          json(res, 400, { ok: false, error: 'Nombre de contenedor requerido' });
          return;
        }
        const argMap = {
          start: ['start', name],
          stop: ['stop', name],
          restart: ['restart', name],
          delete: ['rm', '-f', name],
        };
        const dockerArgs = argMap[action];
        if (!dockerArgs) {
          json(res, 400, { ok: false, error: 'Acción desconocida' });
          return;
        }
        const dockerBin = String(process.env.DOCKER_BIN || 'docker').trim() || 'docker';
        const r = spawnSync(dockerBin, dockerArgs, {
          encoding: 'utf8',
          stdio: 'pipe',
          shell: false,
          env: process.env,
          maxBuffer: 2 * 1024 * 1024,
        });
        if (r.error) {
          json(res, 400, { ok: false, error: r.error.message || String(r.error) });
          return;
        }
        if (r.status !== 0) {
          const msg = (r.stderr || r.stdout || '').trim() || `docker terminó con código ${r.status}`;
          json(res, 400, { ok: false, error: msg });
          return;
        }
        json(res, 200, { ok: true, action, name });
      })
      .catch((e) => json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) }));
    return;
  }

  function runDockerSpawn(args) {
    const dockerBin = String(process.env.DOCKER_BIN || 'docker').trim() || 'docker';
    return spawnSync(dockerBin, args, {
      encoding: 'utf8',
      stdio: 'pipe',
      shell: false,
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
    });
  }

  if (pathname === '/api/docker/img/delete' && req.method === 'POST') {
    readBody(req, 4096)
      .then((raw) => {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          json(res, 400, { ok: false, error: 'JSON inválido' });
          return;
        }
        const id = body && body.id ? String(body.id).trim() : '';
        if (!id || id === '—') {
          json(res, 400, { ok: false, error: 'ID de imagen requerido' });
          return;
        }
        const r = runDockerSpawn(['rmi', '-f', id]);
        if (r.error) {
          json(res, 400, { ok: false, error: r.error.message || String(r.error) });
          return;
        }
        if (r.status !== 0) {
          const msg = (r.stderr || r.stdout || '').trim() || `docker rmi terminó con código ${r.status}`;
          json(res, 400, { ok: false, error: msg });
          return;
        }
        json(res, 200, { ok: true, id });
      })
      .catch((e) => json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) }));
    return;
  }

  if (pathname === '/api/docker/vol/delete' && req.method === 'POST') {
    readBody(req, 4096)
      .then((raw) => {
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          json(res, 400, { ok: false, error: 'JSON inválido' });
          return;
        }
        const volName = body && body.name ? String(body.name).trim() : '';
        if (!volName || volName === '—') {
          json(res, 400, { ok: false, error: 'Nombre de volumen requerido' });
          return;
        }
        const r = runDockerSpawn(['volume', 'rm', volName]);
        if (r.error) {
          json(res, 400, { ok: false, error: r.error.message || String(r.error) });
          return;
        }
        if (r.status !== 0) {
          const msg = (r.stderr || r.stdout || '').trim() || `docker volume rm terminó con código ${r.status}`;
          json(res, 400, { ok: false, error: msg });
          return;
        }
        json(res, 200, { ok: true, name: volName });
      })
      .catch((e) => json(res, 400, { ok: false, error: String(e && e.message ? e.message : e) }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.url.startsWith('/api')) {
    serveApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `\nPuerto ${PORT} en uso. Cierra el otro proceso (p. ej. otra metrics-api) o usa otro puerto:\n` +
        `  BICHI_API_PORT=3002 bun run dev\n` +
        `  macOS/Linux: lsof -i :${PORT}  →  kill <PID>\n` +
        `  Windows: netstat -ano | findstr :${PORT}  →  taskkill /PID <pid> /F\n`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', () => {
  const distOk = fs.existsSync(path.join(DIST_DIR, 'index.html'));
  console.log(`API ${APP_DISPLAY_NAME}  http://127.0.0.1:${PORT}/`);
  if (PUBLIC_HOST_HINT) {
    console.log(`  (también http://${PUBLIC_HOST_HINT}/ si está en hosts — BICHI_PUBLIC_HOST en .env)`);
  }
  console.log(`  Web estática: ${DIST_DIR}${distOk ? '' : ' (ejecuta bun run build:astro antes)'}`);
  console.log(`  Datos: ${DATA_DIR}`);
  console.log(
    `  API: /api/metrics · /api/host/process/signal · /api/host/service/action · /api/host/cron/task · /api/docker/ctnr/* · /api/docker/img/delete · /api/docker/vol/delete · /api/openclaw · /api/logs · /api/cron · /api/settings · /api/perf/daily`,
  );
  console.log(`  CORS: ${CORS_ORIGIN} (producción: BICHI_CORS_ORIGIN)`);
  if (SETTINGS_WRITE_DISABLED) console.log('  Ajustes POST: desactivados (BICHI_DISABLE_SETTINGS_WRITE=1)');
  else if (SETTINGS_WRITE_TOKEN) console.log('  Ajustes POST: requieren BICHI_SETTINGS_TOKEN');
});

module.exports = server;
