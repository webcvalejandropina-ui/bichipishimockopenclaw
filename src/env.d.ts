/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_BICHI_API_PORT?: string;
  /** Base pública HTTPS de la API (sin / final). Build de producción (p. ej. Pages). */
  readonly PUBLIC_BICHI_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
