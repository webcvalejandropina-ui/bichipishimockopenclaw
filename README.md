# Bichipishi — dashboard de métricas

Interfaz estática (**Astro**) + **API Node** (`metrics-api`) que lee el sistema real (CPU, RAM, disco, procesos, Docker opcional, tareas programadas, alertas). Funciona en **Windows, macOS y Linux**.

**Repositorio:** [github.com/webcvalejandropina-ui/bichipishimockopenclaw](https://github.com/webcvalejandropina-ui/bichipishimockopenclaw)

---

## Inicio rápido

| Entorno | Una orden (desde la raíz del repo) | URLs |
|--------|-------------------------------------|------|
| **Docker (Linux / macOS / WSL)** | `sh scripts/install.sh` o `./scripts/install.sh` o `make install && make up` | UI: **http://localhost:8080** · API: **http://localhost:3001** |
| **Docker (Windows)** | En PowerShell: `.\scripts\install.ps1` (Docker Desktop) | Igual |
| **Docker (manual)** | `cp .env.example .env` → `docker compose up --build -d` | Igual |
| **Desarrollo (hot reload)** | Ver [Desarrollo local](#desarrollo-local) o `make dev` | UI: **http://localhost:4322** · API: **3001** |

El ecosistema Docker incluye **dos servicios** (`web` + `metrics`), volumen persistente para datos de la API, healthcheck y proxy **Nginx `/api` → `metrics`**, sin CORS entre puertos en el uso típico.

### Cualquier sistema operativo (distribución)

La forma **recomendada** en Ubuntu, Debian, Fedora, Arch, openSUSE, Raspberry Pi OS, macOS y Windows es **Docker** (misma `docker-compose.yml`, mismas imágenes). No dependes de la versión concreta del kernel salvo tener un runtime compatible:

- **Linux:** [Docker Engine](https://docs.docker.com/engine/install/) o [Podman](https://podman.io/) con alias `docker` (opcional). El script `scripts/install.sh` usa **POSIX `sh`** y detecta `docker compose` (v2) o `docker-compose` (legado).
- **macOS:** [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/).
- **Windows:** [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) y `.\scripts\install.ps1`, o **WSL2** + Docker y entonces `sh scripts/install.sh` desde la distro.
- **Móvil / tablet:** la interfaz es **responsive** (viewport seguro, menú lateral, rejillas y tablas con scroll horizontal donde hace falta). Instala en un servidor o PC y accede por el navegador del dispositivo.

### Marca: nombre y avatar

En **`.env`** (también leído por Compose al construir y arrancar):

| Variable | Efecto |
|----------|--------|
| `PUBLIC_BICHI_APP_NAME` | Texto del menú, título del documento, fallback del perfil del dashboard, prefijo de asuntos en correos de la API (`metrics`), demo OpenClaw. Por defecto: `Bichipishi`. |
| `PUBLIC_BICHI_AVATAR_URL` | URL de imagen que sustituye la piña en la tarjeta de perfil del dashboard. Vacío = piña por defecto. |

- **Desarrollo:** edita `.env` y reinicia `pnpm dev`.
- **Docker:** los **build args** del servicio `web` toman los mismos valores del `.env` (primera imagen). Si solo cambias nombre o avatar **sin** querer reconstruir la imagen, basta con ajustar las variables en `.env` y **reiniciar el contenedor `web`**: el arranque regenera `bichi-brand.js` en Nginx. Si cambias también textos compilados en HTML, ejecuta `docker compose build web` (o `make build-web`).
- **API:** Compose pasa `BICHI_APP_NAME` al servicio `metrics` a partir de `PUBLIC_BICHI_APP_NAME` para mantener un solo nombre en todo el stack.

---

## Requisitos

- **Docker + Compose** (`docker compose` v2 preferido; el script `install.sh` admite también `docker-compose`).
- **Solo Node** (dev): **Node ≥ 18.17** y **pnpm** (`corepack enable` + `corepack prepare pnpm@latest --activate`, o `npm install -g pnpm`).

---

## Desarrollo local

Objetivo: Astro con recarga en vivo + API en paralelo.

```bash
git clone https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
cd bichipishimockopenclaw
cp .env.example .env
pnpm install
cd metrics-api && npm install && cd ..
pnpm dev
```

- **Interfaz:** http://localhost:4322 (Vite proxy `/api` → API).
- **API:** puerto **3001** (cámbialo en `.env` con `BICHI_API_PORT` y **`PUBLIC_BICHI_API_PORT` al mismo valor**).

**Cron extra (opcional):** en `.env` puedes poner `CRON_EXTRA_FILE=config/cron.extra` (mismo criterio que en Docker).

**Sin pnpm:** instálalo globalmente o usa `corepack` como arriba.

---

## Producción con Docker Compose

Objetivo: mismo stack en cualquier servidor o en tu máquina.

```bash
docker compose up --build -d
```

| Servicio | Puerto host | Uso |
|----------|-------------|-----|
| **web** | **8080** → 80 | Dashboard; `/api/*` va al servicio `metrics`. |
| **metrics** | **3001** | API JSON (opcional exponer; la UI ya proxifica vía Nginx). |

**Datos persistentes:** el `docker-compose.yml` del repo ya monta el volumen **`bichi-api-data` → `/app/data`** (SQLite de rendimiento, `settings.json`, etc.), así que no pierdes historial al recrear el contenedor `metrics`. Para ver los ficheros en el host, cambia a un bind mount, por ejemplo `- ./metrics-api-data:/app/data`.

La API escribe en **`/app/data`** dentro del contenedor (`metrics-api/server.js`).

**Variables útiles en producción** (Compose `environment:` o fichero `.env` leído por Compose):

| Variable | Cuándo usarla |
|----------|----------------|
| `BICHI_MEM_TOTAL_GIB=8` | API en contenedor: la RAM “total” del cgroup no coincide con la RAM real del host. |
| `BICHI_SKIP_PUBLIC_IP=1` | No llamar a servicios externos para IP pública. |
| `BICHI_CORS_ORIGIN=https://tudominio.com` | Si sirves la web y la API en **orígenes distintos** sin proxy. |
| `BICHI_DISABLE_SETTINGS_WRITE=1` | API expuesta: desactiva escritura de ajustes por API. |

Más opciones en **`.env.example`** y comentarios en **`docker-compose.yml`**.

---

## Producción sin Docker (build estático + API)

1. **Build de la web**

   ```bash
   pnpm install
   pnpm run build
   ```

   Salida: carpeta **`dist/`**. Súbela a cualquier hosting estático (Nginx, Caddy, S3+CDN, Pages, etc.).

2. **API en el servidor**

   ```bash
   cd metrics-api && npm ci --omit=dev && node server.js
   ```

   O proceso gestionado (systemd, PM2, etc.) con `NODE_ENV=production` y `BICHI_API_PORT` si hace falta.

3. **Conectar web y API**

   - **Mismo origen:** configura el proxy del servidor web para que **`/api` → `http://127.0.0.1:3001`** (equivalente al `default.conf` de este repo).
   - **Orígenes distintos (HTTPS):** en el **build** de Astro define `PUBLIC_BICHI_API_URL=https://api.tudominio.com` (sin `/` final). En la API, `BICHI_CORS_ORIGIN` con el origen de la web.

No subas **`.env`** ni **`metrics-api/data/`** al repositorio (`.gitignore`).

---

## Variables de entorno (referencia)

Copia **`.env.example`** → **`.env`** para desarrollo. En Docker, Compose lee el `.env` de la raíz del proyecto para **sustitución** en `docker-compose.yml` (build args y `environment`).

Incluye **marca** (`PUBLIC_BICHI_APP_NAME`, `PUBLIC_BICHI_AVATAR_URL`); ver la tabla en [Marca: nombre y avatar](#marca-nombre-y-avatar).

| Variable | Descripción |
|----------|-------------|
| `BICHI_API_PORT` | Puerto de la API (default 3001). |
| `PUBLIC_BICHI_API_PORT` | Mismo valor que `BICHI_API_PORT` para el proxy de Astro en dev. |
| `PUBLIC_BICHI_API_URL` | URL base HTTPS de la API si la web está en otro dominio (solo build). |
| `BICHI_MEM_TOTAL_GIB` | Fija RAM total en GiB (útil en Docker/cgroup). |
| `BICHI_SKIP_PUBLIC_IP` | `1` = no resolver IP pública por Internet. |
| `BICHI_CORS_ORIGIN` | Origen permitido CORS (producción con orígenes separados). |
| `BICHI_DISABLE_SETTINGS_WRITE` | `1` = no escribir ajustes vía API. |
| `CRON_EXTRA_FILE` | Ruta a fichero estilo crontab extra. |

---

## SQLite: rendimiento histórico

| Detalle | Valor |
|--------|--------|
| **Fichero** | `metrics-api/data/perf.sqlite` |
| **Lectura** | `GET /api/perf/daily?days=N` |
| **Escritura** | Se actualiza en el flujo de métricas del host |

En Docker, monta un volumen para **`data`** si quieres conservar el histórico al recrear el contenedor.

---

## Tareas programadas (cron)

Solo **lectura**: la API no ejecuta ni modifica el cron del sistema.

| Entorno | Fuentes |
|--------|---------|
| API en el **host** | `crontab -l`, `/etc/crontab`, `CRON_EXTRA_FILE` |
| **Docker (este repo)** | `config/cron.extra` montado en `/app/cron.extra` |
| **Windows** | Tareas programadas (PowerShell) + `CRON_EXTRA_FILE` opcional |

---

## Estructura del repo

| Ruta | Contenido |
|------|-----------|
| `src/` | Astro: dashboard, páginas, estilos. |
| `metrics-api/` | Servidor Node: `/api/metrics`, SQLite, sistema. |
| `docker/` | `Dockerfile.web`, Nginx `default.conf`. |
| `docker-compose.yml` | Stack **web + metrics**. |
| `.env.example` | Plantilla de variables. |
| `config/cron.extra` | Cron extra editable (Docker). |
| `public/_headers` | Cabeceras en hosts compatibles (p. ej. Cloudflare Pages). |

---

## Código y push (referencia)

```bash
git clone https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
cd bichipishimockopenclaw
# … cambios …
git add -A && git commit -m "…" && git push origin main
```

---

## Solución de problemas breve

- **La web no muestra métricas:** comprueba que la API responde (`/api/metrics`) y que en dev `PUBLIC_BICHI_API_PORT` coincide con el puerto real.
- **RAM “rara” en Docker:** define `BICHI_MEM_TOTAL_GIB` según la RAM física del host.
- **Solo web estática sin API:** el dashboard mostrará fallos de conexión hasta que exista una API accesible o `PUBLIC_BICHI_API_URL` correcta en el build.

---

## API en Internet

Si expones **`metrics-api`** públicamente, usa **`BICHI_CORS_ORIGIN`**, **`BICHI_DISABLE_SETTINGS_WRITE`** y, si aplica, **`BICHI_SETTINGS_TOKEN`**. Los datos reflejan **solo el host donde corre la API**.
