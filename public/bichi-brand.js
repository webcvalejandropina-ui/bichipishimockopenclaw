/* Valores por defecto en dev: la marca sale de __BICHI_BUILD__ (Layout) y del build.
   En Docker, /docker-entrypoint.d/40-bichi-brand.sh sobrescribe este fichero al arrancar. */
window.__BICHI_BRAND__ = { appName: null, avatarUrl: null };
