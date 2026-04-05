const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const os = require('os');
const { promisify } = require('util');
const { spawnSync, execSync, execFile } = require('child_process');
const execFileAsync = promisify(execFile);
const si = require('systeminformation');
const cronParser = require('cron-parser');
const { recordPerfDailySample, queryPerfDailyJson } = require('./perf-db');

const PORT = Number.parseInt(process.env.BICHI_API_PORT || process.env.PORT || '3001', 10) || 3001;
/** Nombre de la app (UI, correos, textos). En Docker: misma variable que PUBLIC_BICHI_APP_NAME en compose. */
const APP_DISPLAY_NAME = String(process.env.BICHI_APP_NAME || '').trim() || 'Bichipishi';
/** Procesos devueltos en `topCpu` (ordenados por % CPU); el total real va en `processCountTotal`. */
const TOP_CPU_PROCESSES = 48;
/** Origen permitido CORS (ej. https://tudominio.pages.dev). Por defecto * (solo recomendado en LAN/dev). */
const CORS_ORIGIN = String(process.env.BICHI_CORS_ORIGIN || '*').trim() || '*';
/** Si es 1, no se aceptan POST de ajustes ni prueba de correo (API expuesta a Internet sin token). */
const SETTINGS_WRITE_DISABLED = process.env.BICHI_DISABLE_SETTINGS_WRITE === '1';
/** Si está definido, POST /api/settings y test-mail exigen Authorization: Bearer <token> o cabecera X-Bichi-Token. */
const SETTINGS_WRITE_TOKEN = String(process.env.BICHI_SETTINGS_TOKEN || '').trim();
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
const DIST_DIR = process.env.DIST_DIR || path.join(__dirname, '..', 'dist');
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

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

const DEFAULT_SETTINGS = {
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

function mergeWithDefaults(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(r.thresholds || {}) },
    alerts: { ...DEFAULT_SETTINGS.alerts, ...(r.alerts || {}) },
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
  return merged;
}

function sanitizeSettingsForResponse(merged) {
  const a = { ...merged.alerts };
  a.smtpPass = merged.alerts.smtpPass ? '********' : '';
  return { thresholds: merged.thresholds, alerts: a };
}

