# Bichipishi

Monitor del sistema en el navegador (CPU, RAM, disco, procesos, Docker, servicios, alertas, etc.).

**Repositorio:** https://github.com/webcvalejandropina-ui/bichipishimockopenclaw

---

## Requisitos (cualquier equipo)

| Herramienta | Para qué |
|-------------|----------|
| **Docker** + **Docker Compose** | Contenedor **web** (Nginx + estáticos). En Windows: [Docker Desktop](https://www.docker.com/products/docker-desktop/). |
| **Node.js ≥ 18** | API de métricas en tu PC (**puerto 3001**). |
| **pnpm** (recomendado) o **npm** | Dependencias del front y, vía script, de `metrics-api`. |
| **Git** | Clonar el repo. En Windows conviene **Git for Windows** (incluye **Git Bash** para ejecutar los `.sh`). |

**Opcional:** copia **`.env.example`** → **`.env`** y ajusta marca, umbrales e identidad del host (`BICHI_HOST_*`) si quieres que el dashboard muestre nombre de equipo/SO reales con Docker “full”.

El archivo **`config/site.env`** va al repo con valores por defecto; puedes cambiar **`BICHI_SITE_HOST`** ahí.

---

## Cómo funciona (igual en Mac, Linux y Windows)

1. La **UI** se sirve desde **Docker** (puerto **80** del host por defecto, o el que pongas en **`BICHI_WEB_PORT`** en `.env`).
2. La **API Node** (`metrics-api`) corre **en tu máquina**, no dentro del contenedor web: así las métricas son las de **tu** sistema (CPU, RAM, procesos, servicios…), no las del contenedor Linux.
3. El contenedor Nginx enruta **`/api`** → **`host.docker.internal:3001`** (en Linux/Mac con Docker moderno esto viene resuelto en el `docker-compose.yml`).

**URLs que siempre suelen funcionar sin tocar archivos de hosts:**

- **`http://127.0.0.1/`**
- **`http://localtest.me/`** (dominio público que apunta a 127.0.0.1)

**Solo HTTP** en local (no `https`), salvo que montes tú un proxy TLS.

---

## Arranque recomendado (un comando)

```bash
cp .env.example .env    # opcional
pnpm install              # si aún no instalaste dependencias raíz
bash scripts/bichi-docker-up.sh
```

Ese script:

1. Comprueba si la API responde en **3001**; si no, hace **`npm ci --omit=dev`** en `metrics-api` (si hace falta) y arranca **`node server.js`** en segundo plano.
2. En **macOS y Linux**, ejecuta **`scripts/bichi-ensure-hosts.sh`**: actualiza **`/etc/hosts`** con un bloque marcado (`# >>> bichipishi-hosts` … `# <<< bichipishi-hosts`) según **`config/site.env` → `BICHI_SITE_HOST`** (pide **sudo** cuando toca escribir).
3. Ejecuta **`docker compose up --build -d`**.

**Parar** UI + API que arrancó el script:

```bash
bash scripts/bichi-docker-down.sh
```

Equivalente npm: **`pnpm run docker:up`** / **`pnpm run docker:down`** (usan los mismos scripts; hace falta **`bash`** en el PATH).

---

## Windows (otro PC)

Los scripts **`.sh`** no se ejecutan en **CMD** clásico. Usa una de estas opciones:

### A) Git Bash (recomendado, mismo flujo que en Mac)

1. Instala [Git for Windows](https://git-scm.com/download/win) y abre **Git Bash**.
2. `cd` al directorio del repo.
3. Instala dependencias: `pnpm install` (o instala pnpm según [pnpm.io](https://pnpm.io/installation)).
4. `bash scripts/bichi-docker-up.sh`

**Hosts en Windows:** el script **`bichi-ensure-hosts.sh` no modifica Windows** (solo macOS/Linux). Para usar el nombre por defecto **`http://bichipishi.home/`**:

1. Abre el Bloc de notas **como administrador**.
2. Abre **`C:\Windows\System32\drivers\etc\hosts`**.
3. Añade una línea: **`127.0.0.1 bichipishi.home`** (y guarda).

Referencia: **`config/hosts-bichipishi.txt`**.

**Si no quieres editar hosts:** en **`config/site.env`** pon por ejemplo:

`BICHI_SITE_HOST=bichipishi.127.0.0.1.nip.io`

(ese nombre resuelve por DNS público a 127.0.0.1) **o** usa directamente **`http://127.0.0.1`** / **`http://localtest.me`**.

### B) Sin Bash: dos terminales (PowerShell o CMD)

**Terminal 1 — API**

```text
cd metrics-api
npm ci --omit=dev
node server.js
```

**Terminal 2 — Docker**

```text
docker compose up --build -d
```

Ajusta **hosts** o **`BICHI_SITE_HOST`** como arriba si quieres un nombre tipo `bichipishi.home`.

### C) Omitir sincronización de hosts (macOS/Linux)

```bash
BICHI_SKIP_HOSTS=1 bash scripts/bichi-docker-up.sh
```

Útil en CI o si solo usarás **127.0.0.1** / **localtest.me**. Con **`CI=true`** el script de hosts no hace cambios.

---

## Dominio y `config/site.env`

Variable **`BICHI_SITE_HOST`**: uno o varios nombres separados por espacio para la directiva **`server_name`** de Nginx.

- Por defecto: **`bichipishi.home`** → en Mac/Linux el script de arranque intenta escribir **`/etc/hosts`**; en Windows edítalo a mano o cambia a **nip.io** (ver arriba).
- Puerto del navegador: **`80`** por defecto. Si está ocupado, en **`.env`**: **`BICHI_WEB_PORT=8080`** y entra con **`http://127.0.0.1:8080`**, etc.

---

## `/etc/hosts` automático (solo macOS / Linux)

1. Lee **`BICHI_SITE_HOST`**.
2. **No toca** entradas para **`*.nip.io`**, **`localtest.me`**, **`localhost`**, **`127.0.0.1`**.
3. Para el resto, reescribe el bloque entre **`# >>> bichipishi-hosts`** y **`# <<< bichipishi-hosts`**.

Si solo haces **`docker compose up`** sin el script, en Mac/Linux puedes ejecutar **`bash scripts/bichi-ensure-hosts.sh`** una vez antes.

---

## Manual (dos terminales, cualquier SO)

**Terminal 1**

```bash
cd metrics-api && npm ci --omit=dev && node server.js
```

**Terminal 2**

```bash
bash scripts/bichi-ensure-hosts.sh   # solo macOS/Linux y si usas nombre tipo *.home
docker compose up --build -d
```

---

## Opción: todo dentro de Docker

Los datos serán los del **contenedor** salvo que rellenes **`BICHI_HOST_*`** en **`.env`**.

```bash
docker compose down
bash scripts/bichi-ensure-hosts.sh    # macOS/Linux; en Windows hosts a mano o nip.io
docker compose -f docker-compose.full-docker.yml up --build -d
```

Parar: **`docker compose -f docker-compose.full-docker.yml down`**

---

## Makefile

`make install` → crea **`.env`** si falta y ejecuta **`bash scripts/bichi-docker-up.sh`** · `make down` → **`bash scripts/bichi-docker-down.sh`**

---

## Desarrollo sin Docker

`pnpm install`, `npm install` en **`metrics-api/`**, **`pnpm dev`**. Web **http://localhost:4322**, API **3001**.

---

## Problemas frecuentes

| Síntoma | Qué revisar |
|---------|-------------|
| La web carga pero no hay datos | Que la API esté en **3001** (`curl http://127.0.0.1:3001/api/metrics`). |
| `bichipishi.home` no abre | **Windows:** línea en `hosts` o usa **nip.io** / **127.0.0.1**. |
| Puerto 80 en uso | **`BICHI_WEB_PORT`** en **`.env`** y URL con ese puerto. |
| Docker no ve la API | **`host.docker.internal`**: en el compose actual va **`extra_hosts: host.docker.internal:host-gateway`**. |

---

No subas **`.env`** ni datos locales sensibles; **`.env`** está en **`.gitignore`**.
