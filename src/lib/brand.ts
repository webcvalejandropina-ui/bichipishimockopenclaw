/** Nombre por defecto de la app (UI, correos API, textos). */
export const BICHI_DEFAULT_APP_NAME = 'Bichipishi';

/**
 * Marca embebida en el build (Astro / Vite).
 * En Docker, el contenedor web puede sobrescribir con `PUBLIC_*` al arrancar (`bichi-brand.js`).
 */
export function getBuildBrand(): { appName: string; avatarUrl: string } {
  const appName =
    String(import.meta.env.PUBLIC_BICHI_APP_NAME || '').trim() || BICHI_DEFAULT_APP_NAME;
  const avatarUrl = String(import.meta.env.PUBLIC_BICHI_AVATAR_URL || '').trim();
  return { appName, avatarUrl };
}
