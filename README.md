# Bichipishi

**Bichipishi** es un **proyecto personal** de monitorización del sistema: una interfaz web que muestra **métricas reales del equipo** donde corre la API (CPU, RAM, disco, carga, procesos, servicios, Docker, logs, GPU cuando el SO lo permite, tareas programadas, etc.). No es un producto comercial ni ofrece garantías de soporte; lo mantengo como experimento y herramienta de uso propio, publicado con fines de portafolio y transparencia.

La interfaz es una aplicación **Astro** (estática en `dist/`); los datos los sirve un servidor **Node/Bun** en rutas `/api/*`. En producción, web y API pueden compartir **el mismo origen y puerto** (por defecto `3001`).

**Repositorio:** [github.com/webcvalejandropina-ui/bichipishimockopenclaw](https://github.com/webcvalejandropina-ui/bichipishimockopenclaw)

**Versión actual del monorepo:** `1.1.0` (ver `package.json`).

**Despliegue paso a paso (Bun/pnpm, Docker, Cloudflare Tunnel, variables, seguridad y averías):** [docs/DESPLEGUE.md](docs/DESPLEGUE.md). **Paquetes (por qué no npm, vulnerabilidades y lockfiles):** [docs/PAQUETES.md](docs/PAQUETES.md).

> **Docker / Compose:** el soporte documentado en este repo es **modo experimental**: puede cambiar entre versiones, no ofrece el mismo nivel de pruebas que el flujo `bun run deploy` en el host, y en entornos distintos (macOS vs Linux, Docker Desktop vs motor en servidor) el comportamiento de métricas y montajes puede diferir. Úsalo bajo tu criterio; la guía detallada está en la sección [Despliegue con Docker (experimental)](#despliegue-con-docker-experimental) y en [docs/DESPLEGUE.md](docs/DESPLEGUE.md).

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
| **Docker (experimental)** | `Dockerfile` / `Dockerfile.dev`, `docker-compose.yml` con perfiles (**production**, **local**, **full-host**, **tunnel**), Bun + Astro; ver sección dedicada más abajo. |

---

## Alcance y responsabilidad

- **Uso bajo tu propia responsabilidad.** Las acciones sobre el host (señales a procesos, servicios, contenedores Docker, edición de tareas cron / Programador de tareas) pueden afectar al sistema; revisa la configuración de tokens y desactiva lo que no necesites en entornos expuestos.
- La API debe ejecutarse **en el host** que quieres monitorizar. Si solo la levantas dentro de un contenedor **aislado** (p. ej. Docker sin montajes ni perfil `full-host`), la interfaz puede indicar que las métricas **no representan tu máquina física**; con el **`docker-compose` de perfil `full-host`** en Linux se acerca mucho más a monitorizar el sistema real (a costa de privilegios elevados).
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

- **[Bun](https://bun.sh) 1.1+** recomendado. Con **Node ≥ 18.20** sin Bun: **[pnpm](https://pnpm.io)** y `pnpm run deploy:node` / `pnpm run start:node` (lockfile `pnpm-lock.yaml`; ver [docs/PAQUETES.md](docs/PAQUETES.md)).

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
| `bun run docker:up` | Docker **producción**: build + `up -d` (perfil `production`; alias `web-only`). |
| `bun run docker:up:local` | Docker **desarrollo**: Astro `:4322` + API `:3001` (perfil `local`). |
| `bun run docker:up:tunnel` / `docker:up:local:tunnel` | Mismo que arriba + **Cloudflare Tunnel** (`TUNNEL_TOKEN` en `.env`). |
| `pnpm run deploy:node` | Solo si usas **Node + pnpm** sin Bun (ver [docs/PAQUETES.md](docs/PAQUETES.md)). |

---

## Despliegue con Docker (experimental)

El despliegue mediante **Docker** y **Docker Compose** es una **vía opcional y experimental**: reproduce en contenedores el mismo stack (**Bun** + **Astro** + API en Node/Bun) que el resto del proyecto, pero **no** es el camino “oficial” probado día a día (ese sigue siendo **`bun run deploy`** o **`bun run dev`** en el sistema anfitrión). Puede haber diferencias según SO, versión de Docker y si usas Docker Desktop o un motor en Linux.

### Qué ofrece (características)

| Elemento | Descripción |
|----------|-------------|
| **Stack** | Imagen base **oven/bun**; dependencias con **`bun install --frozen-lockfile`**; sin npm en los flujos documentados (ver [docs/PAQUETES.md](docs/PAQUETES.md)). |
| **`Dockerfile`** | Build de Astro → `dist/` y runtime que ejecuta **`bun server.js`** en `metrics-api/`: un solo puerto (**3001** por defecto), similar a producción sin Docker. |
| **`Dockerfile.dev`** | **`bun run dev`** (Astro **:4322** + API **:3001** vía `concurrently`); volúmenes para **HMR** sobre `src/`, `metrics-api/`, etc. Incluye **`procps`** (`ps`) para `concurrently`. |
| **Socket Docker** | En **`production`** y **`local`** se monta **`/var/run/docker.sock`**: la UI **Docker** lista contenedores del motor del host (misma idea que en el SO). Implica confiar en el contenedor respecto al daemon. |
| **Compose** | Perfiles combinables: **`production`** (alias **`web-only`**), **`local`**, **`full-host`** (Linux, acceso al host real con privilegios), **`tunnel`** (**cloudflared** + `TUNNEL_TOKEN`). |
| **Datos** | Volumen Docker **`bichipishi_data`** montado en **`/data`** (`BICHI_DATA_DIR`): SQLite de rendimiento, `settings.json`, etc. |
| **Red** | Alias de servicio **`bichipishi`** para que **Cloudflare Tunnel** apunte a `http://bichipishi:3001` (producción) o `http://bichipishi:4322` (perfil `local`). |
| **Scripts** | Paridad **prod / dev**: `docker:up` ↔ `docker:up:local`, `docker:up:tunnel` ↔ `docker:up:local:tunnel`, `docker:down` común. **Makefile**: `docker-up`, `docker-up-local`, `docker-up-tunnel`, `docker-up-local-tunnel`. |

### Paridad: desplegar en prod y en dev (mismo flujo)

Ambos perfiles siguen el **mismo procedimiento**; solo cambian imagen, puertos y URL de la UI.

| Paso | Producción (`production`) | Desarrollo (`local`) |
|------|-----------------------------|-------------------------|
| 1. Entorno | `cp .env.example .env` y revisa puertos (`BICHI_PUBLISH`, etc.) | Igual; opcional `BICHI_DEV_ASTRO` / `BICHI_DEV_API` si **4322** o **3001** están ocupados |
| 2. Subir stack | `bun run docker:up` o `make docker-up` | `bun run docker:up:local` o `make docker-up-local` |
| 3. Abrir la app | **http://127.0.0.1:3001/** (todo en un origen) | **http://127.0.0.1:4322/** (Astro; `/api` va al backend vía Vite) |
| 4. Datos persistentes | Volumen **`bichipishi_data`** → **`/data`** | El mismo volumen y ruta |
| 5. Reconstruir imagen | Tras cambios en fuentes del **build**: `bun run docker:build` o cambio en `Dockerfile` | Tras cambiar **`package.json` / `bun.lock`**: `docker:build:local`; cambios en **`src/`** sin tocar dependencias: HMR, sin rebuild |
| 6. Túnel público | `bun run docker:up:tunnel`: acceso local por defecto **http://127.0.0.1:8080** (mapeo host→contenedor); en Cloudflare Zero Trust el **origen interno** sigue siendo **`http://bichipishi:3001`**. | `docker:up:local:tunnel`: UI **:4322**; API en el host por defecto **:8080**; origen en CF para la web suele ser **`http://bichipishi:4322`**. |
| 7. Bajar todo | `bun run docker:down` | Igual |

### Límites del modo experimental

- **Métricas “del PC”:** en **`production`** / **`local`** sin **`full-host`**, lo que ves suele ser el **contenedor**, no el hardware completo del anfitrión. Para acercarte al host real en Linux existe el perfil **`full-host`** (montajes, `pid: host`, privilegios; **riesgo alto** si lo expones a Internet).
- **Entorno:** en **Docker Desktop** (macOS/Windows) el comportamiento no es idéntico a un **Linux** servidor; la documentación larga está en [docs/DESPLEGUE.md](docs/DESPLEGUE.md).
- **Estabilidad:** la composición de imágenes y volúmenes puede ajustarse en futuras versiones del repo sin periodo de deprecación formal.

### Comandos rápidos (prod y dev alineados)

| Objetivo | Producción | Desarrollo |
|----------|------------|------------|
| Levantar (build + **up -d**) | `bun run docker:up` · `make docker-up` | `bun run docker:up:local` · `make docker-up-local` |
| + **Cloudflare Tunnel** | `bun run docker:up:tunnel` · `make docker-up-tunnel` | `bun run docker:up:local:tunnel` · `make docker-up-local-tunnel` |
| Logs | `bun run docker:logs` · `make docker-logs` | `bun run docker:logs:local` · `make docker-logs-local` |
| Solo rebuild de imagen | `bun run docker:build` · `make docker-build` | `bun run docker:build:local` · `make docker-build-local` |
| Parar | `bun run docker:down` · `make docker-down` (afecta a todos los perfiles del proyecto) | Igual |

Requisito del túnel: **`TUNNEL_TOKEN`** en **`.env`** (ver [docs/DESPLEGUE.md — § 5](docs/DESPLEGUE.md#5-cloudflare-tunnel-https-público-sin-puertos-abiertos)).

Equivalente manual:

```bash
docker compose --profile production up -d --build
docker compose --profile local up -d --build
# Con túnel, mismo puerto por defecto que el script (8080 en el host):
BICHI_PUBLISH=8080 docker compose --profile production --profile tunnel up -d --build
BICHI_DEV_API=8080 docker compose --profile local --profile tunnel up -d --build
```

**Guía completa** (Zero Trust, variables, seguridad, backups, averías, orígenes HTTP internos): **[docs/DESPLEGUE.md](docs/DESPLEGUE.md)**.

### Cloudflare Tunnel (resumen)

Con el perfil **`tunnel`**, **cloudflared** sale hacia Cloudflare sin abrir puertos en el router. Los scripts **`docker:up:tunnel`** / **`docker:up:local:tunnel`** publican la API en el **host** en el puerto **8080** por defecto (`BICHI_PUBLISH` / `BICHI_DEV_API`), para no chocar con otros servicios en **3001** y alinearse con un acceso local habitual. En el panel de Zero Trust, el **origen (upstream)** sigue siendo la red Docker: **`http://bichipishi:3001`** (producción) o **`http://bichipishi:4322`** (local / HMR) — **no** uses `127.0.0.1:8080` ahí.

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

Copia **`.env.example`** → **`.env`**. Para una tabla orientada a despliegue (Docker, túnel, producción), usa también **[docs/DESPLEGUE.md](docs/DESPLEGUE.md)**. Incluye:

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
