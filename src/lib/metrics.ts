/**
 * Shared client-side utilities for metrics, theme, and header updates.
 * Imported by page scripts via Astro's <script> bundling.
 */

export function statusColor(v: number, type: 'cpu' | 'mem' | 'disk' | 'gpu' = 'cpu'): string {
  const t =
    type === 'mem'
      ? { warn: 70, crit: 90 }
      : type === 'disk'
        ? { warn: 80, crit: 95 }
        : { warn: 60, crit: 85 };
  if (v >= t.crit) return '#fb7185';
  if (v >= t.warn) return '#facc15';
  return '#4ade80';
}

export function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Uptime del host en segundos (p. ej. `os.uptime()`); si no es un número finito ≥ 0, no hay dato fiable. */
export function hasValidSystemUptime(seconds: unknown): boolean {
  const n = Number(seconds);
  return Number.isFinite(n) && n >= 0;
}

export type HealthLevel = 'ok' | 'warn' | 'crit';

/** false cuando la API va en Docker sin BICHI_HOST_* (no representa el PC del usuario). */
export function metricsRepresentHost(data: unknown): boolean {
  return !(data && typeof data === 'object' && (data as { metricsRepresentHost?: boolean }).metricsRepresentHost === false);
}

export function healthLevel(cpu: number, mem: number, disk: number): HealthLevel {
  const worst = Math.max(
    cpu >= 85 ? 2 : cpu >= 60 ? 1 : 0,
    mem >= 90 ? 2 : mem >= 70 ? 1 : 0,
    disk >= 95 ? 2 : disk >= 80 ? 1 : 0,
  );
  return worst === 2 ? 'crit' : worst === 1 ? 'warn' : 'ok';
}

export async function fetchMetrics(): Promise<any> {
  const r = await apiFetch('/api/metrics');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function defaultEmailSubjectPrefix(): string {
  const n = String(import.meta.env.PUBLIC_BICHI_APP_NAME || '').trim() || 'Bichipishi';
  return `[${n}]`;
}

export type AppSettings = {
  thresholds: {
    diskWarn: number;
    diskCrit: number;
    memWarn: number;
    memCrit: number;
    cpuWarn: number;
    cpuCrit: number;
  };
  alerts: {
    emailEnabled: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPass: string;
    mailFrom: string;
    mailTo: string;
    subjectPrefix: string;
    notifyMinSeverity: string;
    emailCooldownMinutes: number;
  };
};

/** Coincide con los valores por defecto de la API si no hay `settings.json`. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
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
    subjectPrefix: defaultEmailSubjectPrefix(),
    notifyMinSeverity: 'warning',
    emailCooldownMinutes: 30,
  },
};

export type FetchSettingsResult = { settings: AppSettings; fromApi: boolean };

function cloneDefaultSettings(): AppSettings {
  return JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS)) as AppSettings;
}

/** Puerto de metrics-api (mismo que BICHI_API_PORT / 3001). Override: `PUBLIC_BICHI_API_PORT` en `.env`. */
function bichiApiPort(): string {
  return String(import.meta.env.PUBLIC_BICHI_API_PORT ?? '3001');
}

/**
 * URL base HTTPS de la API en producción (p. ej. Cloudflare Pages + API en otro host).
 * Sin barra final. No pongas secretos aquí; solo es la base pública de la API.
 */
function bichiApiBaseUrl(): string {
  const raw = import.meta.env.PUBLIC_BICHI_API_URL;
  if (raw == null || String(raw).trim() === '') return '';
  return String(raw).replace(/\/$/, '');
}

/**
 * Llama a la API: `PUBLIC_BICHI_API_URL` (producción en otro dominio), luego ruta relativa `/api/...`.
 * En build de producción (mismo origen vía metrics-api sirviendo dist/) solo esas dos;
 * no se prueba `:3001` aparte salvo en dev:
 * porque ese puerto no está publicado y podría existir otra API en 127.0.0.1:3001 con datos distintos.
 * En `astro dev`, se añaden fallbacks a `host:3001` y loopback para la API en el PC.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const port = bichiApiPort();
  const base = bichiApiBaseUrl();
  const urls: string[] = [];
  if (base) urls.push(`${base}${path}`);
  urls.push(path);
  if (import.meta.env.DEV) {
    if (typeof globalThis !== 'undefined' && 'location' in globalThis) {
      const host = (globalThis as unknown as Window).location?.hostname;
      if (host) urls.push(`http://${host}:${port}${path}`);
    }
    urls.push(`http://127.0.0.1:${port}${path}`, `http://localhost:${port}${path}`);
  }
  const uniq = [...new Set(urls)];

  let last: Response | undefined;
  for (const url of uniq) {
    try {
      const r = await fetch(url, { ...init, cache: 'no-store' });
      if (r.ok) return r;
      last = r;
    } catch {
      /* siguiente URL */
    }
  }
  return last ?? new Response(null, { status: 404 });
}

/**
 * GET /api/settings. Si no hay API, se devuelven defaults; `fromApi` indica éxito contra el servidor.
 */
export async function fetchSettings(): Promise<FetchSettingsResult> {
  const r = await apiFetch('/api/settings');
  if (r.ok) {
    const settings = (await r.json()) as AppSettings;
    return { settings, fromApi: true };
  }
  if (r.status === 404) {
    return { settings: cloneDefaultSettings(), fromApi: false };
  }
  throw new Error('HTTP ' + r.status);
}

