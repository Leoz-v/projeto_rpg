import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      // rules-engine é consumido como fonte TS do workspace: precisa entrar no bundle.
      externalizeDeps: { exclude: ['rules-engine'] },
    },
  },
  preload: {
    build: {
      // Preload roda com sandbox: true e não pode dar require em pacotes; tudo vai no bundle.
      externalizeDeps: false,
    },
  },
  renderer: {
    resolve: {
      alias: { '@renderer': resolve(import.meta.dirname, 'src/renderer/src') },
    },
    plugins: [react()],
  },
});
