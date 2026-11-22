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
        },
      },
    ],
  },
});
