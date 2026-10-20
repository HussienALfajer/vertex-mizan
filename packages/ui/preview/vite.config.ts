import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { vertexMizanWeb } from '../src/vite.ts';

/** The design system's preview page (`pnpm --filter @vertex-mizan/ui preview`), until apps/web. */
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react(), tailwindcss(), vertexMizanWeb()],
  build: { outDir: '../../../.preview/ui', emptyOutDir: true },
});
