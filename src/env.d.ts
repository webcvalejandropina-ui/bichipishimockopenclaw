/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_BICHI_API_PORT?: string;
  /** Base pública HTTPS de la API (sin / final). Build de producción (p. ej. Pages). */
  readonly PUBLIC_BICHI_API_URL?: string;
  /** Origen canónico del sitio (Astro `site`), p. ej. http://bichipishi.home */
  readonly PUBLIC_BICHI_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
