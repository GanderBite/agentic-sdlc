import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    clearMocks: true,
    include: ['test/integration/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    testTimeout: 60000,
  },
});
