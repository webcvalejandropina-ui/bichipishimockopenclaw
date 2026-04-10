import { BICHI_DEFAULT_APP_NAME } from './brand';

export type ResolvedBichiBrand = { appName: string; avatarUrl: string };

type BrandWindow = Window & {
  __BICHI_BRAND__?: { appName?: string | null; avatarUrl?: string | null };
  __BICHI_BUILD__?: { appName?: string; avatarUrl?: string };
  /** Valores desde GET /api/settings (`data/settings.json`). Vacíos = no sustituyen al build/env. */
  __BICHI_SETTINGS_BRAND__?: { appName?: string; avatarUrl?: string };
};

function pickStr(x: unknown): string {
  if (x == null) return '';
  const s = String(x).trim();
  return s;
}

/**
 * Resuelve marca: `bichi-brand.js` (Docker/ops) > ajustes guardados en API >
 * build (`PUBLIC_BICHI_*`) > defecto.
 */
export function resolveBichiBrand(): ResolvedBichiBrand {
  if (typeof window === 'undefined') {
    return { appName: BICHI_DEFAULT_APP_NAME, avatarUrl: '' };
  }
  const w = window as BrandWindow;
  const o = w.__BICHI_BRAND__ || {};
  const s = w.__BICHI_SETTINGS_BRAND__ || {};
  const b = w.__BICHI_BUILD__ || {};
  const appName =
    pickStr(o.appName) ||
    pickStr(s.appName) ||
    pickStr(b.appName) ||
    BICHI_DEFAULT_APP_NAME;
  const avatarUrl =
    pickStr(o.avatarUrl) || pickStr(s.avatarUrl) || pickStr(b.avatarUrl);
  return { appName, avatarUrl };
}

/** Aplica `settings.brand` sobre el documento (tras cargar ajustes desde la API). */
export function applySettingsBrandOverlay(
  settings: { brand?: { appName?: string; avatarUrl?: string } } | null | undefined,
): void {
  if (typeof window === 'undefined') return;
  const raw = settings?.brand;
  const w = window as BrandWindow;
  w.__BICHI_SETTINGS_BRAND__ = {
    appName: raw?.appName != null ? String(raw.appName).trim() : '',
    avatarUrl: raw?.avatarUrl != null ? String(raw.avatarUrl).trim() : '',
  };
  applyBichiBrandToDocument();
}

/** Sincroniza título, cabecera y avatar del dashboard con la marca resuelta. */
export function applyBichiBrandToDocument(): void {
  if (typeof document === 'undefined') return;
  const { appName, avatarUrl } = resolveBichiBrand();
  document.title = `${appName} · Monitor`;
  document.querySelectorAll<HTMLElement>('[data-bichi-brand]').forEach((el) => {
    el.textContent = appName;
  });
  const pine = document.getElementById('pine-avatar');
  if (pine) {
    if (pine instanceof HTMLImageElement) {
      const buildSrc = pine.getAttribute('data-bichi-build-src') || '';
      if (avatarUrl) {
        pine.src = avatarUrl;
      } else if (buildSrc) {
        pine.src = buildSrc;
      }
      pine.alt = appName;
    } else {
      pine.setAttribute('aria-label', appName);
    }
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
