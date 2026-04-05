# Bichipishi

Monitor del sistema en el navegador (CPU, RAM, disco, procesos, Docker, etc.).

**Código:** https://github.com/webcvalejandropina-ui/bichipishimockopenclaw

---

## Cómo arrancarlo (igual en Windows, Mac y Linux)

1. Instala **[Docker](https://docs.docker.com/get-docker/)** y el comando **`docker compose`** (viene con Docker Desktop y con Docker Engine reciente).

2. Descarga el proyecto y entra en la carpeta:

```bash
git clone https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
cd bichipishimockopenclaw
```

(Sin Git: en GitHub → **Code** → **Download ZIP**, descomprime y abre una terminal dentro de esa carpeta.)

3. Crea el archivo de configuración local:

```bash
cp .env.example .env
```

En **Windows (cmd)**:

```text
copy .env.example .env
```

4. Levanta todo:

```bash
docker compose up --build -d
```

La primera vez puede tardar bastante.

5. Abre el navegador en **http://localhost:8080**

---

## Parar

```bash
docker compose down
```

---

## Opcional

| Qué | Dónde |
|-----|--------|
| Cambiar nombre o imagen del avatar | `.env` → `PUBLIC_BICHI_APP_NAME`, `PUBLIC_BICHI_AVATAR_URL` |
| Más variables (RAM en Docker, CORS, etc.) | `.env.example` y `docker-compose.yml` |

Tras cambiar `.env` en Docker: `docker compose up -d --build` (o al menos `docker compose build web` si solo tocaste la web).

---

## Desarrollo (sin Docker para la web)

Necesitas Node y pnpm. `pnpm install`, `npm install` en `metrics-api/`, luego `pnpm dev`. Web en **http://localhost:4322**, API en **3001**.

---

## Makefile (si usas `make`)

- `make install` → copia `.env` si no existe y ejecuta `docker compose up --build -d`
- `make down` → `docker compose down`

No subas tu archivo **`.env`** (está en `.gitignore`).
