/**
 * Rendimiento por día: SQLite en el servidor (vía API) + localStorage como respaldo offline.
 * El servidor conserva ≥7 días consultables (hasta ~120 en BD).
 */

import { apiFetch } from './metrics';

const STORAGE_KEY = 'bichi_perf_daily_v1';
const MAX_DAYS = 120;

export type DayPerfAgg = {
  samples: number;
  sumCpu: number;
  maxCpu: number;
  sumMem: number;
  maxMem: number;
  sumDisk: number;
  maxDisk: number;
  lastAt: number;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function loadPerfDaily(): Record<string, DayPerfAgg> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return {};
    return o as Record<string, DayPerfAgg>;
  } catch {
    return {};
  }
}

function savePerfDaily(data: Record<string, DayPerfAgg>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota / privado */
  }
}

function mergeAgg(a?: DayPerfAgg, b?: DayPerfAgg): DayPerfAgg | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    samples: a.samples + b.samples,
    sumCpu: a.sumCpu + b.sumCpu,
    maxCpu: Math.max(a.maxCpu, b.maxCpu),
    sumMem: a.sumMem + b.sumMem,
    maxMem: Math.max(a.maxMem, b.maxMem),
    sumDisk: a.sumDisk + b.sumDisk,
    maxDisk: Math.max(a.maxDisk, b.maxDisk),
    lastAt: Math.max(a.lastAt, b.lastAt),
  };
}

/** Une mapas local + servidor (misma clave día: suma muestras y máximos). */
export function mergePerfMaps(
  local: Record<string, DayPerfAgg>,
  server: Record<string, DayPerfAgg> | null | undefined,
): Record<string, DayPerfAgg> {
  if (!server || !Object.keys(server).length) return { ...local };
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  const out: Record<string, DayPerfAgg> = {};
  for (const k of keys) {
    const m = mergeAgg(local[k], server[k]);
    if (m) out[k] = m;
  }
  return out;
}

export async function fetchPerfDailyFromServer(): Promise<Record<string, DayPerfAgg> | null> {
  try {
    const r = await apiFetch('/api/perf/daily?days=120');
    if (!r.ok) return null;
    const j = (await r.json()) as { days?: Record<string, DayPerfAgg> };
    if (j && j.days && typeof j.days === 'object') return j.days;
    return null;
  } catch {
    return null;
  }
}

export async function loadPerfDailyMerged(): Promise<Record<string, DayPerfAgg>> {
  const local = loadPerfDaily();
  const remote = await fetchPerfDailyFromServer();
  return mergePerfMaps(local, remote);
}

export function recordPerfSample(m: { cpu: number; mem: number; disk: number }) {
  const key = localDateKey();
  const cpu = Math.min(100, Math.max(0, Number(m.cpu) || 0));
  const mem = Math.min(100, Math.max(0, Number(m.mem) || 0));
  const disk = Math.min(100, Math.max(0, Number(m.disk) || 0));
  const all = loadPerfDaily();
  const prev = all[key];
  const now = Date.now();
  if (!prev) {
    all[key] = {
      samples: 1,
      sumCpu: cpu,
      maxCpu: cpu,
      sumMem: mem,
      maxMem: mem,
      sumDisk: disk,
      maxDisk: disk,
      lastAt: now,
    };
  } else {
    prev.samples += 1;
    prev.sumCpu += cpu;
    prev.maxCpu = Math.max(prev.maxCpu, cpu);
    prev.sumMem += mem;
    prev.maxMem = Math.max(prev.maxMem, mem);
    prev.sumDisk += disk;
    prev.maxDisk = Math.max(prev.maxDisk, disk);
    prev.lastAt = now;
  }
  const keys = Object.keys(all).sort();
  if (keys.length > MAX_DAYS) {
    keys.slice(0, keys.length - MAX_DAYS).forEach((k) => {
      delete all[k];
    });
  }
  savePerfDaily(all);
}

/** Más reciente primero */
export function sortedDayEntries(): [string, DayPerfAgg][] {
  return sortedDayEntriesFrom(loadPerfDaily());
}

export function sortedDayEntriesFrom(all: Record<string, DayPerfAgg>): [string, DayPerfAgg][] {
  return Object.entries(all).sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
}

/** Solo claves de día locales ≤ hoy (YYYY-MM-DD lexicográfico coincide con orden cronológico). */
export function filterPerfMapUpToToday(map: Record<string, DayPerfAgg>): Record<string, DayPerfAgg> {
  const today = localDateKey();
  const out: Record<string, DayPerfAgg> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k <= today) out[k] = v;
  }
  return out;
}

export type PerfSummary = {
  dayCount: number;
  firstDay: string;
  lastDay: string;
  avgCpu: number;
  avgMem: number;
  avgDisk: number;
  peakCpu: number;
  peakMem: number;
  peakDisk: number;
  totalSamples: number;
};

/** Medias ponderadas por número de muestras y picos por día, solo días ≤ hoy. */
export function computePerfSummary(map: Record<string, DayPerfAgg>): PerfSummary | null {
  const today = localDateKey();
  const entries = sortedDayEntriesFrom(map).filter(([day]) => day <= today);
  if (!entries.length) return null;
  let sumCpu = 0;
  let sumMem = 0;
  let sumDisk = 0;
  let samples = 0;
  let peakCpu = 0;
  let peakMem = 0;
  let peakDisk = 0;
  for (const [, a] of entries) {
    if (!a.samples) continue;
    sumCpu += a.sumCpu;
    sumMem += a.sumMem;
    sumDisk += a.sumDisk;
    samples += a.samples;
    peakCpu = Math.max(peakCpu, a.maxCpu);
    peakMem = Math.max(peakMem, a.maxMem);
    peakDisk = Math.max(peakDisk, a.maxDisk);
  }
  if (!samples) return null;
  return {
    dayCount: entries.length,
    firstDay: entries[entries.length - 1][0],
    lastDay: entries[0][0],
    avgCpu: sumCpu / samples,
    avgMem: sumMem / samples,
    avgDisk: sumDisk / samples,
    peakCpu,
    peakMem,
    peakDisk,
    totalSamples: samples,
  };
}

export function fmtPct(n: number) {
  return `${Math.round(n)}%`;
}
