# Paquetes: Bun, pnpm y por qué no usamos npm en este repo

Este proyecto **no utiliza npm** como gestor de paquetes en los flujos documentados (Docker, scripts de despliegue y documentación orientativa). Se trabaja con:

| Herramienta | Uso principal |
|-------------|----------------|
| **[Bun](https://bun.sh)** | Instalación y scripts en desarrollo (`bun install`, `bun run deploy`, `bun run dev`). Lockfile: **`bun.lock`**. Imagen Docker: build y runtime con Bun. |
| **[pnpm](https://pnpm.io)** | Alternativa cuando ejecutas **`deploy:node`** con **Node** (sin runtime Bun): instalación reproducible con **`pnpm-lock.yaml`**. |

## Por qué evitamos npm aquí

1. **`npm audit` y ruido de vulnerabilidades**  
   El informe de auditoría de npm suele listar **muchas alertas en dependencias transitivas** (árbol profundo de `node_modules`). A menudo son **CVE en herramientas de desarrollo o en rutas no alcanzables en producción**, o quedan sin parche hasta que sube la dependencia raíz. Eso genera **falsos positivos** y trabajo manual sin mejora clara de seguridad real, si no se prioriza por contexto (superficie de ataque, uso en runtime vs build).

2. **Reproducibilidad**  
   Este repo fija versiones con **lockfiles explícitos** (`bun.lock` y, para la ruta Node, `pnpm-lock.yaml`). pnpm además usa un **store con enlaces duros** y un árbol más predecible que el instalador clásico de npm.

3. **Coherencia con el monorepo**  
   Ya se usa **Bun** como camino principal; Docker y la documentación siguen la misma línea para no mezclar tres ecosistemas (npm/yarn/pnpm) sin necesidad.

4. **Historial en este repositorio**  
   El script `deploy` ya documentaba que el árbol **`node_modules/.bun/`** rompe el instalador de npm (`arborist`). Mezclar Bun y npm en el mismo árbol obliga a borrar `node_modules`; es más limpio **no usar npm** en los flujos soportados.

No es un juicio global sobre npm (sigue siendo muy usado en la industria); es una **política de este repo** para reducir ruido, duplicidad de lockfiles y fricción entre Bun y el cliente de npm.

## Comandos equivalentes

| Objetivo | Con Bun | Con Node + pnpm |
|----------|---------|------------------|
| Instalar | `bun install` | `pnpm install` |
| Despliegue local | `bun run deploy` | `pnpm run deploy:node` |
| Build solo Astro | `bun run build:astro` | `pnpm run build:astro:node` |
| Docker (producción) | `bun run docker:up` — perfil **`production`** (`Dockerfile`) | — |
| Docker (desarrollo, Astro + Vite + API) | `bun run docker:up:local` — perfil **`local`** (`Dockerfile.dev`) | — |

La primera vez que uses pnpm en el clon: `corepack enable` (Node 16.13+) y luego `pnpm install` genera o actualiza **`pnpm-lock.yaml`**. Conviene **commitear** ese fichero para CI y equipos.

**No mezcles** en el mismo directorio de trabajo **`bun install`** y **`pnpm install`** sin borrar antes **`node_modules`** (y los del workspace); los layouts son distintos y rompen el instalador del otro. Elige un gestor por clon o limpia entre cambios.
