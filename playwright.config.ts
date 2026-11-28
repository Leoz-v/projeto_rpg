import { defineConfig } from '@playwright/test';

const ci = process.env['CI'] !== undefined;

/** Testes de ponta a ponta: o app de verdade, pelo Electron (nota 0073). `pnpm test:e2e` gera o build antes. */
export default defineConfig({
  testDir: 'e2e',
  // Cada teste abre mais de um app: um por vez.
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Sem repetição: um teste instável precisa aparecer, não passar na segunda.
  retries: 0,
  forbidOnly: ci,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
});
