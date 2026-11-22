import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'rules-engine',
    include: ['tests/**/*.test.ts'],
  },
});
