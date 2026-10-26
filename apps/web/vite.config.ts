import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { vertexMizanWeb } from '@vertex-mizan/ui/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API address from the root .env, read without Vite's loadEnv, which would also apply the
// file's NODE_ENV to this build. Nothing from that file reaches the browser bundle.
const rootEnvFile = new URL('../../.env', import.meta.url);
const rootEnv = existsSync(rootEnvFile) ? parseEnv(readFileSync(rootEnvFile, 'utf8')) : {};
const apiHost = process.env.API_HOST ?? rootEnv.API_HOST ?? '127.0.0.1';
const apiPort = process.env.API_PORT ?? rootEnv.API_PORT ?? '3300';

export default defineConfig({
  plugins: [
    // The router plugin must run before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    // theme-init.js before the first paint and the first screen's fonts preloaded (packages/ui).
    vertexMizanWeb(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://${apiHost}:${apiPort}` },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
