# Bichipishi

Monitor del sistema en el navegador (CPU, RAM, disco, procesos, Docker, etc.).

**Código:** https://github.com/webcvalejandropina-ui/bichipishimockopenclaw

---

## Arranque con Docker

1. Instala **[Docker](https://docs.docker.com/get-docker/)** y **`docker compose`**.

2. Clona o descarga el ZIP del repo y entra en la carpeta.

3. Configuración:

```bash
cp .env.example .env
```

(En Windows: `copy .env.example .env`)

4. **Importante en Docker:** edita **`.env`** y rellena **`BICHI_HOST_HOSTNAME`**, **`BICHI_HOST_OS`** y **`BICHI_MEM_TOTAL_GIB`** con datos de **tu PC** (o monta en `docker-compose.yml` **`/etc/os-release`** y **`/etc/hostname`** del anfitrión en **`/host/etc/...`** si usas Linux nativo).  
   Sin eso, la API (Linux en el contenedor) mostrará identidad y SO del contenedor.

5. Levanta el stack:

```bash
docker compose up --build -d
```

6. **Hosts y URL:** añade en el archivo **hosts** del sistema:

```text
127.0.0.1 bichipishi.local
```

- **Windows:** `C:\Windows\System32\drivers\etc\hosts` (editor como administrador)  
- **Mac / Linux:** `/etc/hosts`

Abre **http://bichipishi.local:8080** (o el puerto que hayas puesto en **`BICHI_WEB_PORT`** en `.env`).

También sigue valiendo **http://localhost:8080**.

La API **no** usa el puerto 3001 en el host: todo va por **Nginx** con la ruta **`/api`**.

---

## Parar

```bash
docker compose down
```

---

## OpenClaw dentro de Docker

El binario `openclaw` no suele existir en el contenedor. Opciones:

- Monta en `docker-compose.yml` (servicio `metrics`) un archivo de log **de tu máquina** y define **`OPENCLAW_LOG_PATH`** con la ruta **dentro del contenedor**.
- O **`OPENCLAW_FORCE=1`** en `.env` si solo quieres la interfaz.

---

## Desarrollo sin Docker (web en caliente)

`pnpm install`, `npm install` en `metrics-api/`, `pnpm dev`. Web **http://localhost:4322**, API **3001**.

---

## Makefile

`make install` → `.env` + `docker compose up --build -d` · `make down` → `docker compose down`

---

No subas **`.env`**.