function saveUserSettings(merged) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
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
  'ssh',
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
  'avahi-daemon',
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
  'firewalld',
  'ufw',
  'NetworkManager',
  'systemd',
  'launchd',
  'dbus-daemon',
  'polkitd',
  'snapd',
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
  if (platform === 'darwin' || platform === 'freebsd' || platform === 'openbsd' || platform === 'netbsd') {
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
  const bin = String(process.env.OPENCLAW_BIN || process.env.OPENCLAW_BINARY || 'openclaw').trim() || 'openclaw';
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
  const root = usable.find((f) => f.mount === '/' || /^[A-Za-z]:$/.test(String(f.mount).replace(/\\/g, '')));
  if (root) return root;
  return usable.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
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
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    let req;
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
  try {
    const j = JSON.parse(
      execSync('hostnamectl --json', { encoding: 'utf8', maxBuffer: 64 * 1024, env: SUBPROC_C_LOCALE }),
    );
    const pretty = String(j?.StaticHostname || j?.Hostname || '').trim();
    if (pretty && pretty !== '(none)') return pretty;
  } catch {
    /* ignore */
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
  ] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.osInfo(),
    si.cpu(),
    si.processes().catch(() => ({ list: [] })),
    si.services(monitoredServicesSpecifier()).catch(() => []),
    timed(si.dockerContainers(true), 8000, []),
    loadDockerImagesForMetrics(),
    loadDockerVolumesForMetrics(),
    si.networkInterfaces().catch(() => []),
    fetchPublicIpv4().catch(() => ''),
  ]);

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

  const mainFs = pickMainFs(fsSize);
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
    .map((p) => ({
      comm: (p.name || p.command || '?').toString().split(/[\s\\/]/).pop() || '?',
      desc: '',
      pid: p.pid,
      cmd: (p.command || p.path || p.name || '').toString(),
      cpu: Math.round((Number(p.cpu) || 0) * 10) / 10,
      mem: Math.round((Number(p.mem) || 0) * 10) / 10,
    }));

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

  const dockerImagesSafe = Array.isArray(dockerImages) ? dockerImages : [];
  const dockerVolumesSafe = Array.isArray(dockerVolumes) ? dockerVolumes : [];
  const dockerImagesTotalBytes = dockerImagesSafe.reduce((s, im) => s + (im.size || 0), 0);

  let hostOsLabel = formatHostOsLabel(osInfo);
  let uptimeOut = Math.floor(os.uptime());
  let hostMetricsNote = '';
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
    if (!hasHostId || !hasOsId) {
      hostMetricsNote =
        'API en Docker: equipo y SO suelen ser del contenedor. Rellena BICHI_HOST_HOSTNAME y BICHI_HOST_OS en .env, o en Linux monta /host/etc/hostname y /host/etc/os-release. RAM: BICHI_MEM_TOTAL_GIB. Ver README.';
    }
  }

  const userSettings = mergeWithDefaults(loadUserSettingsRaw());
  const { warnings, alerts } = buildThresholdAlerts(
    deviceName || hostname,
    memPct,
    diskPct,
    cpuPct,
    mem,
    mainFs,
    userSettings.thresholds,
  );

  const mailP = maybeSendThresholdEmails(alerts, userSettings);
  if (mailP && typeof mailP.catch === 'function') {
    mailP.catch((e) => console.error('[bichi] alert mail:', e && e.message ? e.message : e));
  }

  try {
    recordPerfDailySample(DATA_DIR, cpuPct, memPct, diskPct);
  } catch (e) {
    console.error('[bichi] perf sqlite:', e && e.message ? e.message : e);
  }

  return {
    platform: process.platform,
    cpu: cpuPct,
    mem: memPct,
    disk: diskPct,
    memUsed: bytesToGiBUsedOneDec(mem.used || 0),
    memTotal: bytesToGiBTotalInt(mem.total || 0),
    memNote: memMacActivityMonitor
      ? 'macOS: “Memoria usada” aproximada como Monitor de actividad (vm_stat: activas + cableadas + comprimidas; GiB = 1024³).'
      : '',
    diskUsed: mainFs ? bytesToGiBUsedOneDec(mainFs.used || 0) : 0,
    diskTotal: mainFs ? bytesToGiBTotalInt(mainFs.size || 0) : 0,
    hostOs: hostOsLabel,
    hostname,
    deviceName,
    hostMetricsNote,
    hostIpv4,
    publicIp: String(publicIp || '').trim(),
    processCountTotal,
    cpuModel: cpuBrand,
    cpuCores: cores,
    load,
    uptime: uptimeOut,
    timestamp: Date.now(),
    topCpu,
    services,
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
  return 'Sin LOG_FILE: en Linux usa journald, instala journalctl en el contenedor o monta un archivo de log (véase docker-compose).';
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

/* ── OpenClaw: snapshot completo (CLI) + cron del host ── */

function getOpenClawBin() {
  const b = process.env.OPENCLAW_BIN || process.env.OPENCLAW_BINARY || 'openclaw';
  const s = String(b || 'openclaw').trim();
  return s || 'openclaw';
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

/** Relleno de interfaz: personalidad, agentes de ejemplo, etc. (OPENCLAW_DEMO_FILL=0 para omitir). */
function getOpenClawDemoFill() {
  if (process.env.OPENCLAW_DEMO_FILL === '0') return null;
  return {
    note: 'Bloque ilustrativo para la UI (personalidad, voz, agentes de ejemplo). Sustituye o complementa lo que devuelva el CLI.',
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
  };
}

async function collectOpenClawFullSnapshot() {
  const fill = getOpenClawDemoFill();
  if (process.env.OPENCLAW_SNAPSHOT_DISABLE === '1') {
    const d = new Date();
    const cronSystem = await collectCronPayload(d.getFullYear(), d.getMonth() + 1);
    return {
      at: Date.now(),
      available: checkOpenClawAvailable(),
      binary: getOpenClawBin(),
      platform: process.platform,
      cronSystem,
      probes: {},
      disabled: true,
      message: 'OPENCLAW_SNAPSHOT_DISABLE=1',
      openclawFill: fill,
    };
  }

  if (!checkOpenClawAvailable()) {
    return {
      at: Date.now(),
      available: false,
      binary: getOpenClawBin(),
      platform: process.platform,
      probes: {},
      openclawFill: null,
      cronSystem: { jobs: [], hint: '' },
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
    available: checkOpenClawAvailable(),
    binary: getOpenClawBin(),
    platform: process.platform,
    cronSystem,
    probes,
    openclawFill: fill,
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

function listExtraCronFileLines() {
  const p = process.env.CRON_EXTRA_FILE;
  if (!p || !fs.existsSync(p)) return [];
  try {
    return fs.readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function occurrencesForMonth(expr, year, month1to12) {
  if (!expr) return [];
  const m0 = month1to12 - 1;
  const start = new Date(year, m0, 1, 0, 0, 0, 0);
  const end = new Date(year, m0 + 1, 0, 23, 59, 59, 999);
  const out = new Set();
  try {
    const interval = cronParser.parseExpression(expr, { currentDate: start });
    let n = 0;
    while (n++ < 400) {
      const next = interval.next();
      const d = next.toDate();
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
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';

  const fullPath = path.join(DIST_DIR, filePath);
  const distPath = path.join(DIST_DIR, req.url.split('?')[0]);

  const safePath = distPath.startsWith(DIST_DIR) ? distPath : fullPath;

  const ext = path.extname(safePath);
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

  fs.readFile(safePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST_DIR, 'index.html'), (err2, data2) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data2);
        }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
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
        json(res, 200, { ok: true, settings: sanitizeSettingsForResponse(next) });
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
    collectMetrics()
      .then((data) => json(res, 200, data))
      .catch((err) => json(res, 500, { error: String(err && err.message ? err.message : err) }));
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
      .catch((err) => json(res, 500, { error: String(err && err.message ? err.message : err) }));
    return;
  }

  if (pathname === '/api/logs') {
    const stream = u.searchParams.get('stream') || 'system';
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
        `  BICHI_API_PORT=3002 pnpm run dev\n` +
        `  macOS/Linux: lsof -i :${PORT}  →  kill <PID>\n`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Métricas API http://0.0.0.0:${PORT}`);
  console.log(
    `  GET /api/metrics  GET /api/openclaw  GET /api/logs  GET /api/cron?year=&month=  GET|POST /api/settings  POST /api/settings/test-mail`,
  );
  console.log(`  CORS Access-Control-Allow-Origin: ${CORS_ORIGIN} (ajusta BICHI_CORS_ORIGIN en producción)`);
  if (SETTINGS_WRITE_DISABLED) console.log('  Escritura de ajustes: DESACTIVADA (BICHI_DISABLE_SETTINGS_WRITE=1)');
  else if (SETTINGS_WRITE_TOKEN) console.log('  Escritura de ajustes: requiere BICHI_SETTINGS_TOKEN');
});

module.exports = server;
