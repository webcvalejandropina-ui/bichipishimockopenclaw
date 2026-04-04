# Bichipishi — monitor de tu ordenador

Es una **página web** que enseña CPU, RAM, disco, procesos, Docker (si lo tienes), etc. **No tienes que saber programar** para usarla en tu máquina.

**Código en GitHub:** [github.com/webcvalejandropina-ui/bichipishimockopenclaw](https://github.com/webcvalejandropina-ui/bichipishimockopenclaw)

---

## Guía muy fácil (léeme primero)

### ¿Qué necesitas?

Solo una cosa: **Docker** (un programa que arranca todo solo).

- **Windows:** instala [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/). Ábrelo y espera a que diga que está listo.
- **Mac:** instala [Docker Desktop para Mac](https://docs.docker.com/desktop/setup/install/mac-install/).
- **Linux (Ubuntu, Debian, Fedora, etc.):** instala [Docker Engine](https://docs.docker.com/engine/install/) (y el plugin **Compose**; en muchas distros viene con `docker compose`).

Si no tienes Docker, el resto no funcionará: instálalo antes.

---

### Windows — copia y pega en PowerShell

1. Descarga el proyecto (sustituye la carpeta si quieres):

```powershell
cd $HOME\Desktop
git clone https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
cd bichipishimockopenclaw
```

2. Si Windows dice que no puede ejecutar scripts, una sola vez:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

3. Arranca todo:

```powershell
.\scripts\install.ps1
```

La primera vez **tarda varios minutos** (descarga imágenes). No cierres la ventana hasta que termine.

---

### Mac o Linux — copia y pega en la terminal

```bash
cd ~/Desktop
git clone https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
cd bichipishimockopenclaw
sh scripts/install.sh
```

(Si tu sistema usa carpeta “Escritorio” en español, puede ser `~/Escritorio`. Elige la carpeta que prefieras.)

---

### Abrir el panel

En el navegador (Chrome, Edge, Firefox…) entra en:

**http://localhost:8080**

Ahí está el dashboard. La dirección **`localhost`** significa “esta misma máquina”.

---

### Parar todo

En la misma carpeta del proyecto:

**Windows (PowerShell):**

```powershell
docker compose down
```

**Mac / Linux:**

```bash
docker compose down
```

---

### Si algo sale mal (lo más típico)

| Problema | Qué hacer |
|----------|-----------|
| “No se reconoce docker” | Docker Desktop (Windows/Mac) no está instalado o **no está abierto**. Ábrelo y vuelve a intentar. |
| “Puerto en uso” / no carga la página | Otra app usa el puerto **8080** o **3001**. Cierra esa app o cambia los puertos en `docker-compose.yml` (avanzado). |
| La página carga pero **no hay datos** | Espera unos segundos y pulsa actualizar. Si sigue vacío, en PowerShell o terminal: `docker compose ps` y mira que los dos servicios estén “Up”. |
| PowerShell no ejecuta `install.ps1` | Ejecuta `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y prueba otra vez. |

**Plan B (mismo resultado, a mano)**

*Mac o Linux:*

```bash
cp .env.example .env
docker compose up --build -d
```

*Windows (PowerShell):*

```powershell
Copy-Item .env.example .env
docker compose up --build -d
```

---

## Cambiar el nombre o la foto del muñeco (opcional)

1. Abre el archivo **`.env`** en la raíz del proyecto (si no existe, copia `.env.example` y renómbralo a `.env`).
2. Puedes editar:
   - **`PUBLIC_BICHI_APP_NAME`** — el nombre que sale arriba (por defecto Bichipishi).
   - **`PUBLIC_BICHI_AVATAR_URL`** — enlace a una imagen por internet que sustituye a la piña.
3. Guarda el archivo. En Docker: **`docker compose restart web`** (y si no ves el cambio en todo, `docker compose build web` y vuelve a `up`).

---

## Móvil y tablet

Puedes abrir **http://TU-IP-LOCAL:8080** desde el móvil si el PC y el móvil están en la misma WiFi (sustituye `TU-IP-LOCAL` por la IP de tu ordenador, p. ej. `192.168.1.10`). La interfaz se adapta a pantallas pequeñas.

---

## Para desarrolladores (hot reload)

Necesitas **Node** y **pnpm**. En la carpeta del proyecto:

```bash
cp .env.example .env
pnpm install
cd metrics-api && npm install && cd ..
pnpm dev
```

- Web: **http://localhost:4322**
- API: puerto **3001**

---

## Qué hace Docker aquí (resumen)

Suben **dos cajas** (contenedores):

1. **web** — sirve la página en el puerto **8080**.
2. **metrics** — el programa que lee el sistema y responde por **3001**.

Los datos guardados (histórico, ajustes) pueden quedarse en un volumen aunque reinicies. Detalle técnico: carpeta de datos de la API dentro del contenedor en `/app/data`.

---

## Más opciones (producción, sin Docker, API en Internet)

- Variables y seguridad: mira **`.env.example`** y los comentarios en **`docker-compose.yml`**.
- Build estático + API aparte, CORS, SQLite: secciones equivalentes a las que ya tenías; si las necesitas, consulta el historial del repo o pregunta en issues.

---

## Estructura rápida del repo

| Carpeta / archivo | Para qué |
|-------------------|----------|
| `src/` | Interfaz web |
| `metrics-api/` | Servidor que lee el sistema |
| `docker-compose.yml` | Orden para levantar web + API |
| `scripts/install.sh` | Instalación fácil (Mac/Linux) |
| `scripts/install.ps1` | Instalación fácil (Windows) |

---

## Licencia y repo

Uso bajo la licencia del proyecto. **No subas** tu archivo **`.env`** a internet (está en `.gitignore`).
