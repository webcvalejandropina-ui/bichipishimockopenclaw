/**
 * Serializa nodos de iconos Lucide (paquete `lucide`) a string SVG para HTML estático y plantillas.
 * @see https://lucide.dev/icons
 */

export type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

const VOID_TAGS = new Set([
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
]);

const DEFAULT_SVG: Record<string, string | number> = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2.25,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};

function escAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderTag(tag: string, attrs: Record<string, string | number | undefined>): string {
  const parts = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${escAttr(String(v))}"`)
    .join(' ');
  if (VOID_TAGS.has(tag)) return `<${tag} ${parts} />`;
  return `<${tag} ${parts}></${tag}>`;
}

/** Genera un elemento <svg> completo a partir de un IconNode de Lucide. */
export function iconToSvg(
  node: IconNode,
  extra: Record<string, string | number> = {}
): string {
  const svgAttrs = { ...DEFAULT_SVG, ...extra };
  const open = Object.entries(svgAttrs)
    .map(([k, v]) => `${k}="${escAttr(String(v))}"`)
    .join(' ');
  const inner = node.map(([t, a]) => renderTag(t, a as Record<string, string | number | undefined>)).join('');
  return `<svg ${open}>${inner}</svg>`;
}
