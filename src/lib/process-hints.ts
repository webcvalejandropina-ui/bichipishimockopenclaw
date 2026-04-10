/**
 * Textos estilo top/htop para cuando la API no envía descripción.
 */

export function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const COMM_HINTS: Record<string, string> = {
  node: 'Runtime JavaScript: servidor web, bundlers o herramientas (npm/yarn).',
  python3: 'Intérprete Python: scripts, APIs, workers o tareas de sistema.',
  kernel_task: 'Núcleo del SO (macOS): gestión térmica, E/S y planificación; suele figurar alto en Activity Monitor.',
  windowserver: 'Servidor de ventanas (macOS): composición de pantalla, aceleración GPU y eventos de UI.',
  launchd: 'Init y supervisor de servicios (macOS): arranque de daemons y agentes por usuario.',
  mds: 'Spotlight (macOS): indexación de metadatos en disco.',
  mds_stores: 'Almacén de índices Spotlight (macOS).',
  syslogd: 'Registro de mensajes del sistema (macOS/BSD).',
  dockerd: 'Daemon de Docker: crea y gestiona contenedores e imágenes.',
  caddy: 'Servidor web con HTTPS automático y proxy inverso.',
  postgres: 'Motor PostgreSQL: consultas SQL y almacenamiento transaccional.',
  'redis-server': 'Redis: caché en memoria, colas y sesiones.',
  systemd: 'Init PID 1: arranque, unidades y gestión de servicios.',
  sshd: 'OpenSSH: sesiones remotas y transferencia segura de archivos.',
  cron: 'Planificador de tareas periódicas (crontab).',
  nginx: 'Worker de Nginx: sirve HTTP o reparte carga como proxy.',
  kthreadd: 'Hilos del kernel Linux (I/O, red, planificación).',
  ksoftirqd: 'Procesamiento diferido de interrupciones software.',
  'containerd-shim': 'Capa entre containerd y el proceso del contenedor.',
  chrome: 'Navegador Chromium: pestañas, GPU y extensiones.',
  code: 'Editor VS Code / fork: extensión host y language servers.',
};

const SERVICE_HINTS: Record<string, string> = {
  ssh: 'SSH: conexiones remotas cifradas.',
  docker: 'Contenedores: API Docker, redes, volúmenes e imágenes.',
  caddy: 'Caddy: TLS automático y reverse proxy.',
  postgresql: 'PostgreSQL: base de datos relacional.',
  'docker-compose': 'Compose: orquestación declarativa de servicios.',
  grafana: 'Grafana: métricas y alertas (p. ej. Prometheus).',
  'grafana-server': 'Grafana: dashboards y alertas.',
  prometheus: 'Prometheus: series temporales y PromQL.',
  certbot: "Certbot: certificados Let's Encrypt.",
  redis: 'Redis: clave-valor en RAM, colas, TTL.',
  nginx: 'Nginx: proxy y contenido estático.',
  cron: 'Cron: tareas periódicas del sistema.',
  'systemd-journald': 'journald: logs del kernel y servicios.',
  ufw: 'UFW: firewall (iptables/nftables).',
  fail2ban: 'Fail2ban: bloqueo por intentos fallidos.',
  wireguard: 'WireGuard: VPN punto a punto.',
};

function normComm(s: string): string {
  return (s || '').replace(/^\(/, '').replace(/\)$/, '').split('/').pop() || '';
}

const PROCESS_FALLBACK = '—';

export function processActivityDescription(comm: string, cmd: string, apiDesc?: string): string {
  const d = (apiDesc || '').trim();
  if (d) return d;
  const c = normComm(comm).toLowerCase();
  if (COMM_HINTS[c]) return COMM_HINTS[c];
  const cmdLow = (cmd || '').toLowerCase();
  for (const [k, v] of Object.entries(COMM_HINTS)) {
    if (cmdLow.includes(k)) return v;
  }
  return PROCESS_FALLBACK;
}

export function serviceActivityDescription(serviceName: string, apiDesc?: string): string {
  const base = (apiDesc || '').trim();
  const key = serviceName.replace(/\.(service|socket|timer|mount)$/i, '').toLowerCase();
  const hint = SERVICE_HINTS[key];
  if (base && hint) return `${base} · ${hint}`;
  if (hint) return hint;
  if (base) return base;
  return 'Servicio del sistema: inicio y dependencias dependen de la plataforma (systemd, launchd, Windows Services, etc.).';
}

/** Texto útil por nombre de servicio (tarjetas / listas), sin repetir la descripción genérica de la API. */
export function serviceCatalogHint(serviceName: string): string {
  const key = String(serviceName || '')
    .replace(/\.(service|socket|timer|mount)$/i, '')
    .toLowerCase();
  return SERVICE_HINTS[key] || '';
}

/** Descripciones que la API repite para muchas filas; no aportan si ya hay hint o van en otro sitio. */
export function isBoilerplateServiceDesc(desc: string): boolean {
  const t = String(desc || '').trim().toLowerCase();
  if (!t) return true;
  return (
    t.includes('detección por ps') ||
    t.includes('coincidencia por nombre en procesos') ||
    t.includes('no es el label launchd') ||
    t.includes('servicio de windows') ||
    t === 'unidad systemd' ||
    t === 'servicio del sistema' ||
    t === 'daemon / proceso del sistema (detección por ps)'
  );
}
