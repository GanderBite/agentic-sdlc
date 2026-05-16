import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          globals: false,
          clearMocks: true,
          include: ['src/**/*.test.ts'],
          exclude: ['node_modules', 'dist', 'src/**/*.d.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          globals: false,
          clearMocks: true,
          include: ['test/integration/**/*.test.ts'],
          exclude: ['node_modules', 'dist'],
          testTimeout: 60000,
        },
      },
    ],
  },
});
