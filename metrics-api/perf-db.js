/**
 * Histórico de rendimiento (CPU/RAM/disco) por día en SQLite.
 * Mantiene ≥7 días consultables; conserva hasta ~120 días.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const RETENTION_DAYS = 120;
const MIN_QUERY_DAYS = 7;

let db;

function localDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function openDb(dataDir) {
  if (db) return db;
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'perf.sqlite');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS perf_daily (
      day TEXT PRIMARY KEY,
      samples INTEGER NOT NULL,
      sum_cpu REAL NOT NULL,
      max_cpu REAL NOT NULL,
      sum_mem REAL NOT NULL,
      max_mem REAL NOT NULL,
      sum_disk REAL NOT NULL,
      max_disk REAL NOT NULL,
      last_at INTEGER NOT NULL
    );
  `);
  return db;
}

function pruneOlderThan(dataDir, cutoffDayStr) {
  const database = openDb(dataDir);
  database.prepare('DELETE FROM perf_daily WHERE day < ?').run(cutoffDayStr);
}

/**
 * Una muestra por cada consulta a /api/metrics (agregado por día local del servidor).
 */
function recordPerfDailySample(dataDir, cpu, mem, disk) {
  const database = openDb(dataDir);
  const day = localDayKey();
  const c = Math.min(100, Math.max(0, Number(cpu) || 0));
  const m = Math.min(100, Math.max(0, Number(mem) || 0));
  const d = Math.min(100, Math.max(0, Number(disk) || 0));
  const now = Date.now();
  const row = database.prepare('SELECT * FROM perf_daily WHERE day = ?').get(day);
  if (!row) {
    database
      .prepare(
        `INSERT INTO perf_daily (day, samples, sum_cpu, max_cpu, sum_mem, max_mem, sum_disk, max_disk, last_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(day, c, c, m, m, d, d, now);
  } else {
    const samples = row.samples + 1;
    database
      .prepare(
        `UPDATE perf_daily SET
          samples = ?, sum_cpu = ?, max_cpu = ?, sum_mem = ?, max_mem = ?,
          sum_disk = ?, max_disk = ?, last_at = ?
         WHERE day = ?`,
      )
      .run(
        samples,
        row.sum_cpu + c,
        Math.max(row.max_cpu, c),
        row.sum_mem + m,
        Math.max(row.max_mem, m),
        row.sum_disk + d,
        Math.max(row.max_disk, d),
        now,
        day,
      );
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  pruneOlderThan(dataDir, localDayKey(cutoff));
}

function queryPerfDailyJson(dataDir, requestedDays) {
  const database = openDb(dataDir);
  const days = Math.min(RETENTION_DAYS, Math.max(MIN_QUERY_DAYS, Number(requestedDays) || 90));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  const startStr = localDayKey(start);
  const rows = database
    .prepare(
      `SELECT day, samples, sum_cpu, max_cpu, sum_mem, max_mem, sum_disk, max_disk, last_at
       FROM perf_daily WHERE day >= ? ORDER BY day DESC`,
    )
    .all(startStr);
  const out = {};
  for (const r of rows) {
    out[r.day] = {
      samples: r.samples,
      sumCpu: r.sum_cpu,
      maxCpu: r.max_cpu,
      sumMem: r.sum_mem,
      maxMem: r.max_mem,
      sumDisk: r.sum_disk,
      maxDisk: r.max_disk,
      lastAt: r.last_at,
    };
  }
  return {
    source: 'sqlite',
    retentionDays: RETENTION_DAYS,
    minDays: MIN_QUERY_DAYS,
    days: out,
  };
}

module.exports = { recordPerfDailySample, queryPerfDailyJson, localDayKey };
