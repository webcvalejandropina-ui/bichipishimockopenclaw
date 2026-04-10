/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Nombre visible en la UI (cabecera, título). Por defecto: Bichipishi. */
  readonly PUBLIC_BICHI_APP_NAME?: string;
  /** URL del avatar del perfil (http(s) o ruta absoluta `/…`). Vacío = imagen piña del proyecto. */
  readonly PUBLIC_BICHI_AVATAR_URL?: string;
  readonly PUBLIC_BICHI_API_PORT?: string;
  /** Base pública HTTPS de la API (sin / final). Build de producción (p. ej. Pages). */
  readonly PUBLIC_BICHI_API_URL?: string;
  /** Origen canónico del sitio (Astro `site`), p. ej. http://bichipishi.home */
  readonly PUBLIC_BICHI_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
