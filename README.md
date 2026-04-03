# Bichipishi — dashboard de métricas

Interfaz estática (**Astro**) + **API Node** (`metrics-api`) que lee el sistema real (CPU, RAM, procesos, Docker opcional, tareas programadas). Funciona en **Windows, macOS y Linux**.

**Repositorio público:** [github.com/webcvalejandropina-ui/bichipishimockopenclaw](https://github.com/webcvalejandropina-ui/bichipishimockopenclaw)

---

## Cómo obtener el código

```bash
git clone https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
cd bichipishimockopenclaw
```

Si aún no tienes el remoto en tu copia local:

```bash
git remote add origin https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
git branch -M main
git push -u origin main
```

*(Sustituye por tu flujo si usas SSH o fork.)*

---

## Qué necesitas para que “funcione”

| Objetivo | Qué hacer |
|----------|-----------|
| **Todo el dashboard con datos reales** (recomendado) | **Docker Compose** (UI + API en el mismo stack) **o** **desarrollo local** con `pnpm dev` (Astro + API). |
| **Solo ver la web estática** sin tu API | `pnpm run build` y servir `dist/`; las métricas mostrarán errores de conexión salvo que configures otra API (ver abajo). |
| **Web en HTTPS + API en otro servidor** | Al construir, define `PUBLIC_BICHI_API_URL` con la URL **HTTPS** base de tu API (sin `/` final). |

---

## Requisitos previos

- **Docker** (opción fácil): [Docker](https://docs.docker.com/get-docker/) + Compose v2.
- **Solo Node** (desarrollo): Node **≥ 18.17** y **pnpm** (`npm install -g pnpm` o [pnpm.io](https://pnpm.io/installation)).

---

## Opción A — Docker (una orden, cualquier SO)

```bash
docker compose up --build
```

- **Interfaz:** [http://localhost:8080](http://localhost:8080) (Nginx + proxy a `/api`).
- **API directa:** [http://localhost:3001/api/metrics](http://localhost:3001/api/metrics).

El servicio `metrics` monta **`config/cron.extra`** (sintaxis crontab). Edítalo en tu máquina y reinicia el contenedor `metrics` si cambias las tareas.

---

## Opción B — Desarrollo local (sin Docker)

```bash
cp .env.example .env
pnpm install
cd metrics-api && npm install && cd ..
pnpm dev
```

- **Astro:** [http://localhost:4322](http://localhost:4322) (proxy `/api` → API).
- **API:** puerto **3001** (ajustable en `.env` con `BICHI_API_PORT` / `PUBLIC_BICHI_API_PORT`).

Opcional en `.env`: `CRON_EXTRA_FILE=config/cron.extra` (mismo criterio que en Docker).

**Sin pnpm:** instálalo globalmente o usa `corepack enable` (Node 16+) y luego `corepack prepare pnpm@latest --activate`.

---

## Subir solo la carpeta `dist/` (sitio estático)

```bash
pnpm install
pnpm run build
```

Publica el contenido de **`dist/`** en tu hosting (Git del repo, artefacto de CI, o subida manual). Si la web va por **HTTPS** y la API está en **otro dominio HTTPS**, configura en el build la variable **`PUBLIC_BICHI_API_URL`**.

No subas **`.env`** ni **`metrics-api/data/`** al repositorio (están en `.gitignore`).

---

## SQLite: rendimiento histórico y retención

La API guarda un resumen **por día del servidor** en SQLite:

| Detalle | Valor |
|--------|--------|
| **Fichero** | `metrics-api/data/perf.sqlite` |
| **Motor** | `better-sqlite3`, journal **WAL** |
| **Tabla** | `perf_daily` (una fila por día `YYYY-MM-DD`) |
| **Escritura** | Cada **`GET /api/metrics`** acumula muestras del día |
| **Lectura** | **`GET /api/perf/daily?days=N`** |
| **Retención** | Se eliminan días anteriores a **hoy − 120** |

En Docker, monta un volumen en `metrics-api/data` si quieres conservar el histórico al recrear contenedores.

---

## Tareas programadas (cron)

Solo lectura: la API **no ejecuta** ni edita cron.

| Entorno | Fuentes |
|--------|---------|
| API en el **host** | `crontab -l`, `/etc/crontab`, **`CRON_EXTRA_FILE`** |
| **Docker** (este repo) | **`config/cron.extra`** en `/app/cron.extra` |
| **Windows** (host) | Tareas programadas (PowerShell) + `CRON_EXTRA_FILE` opcional |

---

## Estructura del repo

- `config/cron.extra` — tareas extra (editable).  
- `docker-compose.yml` — stack UI + API.  
- `metrics-api/` — servidor HTTP, SQLite, lectura del sistema.  
- `.env.example` — variables de ejemplo.  
- `public/_headers` — cabeceras HTTP en hosts compatibles (p. ej. Cloudflare Pages).

---

## API expuesta en Internet (opcional)

Si publicas **`metrics-api`** en la red, revisa en el servidor: **`BICHI_CORS_ORIGIN`**, **`BICHI_DISABLE_SETTINGS_WRITE`** y documentación en **`metrics-api/server.js`** / `.env.example`. El endpoint `/api/metrics` refleja datos del **host donde corre la API**.
