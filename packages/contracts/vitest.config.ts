import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    clearMocks: true,
    include: [],
    exclude: ['node_modules', 'dist'],
  },
});
