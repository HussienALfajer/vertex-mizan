// PM2 processes for production (ADR 0020, docs/deployment.md). Run by `vertexmizan` from the
// `current` release. The environment comes from shared/.env through Node's --env-file, as the
// apps' `start` scripts read the root .env locally; the owner role's URL is not in it (ADR 0008).
const root = '/srv/mizan.vertexmedia.pro/current';
const env = '/srv/mizan.vertexmedia.pro/shared/.env';
const logs = '/var/log/mizan.vertexmedia.pro';

const common = {
  cwd: root,
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  max_restarts: 10,
  min_uptime: '20s',
  exp_backoff_restart_delay: 200,
  // Nest shutdown hooks close the HTTP server, pg-boss, Chromium and the database pools.
  kill_timeout: 15000,
  time: true,
  merge_logs: true,
  node_args: [`--env-file=${env}`],
  // Set here as well as in .env: production behaviour never depends on one hand-edited file.
  env: { NODE_ENV: 'production' },
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'mizan-api',
      script: 'apps/api/dist/main.js',
      max_memory_restart: '768M',
      out_file: `${logs}/api.out.log`,
      error_file: `${logs}/api.err.log`,
    },
    {
      ...common,
      name: 'mizan-worker',
      script: 'apps/worker/dist/main.js',
      // Chromium runs in its own processes; this bounds the worker's Node heap only.
      max_memory_restart: '1G',
      out_file: `${logs}/worker.out.log`,
      error_file: `${logs}/worker.err.log`,
    },
  ],
};
