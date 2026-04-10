# Guía de despliegue — Bichipishi

Esta guía está pensada para que **cualquier persona con acceso a un servidor o a su propio equipo** pueda poner en marcha Bichipishi: primero sin contenedores (lo más directo) y, si lo necesitas, con **Docker** y opcionalmente un **Cloudflare Tunnel** para publicar HTTPS sin abrir puertos en el router.

**Qué obtienes al terminar:** una única URL (o `http://IP:puerto`) donde la interfaz web y la API (`/api/*`) comparten el **mismo origen y puerto** (por defecto **3001**).

---

## Tabla de contenidos

1. [Requisitos previos](#1-requisitos-previos)
2. [Obtener el código y el fichero de entorno](#2-obtener-el-código-y-el-fichero-de-entorno)
3. [Despliegue sin Docker (Bun o Node)](#3-despliegue-sin-docker-bun-o-node)
4. [Despliegue con Docker](#4-despliegue-con-docker) — perfiles **production** y **local** (Bun + Astro; motivos en [PAQUETES.md](PAQUETES.md))
5. [Cloudflare Tunnel (HTTPS público sin puertos abiertos)](#5-cloudflare-tunnel-https-público-sin-puertos-abiertos)
6. [Variables de entorno importantes](#6-variables-de-entorno-importantes)
7. [Seguridad en producción](#7-seguridad-en-producción)
8. [Datos persistentes y copias de seguridad](#8-datos-persistentes-y-copias-de-seguridad)
9. [Actualizar a una nueva versión](#9-actualizar-a-una-nueva-versión)
10. [Solución de problemas](#10-solución-de-problemas)
11. [Otros métodos (Caddy, proxy inverso)](#11-otros-métodos-caddy-proxy-inverso)

---

## 1. Requisitos previos

| Entorno | Qué necesitas |
|---------|----------------|
| **Sin Docker** | [Bun](https://bun.sh) 1.1+ *o* [Node.js](https://nodejs.org) **≥ 18.20.8** (recomendado LTS 20). |
| **Con Docker** | [Docker Engine](https://docs.docker.com/engine/install/) (24+ recomendado) y el plugin **Docker Compose V2** (`docker compose version` debe funcionar). |
| **Cloudflare Tunnel** | Cuenta en [Cloudflare](https://www.cloudflare.com); el **dominio** debe estar gestionado en esa cuenta (nameservers de Cloudflare o DNS compatible). |
| **Perfil Docker `full-host`** | **Sistema operativo Linux** en la máquina donde corre Docker (VPS, bare metal). No esperes el mismo comportamiento en **Docker Desktop** (macOS/Windows): los montajes y `pid: host` no equivalen a un servidor Linux real. |

**Conocimientos mínimos:** abrir una terminal, editar un fichero de texto (`.env`), ejecutar comandos `git`, `docker compose` o **bun** / **pnpm** (no usamos npm en los flujos documentados; ver [PAQUETES.md](PAQUETES.md)), y (si usas túnel) navegar el panel de Cloudflare.

---

## 2. Obtener el código y el fichero de entorno

```bash
git clone https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
cd bichipishimockopenclaw
cp .env.example .env
```

Edita **`.env`** con un editor de texto. Los valores mínimos para empezar suelen ser los que ya vienen de ejemplo (puerto **3001**). Más adelante [ajustarás URLs y seguridad](#6-variables-de-entorno-importantes).

> **Importante:** no subas **`.env`** a git ni lo compartas públicamente; contiene o puede contener secretos.

---

## 3. Despliegue sin Docker (Bun o Node)

Es el flujo recomendado en tu **propio PC** o en un servidor donde puedas instalar Bun/Node sin contenedor.

### 3.1 Con Bun (recomendado en el repo)

```bash
bun install
bun run deploy
```

Este comando:

1. Instala dependencias en la raíz y en el workspace `metrics-api`.
2. Genera el sitio estático de Astro en **`dist/`**.
3. Migra datos antiguos de `metrics-api/data/` a **`data/`** si hace falta.
4. Arranca **un solo proceso** que sirve `dist/` y la API en el puerto definido por `BICHI_API_PORT` (por defecto **3001**).

Abre en el navegador: **http://127.0.0.1:3001/** (o la IP del servidor en red, p. ej. `http://192.168.1.10:3001/`).

### 3.2 Solo arrancar la API (si ya hiciste el build antes)

```bash
bun start
```

Equivale a ejecutar la API desde `metrics-api/`; necesitas **`dist/`** generado previamente (`bun run build:astro`).

### 3.3 Con Node + pnpm (sin Bun)

Requiere **pnpm** (p. ej. `corepack enable` y la versión indicada en `package.json` → `packageManager`).

```bash
pnpm install
pnpm run deploy:node
```

Si mezclaste antes **`bun install`** y **`pnpm install`** en el mismo clon, borra **`node_modules`** (y en workspace `metrics-api/` si aplica) y vuelve a instalar solo con pnpm. Detalle: [PAQUETES.md](PAQUETES.md).

### 3.4 Desarrollo (no es producción)

```bash
bun run dev
```

- Front en caliente: suele ser **http://localhost:4322**
- La API sigue en el puerto de `.env` (p. ej. **3001**); Vite reenvía `/api` a la API.

---

## 4. Despliegue con Docker

El repositorio incluye un **`Dockerfile`** (multi-etapa, imagen base **`oven/bun`**) y un **`docker-compose.yml`** con **perfiles**. La imagen resultante ejecuta **`bun server.js`** en `metrics-api/` con `dist/` y dependencias ya instaladas con **`bun install --frozen-lockfile`** (lockfile **`bun.lock`**).

### 4.0 Producción y desarrollo en Docker (Bun + Astro)

Compose distingue dos modos que replican lo que harías **sin** Docker. El **flujo de despliegue es el mismo** en ambos: `.env` → un comando `docker:up*` → URL; mismos volúmenes de datos; mismo patrón para añadir el túnel (`docker:up:tunnel` / `docker:up:local:tunnel`). Solo cambian la imagen, los puertos expuestos y si la UI va por **un puerto** (prod) o por **Astro dev + HMR** (local).

| Perfil | Imagen | Uso | URL típica |
|--------|--------|-----|------------|
| **`production`** (alias **`web-only`**) | `Dockerfile` | Build estático de Astro + API en **un solo puerto** (despliegue “real”). | **http://127.0.0.1:3001/** |
| **`local`** | `Dockerfile.dev` | **`bun run dev`**: servidor Astro **:4322** + API **:3001** (Vite proxy `/api`), fuentes montadas para **HMR**. | UI: **http://127.0.0.1:4322/** · API directa: **:3001** |

**Producción (por defecto en los scripts):**

```bash
bun run docker:up
# equivalente explícito:
bun scripts/docker-local.mjs up production
make docker-up
```

**Desarrollo en contenedor (mismo stack que `bun run dev` en el host):**

```bash
bun run docker:up:local
# o:
make docker-up-local
```

**Mismo esquema con Cloudflare Tunnel** (tras poner **`TUNNEL_TOKEN`** en `.env`; ver [§ 5](#5-cloudflare-tunnel-https-público-sin-puertos-abiertos)):

```bash
bun run docker:up:tunnel          # production + tunnel
bun run docker:up:local:tunnel    # local + tunnel
make docker-up-tunnel
make docker-up-local-tunnel
```

Si activas el perfil **`tunnel`** con estos comandos, el script fija por defecto **`BICHI_PUBLISH=8080`** (producción / `full-host`) y **`BICHI_DEV_API=8080`** (perfil **`local`**) cuando no vienen definidos en el entorno: así el acceso desde el **host** es **http://127.0.0.1:8080** hacia la API, sin ocupar **3001** en el anfitrión. **Cloudflare** sigue usando el origen interno **`http://bichipishi:3001`** o **`http://bichipishi:4322`** (no el 8080 del host). Para otro puerto en el host, define **`BICHI_PUBLISH`** / **`BICHI_DEV_API`** en **`.env`**.

Qué hace `scripts/docker-local.mjs`:

1. Si no existe **`.env`**, copia **`.env.example`** → **`.env`**.
2. Lanza Compose con el perfil indicado (`production` por defecto en `docker:up`). Todo el pipeline usa **Bun** y **Astro** según el `Dockerfile` correspondiente; ver [PAQUETES.md](PAQUETES.md).

| Comando | Efecto |
|---------|--------|
| `bun run docker:up` / `make docker-up` | Build + arranque perfil **`production`**. |
| `bun run docker:up:local` / `make docker-up-local` | Build + arranque perfil **`local`** (Astro dev + API). |
| `bun run docker:up:tunnel` / `make docker-up-tunnel` | **`production`** + **`tunnel`**; host **:8080**→contenedor por defecto. |
| `bun run docker:up:local:tunnel` / `make docker-up-local-tunnel` | **`local`** + **`tunnel`**; API en host **:8080** por defecto. |
| `bun run docker:down` / `make docker-down` | `docker compose down --remove-orphans` (todo el proyecto). |
| `bun run docker:logs` / `make docker-logs` | Logs (por defecto perfil `production`; pasa perfiles extra si hace falta). |
| `bun run docker:logs:local` / `make docker-logs-local` | Logs perfil **`local`**. |

**Host Linux con métricas reales (producción en servidor):**

```bash
bun scripts/docker-local.mjs up full-host
```

Si Docker devuelve **conflicto de nombre** de contenedor, para y vuelve a subir:

```bash
bun run docker:down
bun run docker:up
```

> **Nota:** `full-host` en macOS/Windows con Docker Desktop no equivale a un servidor Linux. No levantes **`production`** y **`local`** a la vez si comparten el puerto **3001** en el host (cambia `BICHI_DEV_API` / `BICHI_PUBLISH` en `.env`).

### 4.1 Construir la imagen

En la raíz del repositorio:

```bash
docker compose build
```

La primera vez puede tardar varios minutos (descarga de capas, `bun install` en el build de la imagen, compilación de dependencias nativas como `better-sqlite3`, build de Astro).

### 4.2 Perfil `production` / `web-only` (contenedor aislado, despliegue)

**Cuándo usarlo:** entorno similar a **producción**: `dist/` servido por la API, un solo puerto público. Métricas ≈ **contenedor** salvo que uses **`full-host`**.

```bash
docker compose --profile production up -d
# alias equivalente (mismo servicio en compose):
docker compose --profile web-only up -d
```

- **Puerto en el anfitrión:** por defecto **3001** → **http://127.0.0.1:3001/**
- Para cambiar el puerto del host sin tocar el interno: variable **`BICHI_PUBLISH`** (p. ej. `BICHI_PUBLISH=8080` mapea `8080:3001`).
- **Socket Docker:** se monta **`/var/run/docker.sock`** del host (igual que en el perfil **`local`**), de modo que la página **Docker** de la UI puede listar contenedores del motor. Quien despliegue debe aceptar ese nivel de acceso al daemon.

Comprobar:

```bash
docker compose --profile production ps
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/
```

Deberías ver código **200**.

**Limitación:** CPU, RAM, disco y procesos mostrados serán los del **cgroup del contenedor**, no los del host completo. La propia API puede mostrar un aviso en ese sentido.

### 4.3 Perfil `local` (Astro en modo dev dentro de Docker)

**Cuándo usarlo:** quieres **HMR** y el mismo flujo que **`bun run dev`** pero todo orquestado por Compose (Bun + Astro + Vite + API).

```bash
docker compose --profile local up -d --build
```

- **URLs:** **http://127.0.0.1:4322/** (interfaz con proxy `/api`) y API directa en **http://127.0.0.1:3001/** (ajusta con **`BICHI_DEV_ASTRO`** y **`BICHI_DEV_API`** en `.env` si hay conflicto de puertos).
- Se montan `src/`, `public/`, `metrics-api/`, `config/`, `scripts/` y ficheros raíz clave; **`node_modules`** permanece en la imagen (`Dockerfile.dev`). Si cambias dependencias en `package.json` / `bun.lock`, vuelve a construir: `docker compose --profile local build`.
- Se monta **`/var/run/docker.sock`** del host para que la API pueda listar contenedores (**paridad** con el servicio **`production`**, que también monta el socket). La imagen incluye **`procps`** (`ps`) para que `concurrently` pueda cerrar procesos al salir.
- La **interfaz** está en **:4322**; la raíz **:3001** puede responder **404** si no has generado `dist/` (normal en dev: usa la URL de Astro).

### 4.4 Perfil `full-host` (acceso al sistema anfitrión, Linux)

**Cuándo usarlo:** quieres monitorizar y operar sobre un **Linux** real (VPS, servidor físico) desde un contenedor, acercándote a lo que obtendrías ejecutando la API directamente en el SO.

```bash
docker compose --profile full-host up -d
```

Este perfil activa (entre otras cosas):

- **`pid: host`**: el proceso ve el espacio de PIDs del anfitrión.
- **`privileged: true`**: privilegios elevados (necesario para muchas operaciones de sistema desde contenedor; **reduce el aislamiento** respecto al host).
- Montaje de **`/`** en **`/host:ro`** (lectura de la raíz del sistema).
- Socket **`/var/run/docker.sock`** para que el cliente `docker` de la imagen hable con el motor del host.
- Rutas típicas de **systemd** y **D-Bus** para intentar que `systemctl` y servicios relacionados sean utilizables.

Variable relevante: **`BICHI_HOST_DISK_ROOT=/host`** (ya definida en Compose para este servicio).

**Advertencias:**

- Equivale a un panel de administración **muy potente**; no lo expongas a Internet sin [medidas de seguridad](#7-seguridad-en-producción).
- En **Docker Desktop** (Mac/Windows) el resultado **no** es equivalente a un Linux servidor: el “host” visto por Docker no es tu escritorio de la misma forma.

### 4.5 Volúmenes y nombre del servicio

- Los datos de aplicación (SQLite de rendimiento, `settings.json`, etc.) van al volumen Docker **`bichipishi_data`**, montado en **`/data`** dentro del contenedor (`BICHI_DATA_DIR=/data`).
- Los servicios de la app comparten el alias de red **`bichipishi`** (útil para el túnel, ver siguiente sección).

### 4.6 Parar y ver logs

```bash
docker compose --profile production logs -f
docker compose --profile local logs -f
# parar todo el proyecto:
docker compose down --remove-orphans
```

---

## 5. Cloudflare Tunnel (HTTPS público sin puertos abiertos)

El túnel crea una conexión **saliente** desde tu servidor hacia Cloudflare. **No** necesitas redirigir puertos en el router para el tráfico web HTTPS.

### 5.1 Requisitos

- Cuenta Cloudflare con el **dominio** añadido.
- **Docker Compose** en el mismo servidor donde ya funciona Bichipishi (o donde vas a levantarlo).
- Perfil Compose **`tunnel`** además del de la app (`production`, `local` o `full-host`).

### 5.2 Obtener el token del conector

1. Entra en [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) (antes “Zero Trust”).
2. Ve a **Networks** → **Tunnels**.
3. **Create a tunnel** (o elige un túnel existente).
4. Pon un nombre al túnel y continúa hasta el paso de instalar el conector.
5. Elige **Docker** como método; Cloudflare mostrará un comando parecido a `docker run ...` con un **`--token`** largo. **Copia solo el valor del token** (la cadena tras `--token`).

### 5.3 Configurar el fichero `.env` en el servidor

Añade (o descomenta) en **`.env`**:

```env
TUNNEL_TOKEN=pega_aqui_el_token_completo
```

Sin comillas salvo que el propio token las requiera (lo habitual es una sola línea sin espacios).

### 5.4 Arrancar la aplicación y cloudflared

**Ejemplo con `production` + túnel:**

```bash
bun run docker:up:tunnel
# manual (mismo puerto en el host que el script: 8080 → API en contenedor):
BICHI_PUBLISH=8080 docker compose --profile production --profile tunnel up -d
```

**Ejemplo con `local` + túnel** (misma idea que `production`, distinto origen HTTP interno):

```bash
bun run docker:up:local:tunnel
# manual:
BICHI_DEV_API=8080 docker compose --profile local --profile tunnel up -d --build
```

**Ejemplo con `full-host` + túnel:**

```bash
bun scripts/docker-local.mjs up full-host tunnel
# manual:
BICHI_PUBLISH=8080 docker compose --profile full-host --profile tunnel up -d
```

El servicio **`cloudflared`** usa la imagen oficial `cloudflare/cloudflared` y la variable **`TUNNEL_TOKEN`**. Comparte red Docker con Bichipishi.

### 5.5 Enlazar un hostname público con el contenedor (paso crítico)

En el panel del túnel (Cloudflare Zero Trust → tu túnel → **Public Hostname** o asistente de configuración):

1. Crea una entrada **Public hostname**: por ejemplo `bichipishi` como subdominio y tu dominio `tudominio.com`.
2. **Service type:** **HTTP** (no HTTPS hacia el origen; el cifrado lo hace el cliente ↔ Cloudflare).
3. **URL (origen / upstream):** debe apuntar al servicio Docker por **nombre DNS interno de Compose**:

   **`http://bichipishi:3001`**

   Sustituye **3001** si cambiaste **`BICHI_API_PORT`** en `.env`.

   No uses `http://127.0.0.1:3001` aquí: desde el contenedor `cloudflared`, `127.0.0.1` sería el propio cloudflared, no la app.

   Si enlazas el perfil **`local`** (Astro en dev), el origen suele ser **`http://bichipishi:4322`** (puerto del servidor Vite/Astro dentro de la red Compose). El **8080** que ves en la documentación del script es solo el **mapeo en tu máquina** para probar la API en el host; **no** lo pongas como URL de origen en Zero Trust.

4. Guarda la configuración. Cloudflare suele crear o sugerir el registro **DNS** (CNAME) hacia el túnel; espera unos minutos a que propague.

### 5.6 Alinear la aplicación con HTTPS

Cuando accedas por **`https://bichipishi.tudominio.com`**, define en **`.env`** (y vuelve a levantar los contenedores si hace falta):

```env
PUBLIC_BICHI_SITE_URL=https://bichipishi.tudominio.com
BICHI_CORS_ORIGIN=https://bichipishi.tudominio.com
```

Así la UI y CORS coinciden con el origen real del navegador.

### 5.7 Comprobar el túnel

- En el panel del túnel debería figurar el conector **healthy** (conectado).
- Abre el dominio en el navegador; debe cargar la interfaz.
- Si ves **502** u otro error de origen, revisa que la URL interna sea exactamente **`http://bichipishi:<puerto>`** y que el contenedor de la app esté en marcha (`docker compose ps`).

---

## 6. Variables de entorno importantes

La referencia completa está comentada en **`.env.example`** y en comentarios de **`metrics-api/server.js`**. Resumen para despliegue:

| Variable | Uso típico |
|----------|------------|
| `BICHI_API_PORT`, `PORT` | Puerto donde escucha la API (y la web estática) en el contenedor o proceso. |
| `PUBLIC_BICHI_API_PORT` | Debe coincidir con el puerto expuesto a la UI si la usas en cliente. |
| `PUBLIC_BICHI_SITE_URL` | URL canónica del sitio (importante detrás de HTTPS / túnel). |
| `BICHI_CORS_ORIGIN` | Origen permitido CORS; en producción con un solo dominio, suele ser ese mismo URL `https://...`. |
| `BICHI_DATA_DIR` | Carpeta de datos; en Docker Compose va a **`/data`** (volumen). |
| `BICHI_SETTINGS_TOKEN` | Si lo defines, los POST sensibles de ajustes pueden exigir cabecera `Authorization: Bearer ...`. |
| `BICHI_HOST_ACTION_TOKEN` / `BICHI_SETTINGS_TOKEN` | Control de acciones sobre procesos/servicios (ver código y `.env.example`). |
| `BICHI_DISABLE_SETTINGS_WRITE`, `BICHI_DISABLE_HOST_ACTIONS` | Desactivar escritura o acciones de host en entornos expuestos. |
| `TUNNEL_TOKEN` | Token del conector Cloudflare (solo perfil **`tunnel`**). |
| `BICHI_PUBLISH` | Puerto del **host** en el mapeo `host:contenedor` (Compose). Por defecto **3001**; con **`bun run docker:up:tunnel`** / **`full-host` + túnel** el script usa **8080** si no lo defines. |
| `BICHI_DEV_API` | Solo perfil **`local`**: puerto del **host** hacia la API. Por defecto **3001**; con **`docker:up:local:tunnel`** el script usa **8080** si no lo defines. |

---

## 7. Seguridad en producción

1. **No expongas `full-host` a Internet** sin autenticación fuerte: valora **Cloudflare Access**, VPN, o restricción por IP en el firewall de Cloudflare.
2. Define **`BICHI_SETTINGS_TOKEN`** y/o **`BICHI_HOST_ACTION_TOKEN`** y usa cabeceras según documenta la API.
3. Activa **`BICHI_DISABLE_HOST_ACTIONS=1`** o **`BICHI_DISABLE_SETTINGS_WRITE=1`** si solo necesitas lectura.
4. Mantén **TLS** en el borde (Cloudflare lo hace; si usas otro proxy, configura HTTPS allí).
5. Revisa periódicamente **actualizaciones** de dependencias y de la imagen base Node.

---

## 8. Datos persistentes y copias de seguridad

- **Sin Docker:** la carpeta **`data/`** en la raíz del repo (o la ruta de `BICHI_DATA_DIR`).
- **Con Docker:** volumen nombrado **`bichipishi_data`** → contenido en **`/data`** dentro del contenedor.

Para inspeccionar el volumen:

```bash
docker volume inspect bichipishi_data
```

Haz copias de seguridad de los ficheros importantes (`perf.sqlite*`, `settings.json`) antes de actualizaciones arriesgadas.

---

## 9. Actualizar a una nueva versión

```bash
git pull
```

**Sin Docker:** vuelve a ejecutar `bun run deploy` (o `pnpm run deploy:node` si usas solo Node + pnpm).

**Con Docker:**

```bash
docker compose build --no-cache
docker compose --profile production up -d
# o full-host + tunnel según tu caso
```

Los datos en el volumen **`bichipishi_data`** se conservan si no borras el volumen.

---

## 10. Solución de problemas

| Síntoma | Qué comprobar |
|---------|----------------|
| **Puerto en uso** | Cambia `BICHI_API_PORT` en `.env` y/o `BICHI_PUBLISH` en Docker; libera el puerto en el SO (`ss -lntp`, `netstat`, etc.). |
| **`cloudflared` reinicia o error de token** | `TUNNEL_TOKEN` correcto, sin espacios extra; túnel no eliminado en Cloudflare. |
| **502 / Bad Gateway en el dominio** | En Zero Trust, la URL de origen debe ser **`http://bichipishi:PUERTO`**; contenedor de la app **running** y sano (`docker compose ps`, logs). |
| **Métricas “no son tu máquina”** | Estás en **`production`** sin montajes de host; cambia a **`full-host`** en Linux o ejecuta la API **sin Docker** en el host. |
| **Docker desde el contenedor falla** | Perfil **`full-host`**, socket montado; usuario con permiso sobre el socket en el host. |
| **Build Docker falla en `bun install`** | Red estable; si falla `better-sqlite3`, suele ser falta de toolchain en builder (el Dockerfile ya instala `python3 make g++`). Comprueba que **`bun.lock`** esté al día con `package.json`. |
| **OpenClaw en otra máquina “no va”** | Es normal si no instalaste el CLI: el resto de Bichipishi no depende de él. Opciones: **`OPENCLAW_BIN`** con ruta absoluta al binario, **`OPENCLAW_LOG_PATH`** si tienes log, **`OPENCLAW_FORCE=0`** para no marcar disponibilidad en métricas, o ignora la página OpenClaw. La API devuelve JSON usable aunque el snapshot falle. |

---

## 11. Otros métodos (Caddy, proxy inverso)

Si no usas Cloudflare Tunnel, puedes poner **Caddy**, **Nginx** o **Traefik** delante del proceso o del puerto Docker, terminando TLS en el proxy. En el repo hay ejemplos bajo **`config/`** (`caddy-bichipishi-*.caddyfile`) y el README principal describe el flujo con Caddy.

---

*Última revisión alineada con el monorepo v1.1.0 (`package.json`). Si algo no coincide con tu entorno, abre un issue en el repositorio enlazado desde el README principal.*
