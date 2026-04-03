/**
 * Alertas descartadas de forma persistente (localStorage): dashboard, /alertas, campana.
 * El id estable se basa en código + título + detalle para que coincida entre vistas.
 */

export const DISMISSED_ALERTS_KEY = 'bichi_dismissed_alerts_v2';

export type NormalizedMetricAlert = {
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  at: number;
  code?: string;
  source?: string;
  host?: string;
};

function hashAlertFingerprint(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Id único por contenido (sin depender de `at` sintético entre listas). */
export function stableAlertDismissId(a: {
  code?: string;
  title?: string;
  detail?: string;
  message?: string;
}): string {
  const code = String(a.code ?? '');
  const title = String(a.title ?? '');
  const detail = String(a.detail ?? a.message ?? '');
  const line = [code, title, detail.slice(0, 600)].join('\n');
  return `da_${hashAlertFingerprint(line)}`;
}

export function readDismissedAlertIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_ALERTS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map(String));
  } catch {
    return new Set();
  }
}

export function rememberDismissedAlertId(id: string) {
  const s = readDismissedAlertIds();
  s.add(id);
  const next = [...s].slice(-200);
  try {
    localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Misma normalización en dashboard (tarjetas) y /alertas (timeline). */
export function normalizeAlertsFromMetrics(d: any): NormalizedMetricAlert[] {
  if (!d) return [];
  const out: NormalizedMetricAlert[] = [];

  if (Array.isArray(d.alerts) && d.alerts.length) {
    for (const a of d.alerts) {
      const title = String(a.title || '').trim();
      const detail = String(a.detail || a.message || '').trim();
      const text = [title, detail].filter(Boolean).join(': ') || title || detail;
      if (!text) continue;
      out.push({
        severity: a.severity === 'critical' ? 'critical' : 'warning',
        title: title || text.slice(0, 80),
        detail: detail || title || text,
        at: typeof a.at === 'number' ? a.at : Date.now(),
        code: a.code ? String(a.code) : undefined,
        source: a.source ? String(a.source) : undefined,
        host: a.host ? String(a.host) : undefined,
      });
    }
    return out;
  }

  if (Array.isArray(d.warnings) && d.warnings.length) {
    const t0 = Date.now();
    d.warnings.forEach((w: string, i: number) => {
      const text = String(w || '').trim();
      if (!text) return;
      out.push({
        severity: /error|fail|fatal|crit/i.test(text) ? 'critical' : 'warning',
        title: text.length > 72 ? `${text.slice(0, 69)}…` : text,
        detail: text,
        at: t0 - i * 60_000,
        source: 'sistema',
      });
    });
  }

  return out;
}

export function filterUndismissedAlerts<T extends Record<string, unknown>>(
  items: T[],
  getId: (x: T) => string,
): T[] {
  const dismissed = readDismissedAlertIds();
  return items.filter((x) => !dismissed.has(getId(x)));
}

export function countUndismissedAlertsFromMetrics(d: any): number {
  const raw = normalizeAlertsFromMetrics(d);
  return filterUndismissedAlerts(raw, (a) => stableAlertDismissId(a)).length;
}

/** Primeras N alertas no descartadas (dashboard). */
export function buildDashAlertListForHome(d: any, limit = 6): NormalizedMetricAlert[] {
  const list = filterUndismissedAlerts(normalizeAlertsFromMetrics(d), (a) =>
    stableAlertDismissId(a),
  );
  return list.slice(0, limit);
}
