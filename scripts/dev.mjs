/**
 * Desarrollo: API + Astro en paralelo, usando el mismo runtime (Node o Bun) que invocó este script.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });
const useBun = Boolean(process.versions.bun);
const execPath = process.execPath;
const serverJs = path.join(ROOT, 'metrics-api', 'server.js');

/** Primer puerto libre desde `start` (hasta +40). Evita fallar si 3001 sigue ocupado por otra instancia. */
function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const max = start + 40;
    const tryListen = (p) => {
      if (p > max) {
        reject(new Error(`No hay puerto libre entre ${start} y ${max} para la API.`));
        return;
      }
      const srv = net.createServer();
      srv.once('error', () => tryListen(p + 1));
      /* Mismo criterio que metrics-api (listen en 0.0.0.0); 127.0.0.1 puede dar falso libre. */
      srv.listen(p, '0.0.0.0', () => {
        srv.close(() => resolve(p));
      });
    };
    tryListen(start);
  });
}

const concurrentlyMain = path.join(ROOT, 'node_modules', 'concurrently', 'dist', 'bin', 'concurrently.js');
if (!fs.existsSync(concurrentlyMain)) {
  console.error('Falta el paquete concurrently. En la raíz del repo ejecuta: bun install  o  pnpm install');
  process.exit(1);
}

if (!fs.existsSync(serverJs)) {
  console.error('No existe metrics-api/server.js');
  process.exit(1);
}

const preferredApi =
  Number.parseInt(String(process.env.BICHI_API_PORT || process.env.PUBLIC_BICHI_API_PORT || '3001'), 10) || 3001;
let apiPortNum;
try {
  apiPortNum = await findFreePort(preferredApi);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
if (apiPortNum !== preferredApi) {
  console.warn(
    `\x1b[33mPuerto ${preferredApi} en uso: la API usará ${apiPortNum} (ajusta BICHI_API_PORT o libera el puerto).\x1b[0m\n`,
  );
}
const apiPort = String(apiPortNum);

/* Prefijo VAR=val para sh -c: fuerza puerto frente a .env/cola de procesos. */
const apiEnvPrefix = `BICHI_API_PORT=${apiPort} PUBLIC_BICHI_API_PORT=${apiPort} BICHI_IN_CONCURRENTLY=1`;
/* Desde metrics-api/ para que Bun/Node resuelvan node_modules del workspace (p. ej. systeminformation). */
const apiCmd =
  process.platform === 'win32'
    ? useBun
      ? `cd metrics-api && set BICHI_API_PORT=${apiPort}&set PUBLIC_BICHI_API_PORT=${apiPort}&set BICHI_IN_CONCURRENTLY=1&bun server.js`
      : `cd metrics-api && set BICHI_API_PORT=${apiPort}&set PUBLIC_BICHI_API_PORT=${apiPort}&set BICHI_IN_CONCURRENTLY=1&node server.js`
    : useBun
      ? `cd ./metrics-api && ${apiEnvPrefix} bun ./server.js`
      : `cd ./metrics-api && ${apiEnvPrefix} node ./server.js`;
/** El binario `astro` invoca Node; con Bun evitamos Node <18.20.8 que Astro 5 rechaza. */
const astroCmd =
  process.platform === 'win32'
    ? useBun
      ? `set BICHI_API_PORT=${apiPort}&set PUBLIC_BICHI_API_PORT=${apiPort}&bun .\\node_modules\\astro\\astro.js dev --host`
      : `set BICHI_API_PORT=${apiPort}&set PUBLIC_BICHI_API_PORT=${apiPort}&npx astro dev --host`
    : useBun
      ? `${apiEnvPrefix} bun ./node_modules/astro/astro.js dev --host`
      : `${apiEnvPrefix} npx astro dev --host`;

const astroPort = '4322';
console.log(
  `\n\x1b[1mDev\x1b[0m  ·  \x1b[32mhttp://127.0.0.1:${astroPort}/\x1b[0m  (Astro; \`/api\` → API vía Vite)\n` +
    `       ·  \x1b[32mhttp://127.0.0.1:${apiPort}/\x1b[0m  (API directa)\n`,
);

const child = spawn(
  execPath,
  [
    concurrentlyMain,
    '-k',
    '-n',
    'api,astro',
    '-c',
    'cyan,magenta',
    apiCmd,
    astroCmd,
  ],
  {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      BICHI_API_PORT: apiPort,
      PUBLIC_BICHI_API_PORT: apiPort,
      BICHI_IN_CONCURRENTLY: '1',
    },
  },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
