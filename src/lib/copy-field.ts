/** Valores del sistema: clic copia al portapapeles; `title` muestra el texto completo. */

let copyToastTimer: ReturnType<typeof setTimeout> | undefined;

export function flashCopied(el: HTMLElement) {
  el.classList.add('is-copied');
  if (copyToastTimer) clearTimeout(copyToastTimer);
  copyToastTimer = setTimeout(() => el.classList.remove('is-copied'), 1400);
}

/**
 * Copia texto (HTTPS/localhost: Clipboard API; si no, fallback con textarea para HTTP en LAN).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const t = text.trim();
  if (!t || t === '—') return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    /* fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Enlaza una sola vez los elementos `.js-copy-val` dentro de `root`.
 * Usa `data-copy-text` si existe; si no, `textContent`.
 */
export function initCopyableValues(root: ParentNode = document.body) {
  root.querySelectorAll<HTMLElement>('.js-copy-val').forEach((el) => {
    if ((el as HTMLElement & { _bichiCopy?: boolean })._bichiCopy) return;
    (el as HTMLElement & { _bichiCopy?: boolean })._bichiCopy = true;
    el.addEventListener('click', () => {
      const raw = el.dataset.copyText ?? el.textContent?.trim() ?? '';
      void copyTextToClipboard(raw).then((ok) => {
        if (ok) flashCopied(el);
      });
    });
  });
}
