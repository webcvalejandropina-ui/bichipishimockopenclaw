# Bichipishi

Monitor del sistema en el navegador con **métricas reales del equipo** donde corre la app.

**Repo:** https://github.com/webcvalejandropina-ui/bichipishimockopenclaw

---

## Requisitos

- **[Bun](https://bun.sh) 1.1+** (Linux, macOS y Windows). Un solo runtime para la web (Astro), el script de deploy y la API.
- Sin Docker: un solo proceso evita confundir métricas del contenedor con las del PC.

---

## Estructura del proyecto

| Carpeta / archivo | Qué es |
|-------------------|--------|
| **`dist/`** | Web estática (`bun run build`). La sirve el mismo proceso que la API. |
| **`metrics-api/`** | Servidor Bun: rutas `/api/...` + ficheros de `dist/`. |
| **`data/`** | SQLite de rendimiento (`perf.sqlite`) y **`settings.json`**. Misma ruta en cada arranque salvo `BICHI_DATA_DIR`. |

---

## Ponerlo en marcha (recomendado)

```bash
cp .env.example .env   # opcional
bun install
bun run deploy
```

**`bun run deploy`** hace, en orden: `bun install` (raíz + workspace `metrics-api`) → `bun run build` (Astro → `dist/`) → migra `metrics-api/data/*` a **`data/`** si aún no existen → arranca el servidor.

Abre **http://127.0.0.1:3001/** (o el puerto de `BICHI_API_PORT` en `.env`). Web y API van **en el mismo origen**.

| Comando | Uso |
|---------|-----|
| **`bun start`** | Solo servidor (si ya construiste antes). |
| **`bun run dev`** | Desarrollo: Astro en caliente + API en otro puerto. |

---

## Datos y consistencia

- **SQLite** y **settings** viven en **`data/`** (ignorados por git salvo `data/.gitkeep`).
- Si venías de una versión antigua con `metrics-api/data/`, el primer **`bun run deploy`** copia esos archivos a **`data/`** sin machacar los nuevos.

---

## Desarrollo sin `deploy`

```bash
bun run dev
```

Web en **http://localhost:4322**, API en **3001** (proxy de Vite).

---

## Windows

Instala Bun con el instalador oficial. Los scripts de `package.json` no dependen de bash: `bun run deploy`, `bun start` y `bun run dev` funcionan en PowerShell o CMD. Si el puerto está ocupado, el servidor muestra ayuda con `netstat` / `taskkill`.

---

No subas **`.env`** ni el contenido de **`data/`** con secretos.
