import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    clearMocks: true,
    // No test files exist yet; passWithNoTests prevents exit 1 when none are found.
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
