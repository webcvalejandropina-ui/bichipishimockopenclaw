import { BICHI_DEFAULT_APP_NAME } from './brand';

export type ResolvedBichiBrand = { appName: string; avatarUrl: string };

type BrandWindow = Window & {
  __BICHI_BRAND__?: { appName?: string | null; avatarUrl?: string | null };
  __BICHI_BUILD__?: { appName?: string; avatarUrl?: string };
};

function pickStr(x: unknown): string {
  if (x == null) return '';
  const s = String(x).trim();
  return s;
}

/** Resuelve marca: runtime (bichi-brand.js) > build (.env) > defecto. */
export function resolveBichiBrand(): ResolvedBichiBrand {
  if (typeof window === 'undefined') {
    return { appName: BICHI_DEFAULT_APP_NAME, avatarUrl: '' };
  }
  const w = window as BrandWindow;
  const o = w.__BICHI_BRAND__ || {};
  const b = w.__BICHI_BUILD__ || {};
  const appName =
    pickStr(o.appName) || pickStr(b.appName) || BICHI_DEFAULT_APP_NAME;
  const avatarUrl = pickStr(o.avatarUrl) || pickStr(b.avatarUrl);
  return { appName, avatarUrl };
}

/** Sincroniza título, cabecera y avatar del dashboard con la marca resuelta. */
export function applyBichiBrandToDocument(): void {
  if (typeof document === 'undefined') return;
  const { appName, avatarUrl } = resolveBichiBrand();
  document.title = `${appName} · Monitor`;
  document.querySelectorAll<HTMLElement>('[data-bichi-brand]').forEach((el) => {
    el.textContent = appName;
  });
  const pine = document.getElementById('pine-avatar') as HTMLImageElement | null;
  if (pine && avatarUrl) {
    pine.src = avatarUrl;
    pine.alt = appName;
  }
  const h1 = document.querySelector('h1.sr-only');
  if (h1) h1.textContent = `Monitor del sistema ${appName}`;
  const logTitle = appName.toLowerCase();
  document.querySelectorAll<HTMLElement>('[data-bichi-log-title]').forEach((el) => {
    el.textContent = `system.log — ${logTitle}`;
  });
  const wrap = document.getElementById('card-profile');
  if (wrap) {
    wrap.classList.toggle('profile-card--custom-avatar', Boolean(avatarUrl));
  }
}
