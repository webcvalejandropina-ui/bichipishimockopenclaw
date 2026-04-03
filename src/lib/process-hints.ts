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
  ssh: 'Escucha conexiones entrantes; autenticación y canal cifrado para administración remota.',
  docker: 'API y runtime de contenedores; redes, volúmenes e imágenes.',
  caddy: 'Terminación TLS, HTTP/2 y reverse proxy hacia backends.',
  postgresql: 'Base de datos relacional; conexiones de aplicaciones y réplicas.',
  'docker-compose': 'Orquestación declarativa en compose: redes, volúmenes y servicios.',
  grafana: 'Visualiza métricas y alertas desde Prometheus u otras fuentes.',
  'grafana-server': 'Dashboards y alertas sobre fuentes de métricas.',
  prometheus: 'Scrape HTTP de exporters; almacena series temporales y consultas PromQL.',
  certbot: 'Renueva certificados Let\'s Encrypt y recarga el servidor web.',
  redis: 'Almacenamiento clave-valor en RAM; pub/sub y TTL.',
  nginx: 'Proxy y servidor estático delante de aplicaciones.',
  cron: 'Ejecución de crontabs del sistema y /etc/cron.*.',
  'systemd-journald': 'Recoge logs del kernel y servicios en el journal.',
  ufw: 'Reglas iptables/nftables simplificadas (firewall).',
  fail2ban: 'Banea IPs tras intentos fallidos (jails + logs).',
  wireguard: 'Interfaz VPN kernel-space; túnel punto a punto.',
};

function normComm(s: string): string {
  return (s || '').replace(/^\(/, '').replace(/\)$/, '').split('/').pop() || '';
}

export function processActivityDescription(comm: string, cmd: string, apiDesc?: string): string {
  const d = (apiDesc || '').trim();
  if (d) return d;
  const c = normComm(comm).toLowerCase();
  if (COMM_HINTS[c]) return COMM_HINTS[c];
  const cmdLow = (cmd || '').toLowerCase();
  for (const [k, v] of Object.entries(COMM_HINTS)) {
    if (cmdLow.includes(k)) return v;
  }
  return `Proceso del host «${comm || 'desconocido'}» (nombre corto del binario); revisa el comando completo en /procesos si necesitas el path.`;
}

export function serviceActivityDescription(serviceName: string, apiDesc?: string): string {
  const base = (apiDesc || '').trim();
  const key = serviceName.replace(/\.(service|socket|timer|mount)$/i, '').toLowerCase();
  const hint = SERVICE_HINTS[key];
  if (base && hint) return `${base} · ${hint}`;
  if (hint) return hint;
  if (base) return base;
  return 'Unidad systemd: define cómo se inicia, reinicia y en qué orden respecto a otras unidades.';
}
