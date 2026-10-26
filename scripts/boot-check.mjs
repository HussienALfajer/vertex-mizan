// The boot check: starts the built API and worker as a server starts them (`NODE_ENV=production`,
// `node dist/main.js`) against the database in `DATABASE_APP_URL` and `DATABASE_QUEUE_URL`, and
// passes when `/api/health` answers 200 and the worker has scheduled its jobs and is still up a few
// seconds later. Run after `pnpm build` and `pnpm db:migrate`, by CI (`pnpm check:boot`).
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Not the API's default port, so a development server already running does not answer instead.
const port = '3399';
const deadline = Date.now() + 60_000;

/** Starts `apps/<name>/dist/main.js` with `env`, keeping its output for the failure report. */
function start(name, env) {
  const child = spawn(process.execPath, [resolve(root, 'apps', name, 'dist', 'main.js')], {
    env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const app = { name, child, output: '', exited: false };
  child.stdout.on('data', (chunk) => {
    app.output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    app.output += chunk;
  });
  child.on('exit', () => {
    app.exited = true;
  });
  return app;
}

async function apiHealthy() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    return response.status === 200 && (await response.json()).status === 'ok';
  } catch {
    return false;
  }
}

async function main() {
  // Synthetic settings the check needs and a server sets for real; no email is sent during it.
  const api = start('api', {
    API_HOST: '127.0.0.1',
    API_PORT: port,
    AUTH_SECRET: 'boot-check-only-secret-of-at-least-32-characters',
  });
  const worker = start('worker', {
    SMTP_URL: 'smtp://127.0.0.1:1025',
    EMAIL_FROM: 'Mizan <mizan@example.test>',
  });
  const apps = [api, worker];
  try {
    while (!(await apiHealthy())) {
      if (api.exited || Date.now() > deadline) throw new Error('the API did not answer 200');
      await sleep(500);
    }
    while (!worker.output.includes('Scheduled system.heartbeat')) {
      if (worker.exited || Date.now() > deadline) throw new Error('the worker did not schedule');
      await sleep(500);
    }
    await sleep(5_000);
    if (worker.exited) throw new Error('the worker stopped after it started');
    console.warn('boot-check: the API answers 200 on /api/health; the worker is up and scheduled');
    return 0;
  } catch (error) {
    console.error(`boot-check: ${error.message}`);
    for (const app of apps) console.error(`--- ${app.name} output ---\n${app.output}`);
    return 1;
  } finally {
    for (const app of apps) if (!app.exited) app.child.kill('SIGTERM');
  }
}

process.exitCode = await main();
