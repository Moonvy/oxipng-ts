import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,js}'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
  },
});
