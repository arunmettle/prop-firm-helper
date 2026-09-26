import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests share one Postgres database; run files sequentially.
    fileParallelism: false,
    setupFiles: ['test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
