# Bichipishi

**Bichipishi** es un monitor del sistema que corre en el navegador y muestra **métricas reales del equipo** donde se ejecuta la API (CPU, RAM, disco, carga, procesos, servicios, Docker, logs, GPU cuando el SO lo permite, etc.). La interfaz es una app **Astro** estática; los datos los sirve un pequeño servidor **Node/Bun** en rutas `/api/*`, de modo que en producción puedes tener **web y API en el mismo origen y puerto** (por defecto `3001`).

**Repositorio:** [github.com/webcvalejandropina-ui/bichipishimockopenclaw](https://github.com/webcvalejandropina-ui/bichipishimockopenclaw)

---

## Qué incluye

| Área | Descripción |
|------|-------------|
| **Dashboard** | Resumen de CPU, RAM, disco, carga, GPU, KPIs (procesos, servicios, contenedores), alertas, gráficos y tarjeta de **información del sistema** (equipo, hostname, SO, IP, CPU, núcleos, GPU, RAM, disco). |
| **Rendimiento** | Histórico agregado por día (SQLite en `data/`), alineado con las muestras que guarda la API. |
| **Procesos / Servicios / Docker** | Listados y estado según `systeminformation` y el daemon de Docker. |
| **Logs** | Lectura de archivo de log o journal (según plataforma y configuración). |
| **OpenClaw** | Panel opcional si detectas binario o ruta de log configurada. |
| **Sistema** | Hardware, uso de recursos, uptime, red, **GPU** (modelo, VRAM, uso si está disponible). |
| **Configuración** | Umbrales, alertas por correo (SMTP), ajustes persistidos en `data/settings.json`. |
| **Alertas** | Vista dedicada de advertencias del monitor. |

Tema claro/oscuro, cabecera con estado del host y reloj, marca personalizable vía variables públicas (nombre, avatar).

---

## Arquitectura (resumen)

```
┌─────────────────────────────────────────────────────────┐
│  Navegador — Astro (HTML/CSS/JS en dist/)             │
│  fetch → /api/metrics, /api/settings, …                │
└────────────────────────┬────────────────────────────────┘
                         │ mismo host:puerto en producción
┌────────────────────────▼────────────────────────────────┐
│  metrics-api/server.js (Bun o Node ≥ 18)                  │
│  Sirve dist/ + API + SQLite (perf) + lectura de logs    │
└────────────────────────┬────────────────────────────────┘
                         │
              systeminformation, fs, Docker, opc. mail
```

- **Desarrollo:** Astro en **4322** con proxy de Vite hacia la API en **3001** (ver `bun run dev`).
- **Producción local:** `bun run deploy` construye la web y arranca un solo proceso que sirve `dist/` y la API.

---

## Requisitos

- **[Bun](https://bun.sh) 1.1+** recomendado (scripts y lockfile del repo). También puedes usar **Node ≥ 18.20** con `npm run deploy:node`, `npm run start:node`, etc.
- La API debe ejecutarse **en el host** cuyo sistema quieres monitorizar. Si solo la levantas dentro de un contenedor sin variables `BICHI_HOST_*`, la UI indica que las métricas **no representan tu PC** (Docker Linux ≠ Windows/macOS del usuario).

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
| `/api/metrics` | GET | JSON con CPU, memoria, disco, load, uptime, top procesos, servicios, contenedores Docker, GPU (`gpu`, `gpuModel`, `gpuVramMb`, …), alertas, etc. |
| `/api/settings` | GET / POST | Lee o guarda ajustes (con opciones de seguridad en producción). |
| `/api/settings/test-mail` | POST | Prueba SMTP. |
| `/api/perf/daily` | GET | Series diarias para la página de rendimiento. |
| `/api/openclaw` | GET | Estado / datos OpenClaw si aplica. |
| `/api/logs` | GET | Líneas de log según `LOG_FILE` o journal. |
| `/api/cron` | GET | Tareas tipo cron (crontab + opcional `config/cron.extra`). |

La documentación detallada de cabeceras, CORS y tokens opcionales está comentada en `metrics-api/server.js` y en `.env.example`.

---

## Datos en disco

| Ruta | Contenido |
|------|-----------|
| **`data/`** | `perf.sqlite` (histórico de rendimiento), `settings.json` (umbrales, correo, …). Ignorados en git salvo `data/.gitkeep`. |
| **`dist/`** | Salida del build de Astro; la sirve la API. Ignorado en git. |

Variable opcional: **`BICHI_DATA_DIR`** para otra carpeta de datos.

---

## GPU

La API usa **`systeminformation.graphics()`**. El **modelo** y la **VRAM** suelen aparecer en Linux/macOS/Windows; el **porcentaje de uso** depende del fabricante y herramientas (p. ej. NVIDIA con `nvidia-smi`). Si no hay dato de uso, la UI puede mostrar **N/D** manteniendo el modelo.

---

## Variables de entorno

Copia **`.env.example`** → **`.env`**. Incluye:

- Puerto unificado (`BICHI_API_PORT`, `PUBLIC_BICHI_API_PORT`).
- Marca (`PUBLIC_BICHI_APP_NAME`, `PUBLIC_BICHI_AVATAR_URL`).
- Origen público del sitio (`PUBLIC_BICHI_SITE_URL`, `BICHI_PUBLIC_HOST`) para HMR con Caddy u hosts locales.
- Producción: `PUBLIC_BICHI_API_URL`, `BICHI_CORS_ORIGIN`, `BICHI_SETTINGS_TOKEN`, etc.
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

---

## Contribuciones

Puedes abrir **issues** o **pull requests** en el repositorio de GitHub enlazado arriba. El campo `"private": true` en `package.json` solo evita publicar el paquete en npm; no define la visibilidad del repo.
