# Bichipishi

**Bichipishi** es un **proyecto personal** de monitorización del sistema: una interfaz web que muestra **métricas reales del equipo** donde corre la API (CPU, RAM, disco, carga, procesos, servicios, Docker, logs, GPU cuando el SO lo permite, tareas programadas, etc.). No es un producto comercial ni ofrece garantías de soporte; lo mantengo como experimento y herramienta de uso propio, publicado con fines de portafolio y transparencia.

La interfaz es una aplicación **Astro** (estática en `dist/`); los datos los sirve un servidor **Node/Bun** en rutas `/api/*`. En producción, web y API pueden compartir **el mismo origen y puerto** (por defecto `3001`).

**Repositorio:** [github.com/webcvalejandropina-ui/bichipishimockopenclaw](https://github.com/webcvalejandropina-ui/bichipishimockopenclaw)

**Versión actual del monorepo:** `1.1.0` (ver `package.json`).

---

## Novedades en v1.1.0

| Área | Mejora |
|------|--------|
| **Tareas programadas** | Nueva página con vista y **calendario** alineado con el mismo origen de datos que el dashboard (`/api/cron`). Desde la UI se pueden **crear, editar y eliminar** tareas en hosts compatibles. |
| **API** | Endpoint **`POST /api/host/cron/task`** para gestionar cron: crontab del usuario, fichero `config/cron.extra`, crontab del sistema opcional (`BICHI_CRON_ALLOW_SYSTEM`), y en **Windows** integración con **Programador de tareas** (`schtasks`) en los modos soportados. |
| **Sistema** | Contenido organizado en **pestañas** para navegar hardware, recursos y red con menos scroll. |
| **Procesos** | **Copia de PID y comando** más clara (botón dedicado, estilos que evitan solapar texto con el control de copiar). |
| **Servicios** | Mensaje por defecto más neutro cuando no hay plantilla de comando para el entorno («Sin comandos»). |
| **UI tareas programadas** | Ajuste de **capas (z-index)** y flujo del formulario para que los modales de error no queden ocultos bajo el formulario (p. ej. en macOS). |
| **Tipos / datos** | Modelo ampliado para trabajos programados del sistema (p. ej. metadatos opcionales de Windows). |
| **Desarrollo** | Script opcional **`proxy-server.py`** en la raíz: sirve `dist/` y reenvía `/api/*` a la API sin depender de Caddy. |
| **Documentación** | README reescrito con **marco de proyecto personal**, tabla de API ampliada, advertencias de seguridad y **troubleshooting** de comandos en tareas cron. |

---

## Alcance y responsabilidad

- **Uso bajo tu propia responsabilidad.** Las acciones sobre el host (señales a procesos, servicios, contenedores Docker, edición de tareas cron / Programador de tareas) pueden afectar al sistema; revisa la configuración de tokens y desactiva lo que no necesites en entornos expuestos.
- La API debe ejecutarse **en el host** que quieres monitorizar. Si solo la levantas dentro de un contenedor sin variables `BICHI_HOST_*`, la interfaz puede indicar que las métricas **no representan tu máquina física**.
- Los comandos que configures en tareas programadas deben ser **válidos para tu shell y SO**; caracteres sobrantes al final de la línea (por ejemplo comillas o puntuación pegada al comando) harán fallar la ejecución.

---

## Qué incluye

| Área | Descripción |
|------|-------------|
| **Dashboard** | Resumen de CPU, RAM, disco, carga, GPU, KPIs (procesos, servicios, contenedores), alertas, gráficos e **información del sistema** (equipo, hostname, SO, IP, CPU, núcleos, GPU, RAM, disco). |
| **Rendimiento** | Histórico agregado por día (**SQLite** en `data/`), alineado con las muestras que guarda la API. |
| **Procesos** | Listado con pistas y copia cómoda de PID / comando. |
| **Servicios** | Estado y plantillas de comando según entorno. |
| **Docker** | Contenedores e imágenes; acciones opcionales según configuración. |
| **Logs** | Lectura de archivo de log o journal (según plataforma y configuración). |
| **OpenClaw** | Panel opcional si detectas binario o ruta de log configurada. |
| **Sistema** | Hardware, uso de recursos, uptime, red, **GPU** (modelo, VRAM, uso si está disponible), con secciones por pestañas. |
| **Tareas programadas** | Vista y calendario alineados con `/api/cron`; en hosts compatibles, creación / edición / borrado vía API (crontab usuario, `cron.extra`, opcional sistema con variables de entorno; en Windows, `schtasks` según modos soportados). |
| **Configuración** | Umbrales, alertas por correo (SMTP), ajustes en `data/settings.json`. |
| **Alertas** | Vista dedicada de advertencias del monitor. |

Tema claro/oscuro, cabecera con estado del host y reloj, marca personalizable mediante variables públicas (nombre, avatar).

---

## Arquitectura (resumen)

```
┌─────────────────────────────────────────────────────────┐
│  Navegador — Astro (HTML/CSS/JS en dist/)               │
│  fetch → /api/metrics, /api/settings, …                 │
└────────────────────────┬────────────────────────────────┘
                         │ mismo host:puerto en producción
┌────────────────────────▼────────────────────────────────┐
│  metrics-api/server.js (Bun o Node ≥ 18)                │
│  Sirve dist/ + API + SQLite (perf) + lectura de logs    │
└────────────────────────┬────────────────────────────────┘
                         │
              systeminformation, fs, Docker, opc. mail/cron
```

- **Desarrollo:** Astro en **4322** con proxy de Vite hacia la API en **3001** (ver `bun run dev`).
- **Producción local:** `bun run deploy` construye la web y arranca un solo proceso que sirve `dist/` y la API.

---

## Requisitos

- **[Bun](https://bun.sh) 1.1+** recomendado. También puedes usar **Node ≥ 18.20** con `npm run deploy:node`, `npm run start:node`, etc.

---

## Puesta en marcha (recomendado)

```bash
cp .env.example .env    # opcional; ajusta puertos y marca
bun install
bun run deploy
```

Abre **http://127.0.0.1:3001/** (o el puerto definido en `BICHI_API_PORT` / `PUBLIC_BICHI_API_PORT`).

| Comando | Descripción |
|---------|-------------|
| `bun run deploy` | Instala dependencias (raíz + workspace `metrics-api`), build de Astro → `dist/`, migra datos antiguos de `metrics-api/data/` a `data/` si aplica, arranca el servidor unificado. |
| `bun start` | Solo servidor (necesitas haber hecho el build antes). |
| `bun run dev` | Astro en caliente (p. ej. `:4322`) + API en el puerto de `.env`. |
| `bun run build:astro` | Solo genera `dist/`. |

---

## API HTTP (referencia rápida)

| Ruta | Método | Uso |
|------|--------|-----|
| `/api/metrics` | GET | JSON con CPU, memoria, disco, load, uptime, procesos, servicios, Docker, GPU, alertas, etc. |
| `/api/settings` | GET / POST | Lee o guarda ajustes (con opciones de seguridad en producción). |
| `/api/settings/test-mail` | POST | Prueba SMTP. |
| `/api/perf/daily` | GET | Series diarias para la página de rendimiento. |
| `/api/openclaw` | GET | Estado / datos OpenClaw si aplica. |
| `/api/logs` | GET | Líneas de log según `LOG_FILE` o journal. |
| `/api/cron` | GET | Tareas tipo cron (crontab + opcional `config/cron.extra` y sistema si está habilitado). |
| `/api/host/process/signal` | POST | Señales a procesos (puede desactivarse). |
| `/api/host/service/action` | POST | Acciones sobre servicios del sistema. |
| `/api/host/cron/task` | POST | Crear / actualizar / eliminar entradas de tareas programadas en el host compatible. |

La documentación detallada de cabeceras, CORS y tokens opcionales está comentada en `metrics-api/server.js` y en `.env.example`.

---

## Datos en disco

| Ruta | Contenido |
|------|-----------|
| **`data/`** | `perf.sqlite` (histórico), `settings.json` (umbrales, correo, …). Ignorados en git salvo `data/.gitkeep`. |
| **`dist/`** | Salida del build de Astro; la sirve la API. Ignorado en git. |

Variable opcional: **`BICHI_DATA_DIR`** para otra carpeta de datos.

---

## GPU

La API usa **`systeminformation.graphics()`**. Modelo y VRAM suelen aparecer en Linux/macOS/Windows; el **porcentaje de uso** depende del fabricante y herramientas (p. ej. NVIDIA con `nvidia-smi`). Si no hay dato de uso, la UI puede mostrar **N/D** manteniendo el modelo.

---

## Variables de entorno

Copia **`.env.example`** → **`.env`**. Incluye:

- Puerto unificado (`BICHI_API_PORT`, `PUBLIC_BICHI_API_PORT`).
- Marca (`PUBLIC_BICHI_APP_NAME`, `PUBLIC_BICHI_AVATAR_URL`).
- Origen público del sitio (`PUBLIC_BICHI_SITE_URL`, `BICHI_PUBLIC_HOST`) para HMR con Caddy u hosts locales.
- Producción: `PUBLIC_BICHI_API_URL`, `BICHI_CORS_ORIGIN`, `BICHI_SETTINGS_TOKEN`, `BICHI_HOST_ACTIONS_TOKEN`, desactivación de acciones host, permisos de cron del sistema, etc.
- OpenClaw, `LOG_FILE`, overrides de host en Docker: ver comentarios en `.env.example` y `config/host-identity.env.example`.

**No subas** `.env` ni `data/` con secretos.

---

## Windows

Instala Bun con el instalador oficial. Los scripts de `package.json` no dependen de bash: `bun run deploy`, `bun start` y `bun run dev` funcionan en PowerShell o CMD. Si el puerto está ocupado, el servidor suele indicar cómo liberarlo (`netstat` / `taskkill`).

---

## Desarrollo sin `deploy`

```bash
bun run dev
```

- Front: **http://localhost:4322** (u host configurado).
- API: proxy `/api` → **127.0.0.1:3001** (o el puerto de tu `.env`).

Opcional: en la raíz hay **`proxy-server.py`**, un proxy mínimo en Python para servir `dist/` y reenviar `/api/*` a la API (útil si prefieres no usar Caddy en un entorno concreto).

---

## Proxy y despliegue con Caddy

En el repo hay configuraciones de ejemplo (`config/caddy-bichipishi-dev.caddyfile`, `config/caddy-bichipishi-prod.caddyfile`) y scripts `proxy:dev` / `proxy:prod` para Caddy. Ajusta dominios y rutas a tu entorno.

---

## Licencia y colaboración

Este repositorio es un **proyecto personal**. Si te resulta útil, puedes clonarlo, adaptarlo o abrir **issues** en GitHub para comentarios técnicos; no hay compromiso de mantenimiento ni roadmap público. El campo `"private": true` en `package.json` solo evita publicar el paquete en npm; no define la visibilidad del repositorio en GitHub.