export async function saveSettings(body: Partial<AppSettings>): Promise<{ ok: boolean; settings?: AppSettings }> {
  const r = await apiFetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export async function testSettingsMail(): Promise<{ ok: boolean }> {
  const r = await apiFetch('/api/settings/test-mail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try {
      const j = await r.json();
      if (j && j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json();
}

const $ = (id: string) => document.getElementById(id);

/** Campana de alertas en cabecera. */
export function setAlertsBadgeCount(count: number) {
  const badge = document.getElementById('header-alerts-badge');
  if (!badge) return;
  const n = Math.max(0, Math.floor(count));
  if (n <= 0) {
    badge.setAttribute('hidden', '');
    badge.textContent = '';
    return;
  }
  badge.removeAttribute('hidden');
  badge.textContent = n > 9 ? '9+' : String(n);
}

export function updateHeader(data: any) {
  const hostOk = metricsRepresentHost(data);
  const cpu = Number(data?.cpu);
  const mem = Number(data?.mem);
  const disk = Number(data?.disk);
  const level = hostOk && Number.isFinite(cpu) && Number.isFinite(mem) && Number.isFinite(disk)
    ? healthLevel(cpu, mem, disk)
    : 'ok';
  const openclaw =
    data && typeof data.openclawAvailable === 'boolean' ? data.openclawAvailable : false;

  const badge = $('health-badge') as HTMLElement | null;
  if (badge) {
    badge.dataset.health = hostOk ? level : 'na';
    const labels: Record<string, string> = { ok: 'Estable', warn: 'Atención', crit: 'Crítico', na: '—' };
    const text = $('health-badge-text');
    if (text) text.textContent = hostOk ? labels[level] : '—';
    badge.title = hostOk
      ? `Estado del host: ${labels[level]} (CPU ${Math.round(cpu)}%)`
      : 'Métricas del PC no disponibles (API en contenedor sin identidad de host). Usa bun run deploy.';
  }

  const pill = document.getElementById('uptime-pill') as HTMLElement | null;
  const uptimeEl = $('uptime-text') as HTMLElement | null;
  const sep = pill?.querySelector('.uptime-pill__sep') as HTMLElement | null;
  const hasUp = hasValidSystemUptime(data?.uptime);
  if (uptimeEl && pill) {
    if (hasUp) {
      uptimeEl.textContent = fmtUptime(Number(data.uptime));
      uptimeEl.removeAttribute('hidden');
      if (sep) sep.removeAttribute('hidden');
      pill.classList.remove('uptime-pill--clock-only');
      pill.title = 'Hora local · tiempo de actividad del host';
    } else {
      uptimeEl.textContent = '';
      uptimeEl.setAttribute('hidden', '');
      if (sep) sep.setAttribute('hidden', '');
      pill.classList.add('uptime-pill--clock-only');
      pill.title = 'Hora local';
    }
  }

  const pineWrap = $('pine-avatar-wrap') as HTMLElement | null;
  if (pineWrap) pineWrap.dataset.openclaw = openclaw ? '1' : '0';

  const pine = $('pine-avatar') as HTMLElement | null;
  if (pine) {
    pine.dataset.mood = openclaw && hostOk ? level : 'ok';
    pine.dataset.openclaw = openclaw ? '1' : '0';
  }
  const mouth = $('pine-mouth') as HTMLElement | null;
  if (mouth) {
    mouth.dataset.mood = openclaw && hostOk ? level : 'ok';
    mouth.dataset.openclaw = openclaw ? '1' : '0';
  }

  const role = $('profile-role');
  if (role) {
    role.textContent = 'Monitor del sistema';
  }
}

export type ThemeName = 'light' | 'dark';

/** Tema guardado o preferencia del sistema. */
export function getStoredTheme(): ThemeName {
  try {
    const s = localStorage.getItem('bichi-theme');
    if (s === 'light' || s === 'dark') return s;
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Aplica tema en <html>, color-scheme, meta theme-color e iconos sol/luna. */
export function applyStoredTheme() {
  const t = getStoredTheme();
  const root = document.documentElement;
  if (root.getAttribute('data-theme') !== t) {
    root.setAttribute('data-theme', t);
    root.style.colorScheme = t === 'dark' ? 'dark' : 'light';
    const meta = document.getElementById('meta-theme') as HTMLMetaElement | null;
    if (meta) meta.setAttribute('content', t === 'dark' ? '#1a1a2e' : '#FEF7E5');
  }
  const dark = t === 'dark';
  const sun = document.getElementById('theme-icon-sun');
  const moon = document.getElementById('theme-icon-moon');
  if (sun) (sun as HTMLElement).style.display = dark ? 'none' : 'block';
  if (moon) (moon as HTMLElement).style.display = dark ? 'block' : 'none';
}

export function setupThemeToggle() {
  const toggle = $('theme-toggle');
  if (!toggle) return;

  (toggle as HTMLButtonElement).onclick = () => {
    document.documentElement.classList.add('theme-switching');
    const next: ThemeName = getStoredTheme() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('bichi-theme', next);
    } catch { /* ignore */ }
    applyStoredTheme();
    window.dispatchEvent(new CustomEvent('theme-change', { detail: next }));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => document.documentElement.classList.remove('theme-switching'));
    });
  };

  applyStoredTheme();
}

/* ── Crontab real (API /api/cron) ── */
export type CronJobSource = 'user' | 'system' | 'extra' | 'windows';

export interface SystemCronJob {
  id: string;
  source: CronJobSource;
  schedule: string;
  command: string;
  kind: 'daily' | 'weekly' | 'monthly' | 'custom';
  user: string | null;
  line: string;
}

export type CronCalendarPayload = {
  jobs: SystemCronJob[];
  dates: Record<string, string[]>;
  hint: string | null;
  /** `win32`, `linux`, `darwin`, … (viene de la API) */
  platform?: string;
};

export async function fetchCronCalendar(year: number, month: number): Promise<CronCalendarPayload> {
  const q = `/api/cron?year=${year}&month=${month}`;
  const r = await apiFetch(q);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
