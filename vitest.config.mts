import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      {
        test: {
          name: 'app',
          include: ['src/**/*.test.ts'],
          environment: 'node',
          // Os testes da mesa usam SQLite e WebSocket reais; no Windows da CI já passaram de 5 s.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
