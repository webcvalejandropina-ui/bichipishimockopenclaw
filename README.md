# Bichipishi — monitor de tu ordenador

Página web que muestra CPU, RAM, disco, procesos, Docker (si lo tienes), etc. **No hace falta saber programar.**

**Código:** [github.com/webcvalejandropina-ui/bichipishimockopenclaw](https://github.com/webcvalejandropina-ui/bichipishimockopenclaw)

---

## Windows (lo más fácil)

### Paso 0 — Docker Desktop

1. Instálalo desde aquí: [Docker Desktop para Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
2. **Ábrelo** desde el menú Inicio.
3. Espera hasta que diga que el motor está en marcha (icono de ballena en la bandeja, sin errores).

Sin esto, nada de lo siguiente funciona.

---

### Paso 1 — Tener la carpeta del proyecto

**Opción A — Sin Git (recomendado si no sabes qué es Git):**

1. En GitHub, botón verde **Code** → **Download ZIP**
2. Descomprime el ZIP (clic derecho → “Extraer todo…”)
3. Entra en la carpeta que sale (algo como `bichipishimockopenclaw-main`). Si el ZIP se llama `main`, la carpeta puede ser `bichipishimockopenclaw-main`.

**Opción B — Con Git:**

Abre **PowerShell** o **cmd**, luego:

```text
cd %USERPROFILE%\Desktop
git clone https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
cd bichipishimockopenclaw
```

---

### Paso 2 — Doble clic

Dentro de esa carpeta, **doble clic** en el archivo:

**`install.cmd`**

Se abrirá una ventana negra. **La primera vez puede tardar muchos minutos** (descarga e instalación). No la cierres hasta que ponga **LISTO**.

Si Windows pregunta si confías en el archivo, es normal al ejecutar un `.cmd` por primera vez.

---

### Paso 3 — Abrir el navegador

Entra en:

**http://localhost:8080**

---

### Parar en Windows

Doble clic en **`parar.cmd`** (en la misma carpeta).

---

### Windows — si falla

| Qué pasa | Qué hacer |
|----------|-----------|
| Dice que no encuentra `docker` | Instala Docker Desktop y **ábrelo** antes de `install.cmd`. |
| Dice que Docker no responde | Docker cerrado: abre Docker Desktop y espera 1–2 minutos. |
| La página no carga | Comprueba que no tengas otra cosa usando el puerto **8080**. Reinicia y vuelve a ejecutar `install.cmd`. |
| La página carga pero sin datos | Espera 30 segundos y **recarga** (F5). El servicio de métricas puede tardar en arrancar. |
| Sigue mal | Abre PowerShell en la carpeta del proyecto y ejecuta: `docker compose ps` — deben salir dos contenedores. Si no, copia el error y abre un *issue* en GitHub. |

**Sin usar install.cmd** (mismo efecto, a mano en PowerShell o cmd, dentro de la carpeta del proyecto):

```text
copy .env.example .env
docker compose up --build -d
```

---

## Mac o Linux

1. Instala [Docker](https://docs.docker.com/get-docker/) (Docker Desktop en Mac, o Docker Engine en Linux).
2. En la terminal:

```bash
cd ~/Desktop
git clone https://github.com/webcvalejandropina-ui/bichipishimockopenclaw.git
cd bichipishimockopenclaw
sh scripts/install.sh
```

3. Navegador: **http://localhost:8080**

Para parar: `docker compose down`

---

## Cambiar nombre o foto (opcional)

Edita el archivo **`.env`** en la raíz del proyecto (si no existe, cópialo desde `.env.example`).

- `PUBLIC_BICHI_APP_NAME` — nombre en la barra superior.
- `PUBLIC_BICHI_AVATAR_URL` — URL de una imagen que sustituye a la piña.

Luego: `docker compose restart web` (o vuelve a ejecutar `install.cmd` en Windows).

---

## Móvil

Misma WiFi que el PC: en el móvil abre `http://IP-DEL-PC:8080` (la IP la ves en Windows con `ipconfig`, en Mac/Linux con ajustes de red).

---

## Desarrolladores

Necesitas Node y pnpm. Ver `package.json` y ejecutar `pnpm dev` tras `pnpm install` y `npm install` en `metrics-api/`.

---

## Archivos útiles

| Archivo | Para qué |
|---------|----------|
| **`install.cmd`** | Windows: doble clic para arrancar todo |
| **`parar.cmd`** | Windows: doble clic para parar |
| `scripts/install.sh` | Mac / Linux |
| `docker-compose.yml` | Define los dos servicios (web + métricas) |

---

## Licencia

No subas tu **`.env`** a internet (ya está ignorado por Git).
