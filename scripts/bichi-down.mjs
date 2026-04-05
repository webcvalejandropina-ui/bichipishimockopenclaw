#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { dockerCompose } from './lib/run-cmd.mjs';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PID_FILE = path.join(REPO_ROOT, '.bichi-api.pid');

async function main() {
  try {
    dockerCompose(['down'], REPO_ROOT);
  } catch {
    /* compose down puede fallar si no hay proyecto */
  }

  try {
    const s = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = Number.parseInt(s, 10);
    if (Number.isFinite(pid)) {
      try {
        process.kill(pid, 0);
        console.log(`Deteniendo metrics-api (PID ${pid})…`);
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          /* ignore */
        }
        for (let i = 0; i < 15; i++) {
          await delay(200);
          try {
            process.kill(pid, 0);
          } catch {
            break;
          }
        }
        try {
          process.kill(pid, 0);
          process.kill(pid, 'SIGKILL');
        } catch {
          /* ya terminó */
        }
      } catch {
        /* PID inválido o sin proceso */
      }
    }
  } catch {
    /* sin pid file */
  }

  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

main();
