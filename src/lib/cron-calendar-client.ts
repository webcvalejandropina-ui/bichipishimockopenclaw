/**
 * Calendario + lista de tareas cron del host (mismo origen que /api/cron).
 * Usado en el dashboard (solo lectura) y en /tareas-programadas (editable).
 */
import { fetchCronCalendar, type SystemCronJob } from './metrics';
import { iconToSvg } from './lucide-svg-string';
import { Pencil, Trash2 } from 'lucide';

const iEdit = iconToSvg(Pencil, { width: 14, height: 14 });
const iDel = iconToSvg(Trash2, { width: 14, height: 14 });

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export type CronCalendarDomIds = {
  calGrid: string;
  calMonthLabel: string;
  calPrev: string;
  calNext: string;
  cronStatusBar: string;
  cronMasterList: string;
  cronDateTitle: string;
  cronJobsList: string;
};

export type CronCalendarEditable = {
  confirmDelete: (job: SystemCronJob) => Promise<boolean>;
  openCreate: () => void;
  openEdit: (job: SystemCronJob) => void;
  /** Ejecuta el borrado en la API; el calendario se recarga si devuelve ok. */
  performDelete: (job: SystemCronJob) => Promise<{ ok: boolean; error?: string }>;
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} no encontrado`);
  return el;
}

function safeGet(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function fmtCronPlatform(p: string): string {
  if (p === 'win32') return 'Windows';
  if (p === 'darwin') return 'macOS';
  if (p === 'linux') return 'Linux';
  if (p === 'freebsd') return 'FreeBSD';
  return p || 'desconocido';
}

export function canMutateCronJob(j: SystemCronJob, platform: string): boolean {
  if (j.source === 'system') return false;
  if (j.source === 'user') return platform !== 'win32';
  if (j.source === 'extra') return true;
  if (j.source === 'windows') return platform === 'win32';
  return false;
}

function fmtCal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mountCronCalendar(opts: {
  escHtml: (s: string) => string;
  ids: CronCalendarDomIds;
  mode: 'readonly' | 'editable';
  editable?: CronCalendarEditable;
  /** Contenedor para delegación de clics (editar/borrar). Si falta, se usa .calendar-card ancestro de la lista. */
  delegationRootId?: string;
}): { refresh: () => Promise<void> } {
  const { escHtml, ids, mode, editable, delegationRootId } = opts;
  const isEditable = mode === 'editable' && editable;

  let calYear: number;
  let calMonth: number;
  let selectedDate = '';
  let cronJobs: SystemCronJob[] = [];
  let cronDates: Record<string, string[]> = {};
  let cronHint: string | null = null;
  let cronPlatform = '';
  let cronLoadError: string | null = null;

  function cronSourceLabel(source: string): string {
    const winLabel = cronPlatform === 'win32' ? 'Tareas del programador (Windows)' : 'Programador del sistema';
    const m: Record<string, string> = {
      user: 'Crontab del usuario',
      system: '/etc/crontab',
      extra: 'Fichero extra (p. ej. cron.extra)',
      windows: winLabel,
    };
    return m[source] || source;
  }

  function renderCronMasterList() {
    const el = safeGet(ids.cronMasterList);
    if (!el) return;
    if (cronLoadError) {
      el.innerHTML = '';
      return;
    }
    if (!cronJobs.length) {
      const msg = cronHint || 'No hay entradas en las fuentes que la API puede leer.';
      el.innerHTML = `<div class="cron-master-empty">${escHtml(msg)}</div>`;
      return;
    }
    const kindLabel: Record<string, string> = { daily: 'Diario', weekly: 'Semanal', monthly: 'Mensual', custom: 'Otro' };
    el.innerHTML = `<ul class="cron-master-ul">${cronJobs
      .map((j) => {
        const mut = isEditable && canMutateCronJob(j, cronPlatform);
        const jid = String(j.id).replace(/"/g, '');
        const actions = mut
          ? `<div class="cron-master-actions" role="group" aria-label="Acciones">
            <button type="button" class="card-action-btn" title="Editar" aria-label="Editar tarea" data-cron-cal-edit="${jid}">${iEdit}</button>
            <button type="button" class="card-action-btn card-action-btn--danger" title="Eliminar" aria-label="Eliminar tarea" data-cron-cal-del="${jid}">${iDel}</button>
          </div>`
          : j.source === 'system'
            ? `<span class="cron-master-ro">Solo lectura</span>`
            : '';
        return `<li class="cron-master-item" data-cron-cal-job="${escHtml(j.id)}">
          <div class="cron-master-row">
            <span class="cron-master-src">${escHtml(cronSourceLabel(j.source))}</span>
            <span class="cron-master-kind">${escHtml(kindLabel[j.kind] || j.kind)}</span>
            ${actions}
          </div>
          <code class="cron-master-sched">${escHtml(j.schedule)}</code>
          ${j.user ? `<div class="cron-master-user">${escHtml(j.user)}</div>` : ''}
          <div class="cron-master-cmd">${escHtml(j.command || '—')}</div>
        </li>`;
      })
      .join('')}</ul>`;
  }

  function updateCronChrome() {
    const bar = safeGet(ids.cronStatusBar);
    if (!bar) return;
    if (cronLoadError) {
      bar.innerHTML = `<span class="cron-status cron-status--err">${escHtml(cronLoadError)} · comprueba la API y el proxy <code>/api/cron</code>.</span>`;
      return;
    }
    const pl = fmtCronPlatform(cronPlatform);
    const extra =
      cronHint && !cronJobs.length ? ` <span class="cron-status-hint">${escHtml(cronHint)}</span>` : '';
    bar.innerHTML = `<span class="cron-status cron-status--ok"><strong>${escHtml(pl)}</strong> · <strong>${cronJobs.length}</strong> tarea(s) cargadas.${extra}</span>`;
  }

  function jobsForCronDate(ds: string): SystemCronJob[] {
    const idList = cronDates[ds] || [];
    const m = new Map(cronJobs.map((j) => [j.id, j]));
    return idList.map((id) => m.get(id)).filter(Boolean) as SystemCronJob[];
  }

  function renderDots(jobs: SystemCronJob[]): string {
    if (!jobs.length) return '';
    const kinds = new Set(jobs.map((j) => j.kind));
    const dots = [...kinds].slice(0, 4).map((k) => `<span class="cal-dot ${k}"></span>`).join('');
    return `<div class="cal-cell-dots">${dots}</div>`;
  }

  function renderCronSidebar() {
    if (!selectedDate || !safeGet(ids.cronJobsList)) return;
    const d = new Date(`${selectedDate}T12:00:00`);
    const dayName = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    $(ids.cronDateTitle).textContent = dayName.charAt(0).toUpperCase() + dayName.slice(1);

    const jobs = jobsForCronDate(selectedDate);
    const el = $(ids.cronJobsList);

    if (!jobs.length) {
      const msg =
        cronHint && !cronJobs.length
          ? cronHint
          : 'Ninguna de las tareas cargadas coincide con este día en el calendario (revisa la expresión o el mes).';
      el.innerHTML = `<div class="cron-sidebar-empty">${escHtml(msg)}</div>`;
      return;
    }

    const srcLabel: Record<string, string> = {
      user: 'Crontab usuario',
      system: '/etc/crontab',
      extra: 'Fichero extra',
      windows: cronPlatform === 'win32' ? 'Tareas programadas' : 'Programador del SO',
    };
    const kindLabel: Record<string, string> = { daily: 'Diario', weekly: 'Semanal', monthly: 'Mensual', custom: 'Otro' };
    el.innerHTML = jobs
      .map((j) => {
        const mut = isEditable && canMutateCronJob(j, cronPlatform);
        const jid = String(j.id).replace(/"/g, '');
        const actions = mut
          ? `<div class="cron-job-actions" role="group" aria-label="Acciones">
            <button type="button" class="card-action-btn" title="Editar" aria-label="Editar" data-cron-cal-edit="${jid}">${iEdit}</button>
            <button type="button" class="card-action-btn card-action-btn--danger" title="Eliminar" aria-label="Eliminar" data-cron-cal-del="${jid}">${iDel}</button>
          </div>`
          : '';
        return `<div class="cron-job-item" data-id="${escHtml(j.id)}">
          <div class="cron-job-body">
            <div class="cron-job-top">
              <span class="cron-job-name">${escHtml(srcLabel[j.source] || j.source)}</span>
              <span class="cron-job-freq">${escHtml(kindLabel[j.kind] || j.kind)}</span>
            </div>
            <div class="cron-job-meta"><code style="font-size:11px;word-break:break-all;opacity:.9">${escHtml(j.schedule)}</code>${j.user ? ` · <span style="opacity:.85">${escHtml(j.user)}</span>` : ''}</div>
            <div class="cron-job-cmd">${escHtml(j.command)}</div>
            ${actions}
          </div>
        </div>`;
      })
      .join('');
  }

  function renderCal() {
    if (!safeGet(ids.calGrid)) return;
    $(ids.calMonthLabel).textContent = `${MONTHS[calMonth]} ${calYear}`;

    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const today = fmtCal(new Date());

    let html = DAYS.map((d) => `<div class="cal-full-header">${d}</div>`).join('');

    const prevLast = new Date(calYear, calMonth, 0);
    for (let i = startDow - 1; i >= 0; i--) {
      const day = prevLast.getDate() - i;
      const d0 = new Date(calYear, calMonth - 1, day);
      const ds = fmtCal(d0);
      const jobs = jobsForCronDate(ds);
      html += `<div class="cal-cell other-month" data-date="${ds}">
          <div class="cal-cell-date">${day}</div>
          ${renderDots(jobs)}
        </div>`;
    }

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const d0 = new Date(calYear, calMonth, day);
      const ds = fmtCal(d0);
      const isToday = ds === today;
      const isSel = ds === selectedDate;
      const jobs = jobsForCronDate(ds);
      html += `<div class="cal-cell${isToday ? ' today' : ''}${isSel ? ' selected' : ''}" data-date="${ds}">
          <div class="cal-cell-date">${day}</div>
          ${renderDots(jobs)}
        </div>`;
    }

    const totalCells = startDow + lastDay.getDate();
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
      const d0 = new Date(calYear, calMonth + 1, day);
      const ds = fmtCal(d0);
      const jobs = jobsForCronDate(ds);
      html += `<div class="cal-cell other-month" data-date="${ds}">
          <div class="cal-cell-date">${day}</div>
          ${renderDots(jobs)}
        </div>`;
    }

    $(ids.calGrid).innerHTML = html;

    document.querySelectorAll(`#${ids.calGrid} .cal-cell`).forEach((cell) => {
      cell.addEventListener('click', () => {
        selectedDate = (cell as HTMLElement).dataset.date!;
        document.querySelectorAll(`#${ids.calGrid} .cal-cell`).forEach((c) => c.classList.remove('selected'));
        cell.classList.add('selected');
        renderCronSidebar();
      });
    });

    renderCronSidebar();
  }

  async function refreshCronCalendar() {
    if (!safeGet(ids.calGrid)) return;
    try {
      const data = await fetchCronCalendar(calYear, calMonth + 1);
      cronLoadError = null;
      cronJobs = data.jobs;
      cronDates = data.dates;
      cronHint = data.hint ?? null;
      cronPlatform = data.platform || '';
    } catch {
      cronLoadError = 'No se pudo cargar /api/cron';
      cronJobs = [];
      cronDates = {};
      cronHint = null;
      cronPlatform = '';
    }
    updateCronChrome();
    renderCronMasterList();
    renderCal();
  }

  function initCal() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    selectedDate = fmtCal(now);
    void refreshCronCalendar();
  }

  const delegRoot =
    (delegationRootId && safeGet(delegationRootId)) ||
    safeGet(ids.cronMasterList)?.closest('.calendar-card') ||
    safeGet(ids.cronMasterList)?.closest('.tp-cron-card') ||
    document.body;

  function onRootClick(ev: MouseEvent) {
    if (!isEditable || !editable) return;
    const t = ev.target as HTMLElement;
    const editBtn = t.closest('[data-cron-cal-edit]') as HTMLElement | null;
    if (editBtn) {
      const id = editBtn.dataset.cronCalEdit;
      const job = cronJobs.find((j) => j.id === id);
      if (job) editable.openEdit(job);
      return;
    }
    const delBtn = t.closest('[data-cron-cal-del]') as HTMLElement | null;
    if (delBtn) {
      const id = delBtn.dataset.cronCalDel;
      const job = cronJobs.find((j) => j.id === id);
      if (!job) return;
      void (async () => {
        const ok = await editable.confirmDelete(job);
        if (!ok) return;
        const r = await editable.performDelete(job);
        if (!r.ok) {
          window.alert(r.error || 'No se pudo eliminar');
          return;
        }
        await refreshCronCalendar();
      })();
    }
  }

  delegRoot.addEventListener('click', onRootClick);

  const prevEl = safeGet(ids.calPrev);
  const nextEl = safeGet(ids.calNext);
  if (prevEl) {
    prevEl.addEventListener('click', () => {
      calMonth--;
      if (calMonth < 0) {
        calMonth = 11;
        calYear--;
      }
      void refreshCronCalendar();
    });
  }
  if (nextEl) {
    nextEl.addEventListener('click', () => {
      calMonth++;
      if (calMonth > 11) {
        calMonth = 0;
        calYear++;
      }
      void refreshCronCalendar();
    });
  }

  initCal();

  return {
    refresh: refreshCronCalendar,
  };
}
