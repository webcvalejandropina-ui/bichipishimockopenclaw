# Bichipishi

Monitor en el navegador con **métricas reales de tu PC** (Windows, Mac o Linux).

**Repo:** https://github.com/webcvalejandropina-ui/bichipishimockopenclaw

---

## Uso normal (2 comandos)

Necesitas **Docker Desktop** y **Node.js 18+**.

```bash
pnpm install
pnpm bichi
```

Abre **http://bichipishi.127.0.0.1.nip.io/** o **http://127.0.0.1/** (mismo puerto; si no es 80, añade `:PUERTO` del `.env`).

**Parar:** `pnpm bichi:down`

`pnpm bichi` arranca la **API en tu equipo** (puerto 3001) y la **web en Docker**. Si solo levantas contenedores sin ese comando, la web puede cargar **sin datos** o con datos que **no son tu Windows**.

---

## Windows

Mismo flujo: **PowerShell** o **CMD**, `pnpm install`, `pnpm bichi`.  
Si pide permisos para el archivo **hosts** (`bichipishi.home`), ejecuta la terminal **como administrador** una vez, o usa solo la URL **nip.io** de arriba.

---

## No quiero “métricas falsas”

Si la API corre **dentro de Docker** (`docker-compose.full-docker.yml`) **sin** rellenar en `.env` cosas como `BICHI_HOST_HOSTNAME` y `BICHI_HOST_OS`, el panel **no muestra** CPU/RAM/disco/procesos/servicios **como si fueran tu PC** (son del contenedor Linux). Sí puedes ver **contenedores Docker** reales vía el socket.

Para ver **tu Windows/Mac/Linux de verdad:** usa **`pnpm bichi`** (recomendado).

---

## Otros

| Objetivo | Comando |
|----------|---------|
| Desarrollo (Astro + API) | `pnpm dev` |
| Puerto 80 ocupado | En `.env`: `BICHI_WEB_PORT=8080` |
| Sin tocar hosts | `BICHI_SKIP_HOSTS=1 pnpm bichi` o solo URL nip.io / 127.0.0.1 |

No subas **`.env`**.
