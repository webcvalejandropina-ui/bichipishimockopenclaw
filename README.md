# Bichipishi

Monitor del sistema en el navegador (CPU, RAM, disco, procesos, Docker, alertas…).

**Repo:** https://github.com/webcvalejandropina-ui/bichipishimockopenclaw

---

## Inicio (Windows, Mac o Linux)

Necesitas **Docker** (Docker Desktop en Windows), **Node.js 18+** y **pnpm** (o usa `npm` donde ponga `pnpm`).

```bash
git clone https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
cd bichipishimockopenclaw
pnpm install
pnpm run bichi:up
```

Abre en el navegador **la URL que imprime el comando** (por defecto **`http://bichipishi.127.0.0.1.nip.io/`**). También sirven **`http://127.0.0.1/`** y **`http://localtest.me/`** (mismo puerto; si no es el 80, añade `:PUERTO`).

**Parar:**

```bash
pnpm run bichi:down
```

### Importante: por qué “solo Docker” no muestra métricas

La **web** va en un contenedor, pero la **API de métricas** debe correr **en tu PC** (puerto **3001**). El contenedor Nginx reenvía `/api` al PC.  
**`pnpm run bichi:up`** arranca la API y luego Docker. Si solo ejecutas `docker compose up`, verás la interfaz sin datos.

---

## Dominios (`config/site.env`)

Por defecto: **`BICHI_SITE_HOST=bichipishi.127.0.0.1.nip.io bichipishi.home`**

| Parte | Uso |
|--------|-----|
| **nip.io** (primero) | Resuelve a `127.0.0.1` por Internet → **no hace falta tocar hosts** en Windows. |
| **bichipishi.home** | Nombre corto; **`pnpm run bichi:up`** intenta añadirlo al archivo **hosts** (en Windows hace falta **ejecutar la terminal como administrador** la primera vez, o el script te lo indica). |

Para no usar hosts en ningún sitio, deja solo el nombre nip.io en `BICHI_SITE_HOST`.

---

## Puerto 80 ocupado

En **`.env`**: `BICHI_WEB_PORT=8080` y entra con `http://127.0.0.1:8080`, etc.

---

## Sin pnpm (solo npm en la raíz)

Tras `npm install` en la raíz del repo, puedes usar:

```bash
node scripts/bichi-up.mjs
node scripts/bichi-down.mjs
```

`metrics-api` sigue instalándose con **`npm ci`** dentro de `metrics-api/` al primer arranque.

---

## Todo dentro de Docker (métricas del contenedor)

```bash
docker compose down
docker compose -f docker-compose.full-docker.yml up --build -d
```

Para ver datos del equipo real con ese modo, rellena **`BICHI_HOST_*`** en **`.env`** (plantilla en `config/host-identity.env.example`).

---

## Desarrollo sin Docker

`pnpm install`, `npm install` en `metrics-api/`, **`pnpm dev`**. Web **http://localhost:4322**, API **3001**.

---

## CI / sin tocar hosts

`BICHI_SKIP_HOSTS=1 pnpm run bichi:up` o `CI=true` → no se modifica el archivo hosts.

---

## Si falla en Windows

| Error | Qué hacer |
|-------|-----------|
| `spawnSync … cmd.exe ENOENT` | Usa la **última versión** del repo: el arranque llama a **npm** vía `node …/npm-cli.js` y a **Docker** sin depender de `cmd.exe`. Si persiste, reinstala **Node.js LTS** desde [nodejs.org](https://nodejs.org) (carpeta `nodejs` con `npm-cli.js`). |
| `docker compose` no encontrado | Abre **Docker Desktop** y comprueba `docker version` en la misma terminal. |

---

No subas **`.env`** (está en `.gitignore`).
