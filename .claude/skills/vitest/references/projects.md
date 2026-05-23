# Vitest `test.projects` — multi-suite layout

Vitest 2.1 replaces the top-level `workspace` field with `test.projects` inside `defineConfig`. Use it when a single workspace needs to run two or more disjoint test suites (different `environment`, different `include`, different `setupFiles`). MedBridge uses this in `apps/api` to run `unit` and `integration` projects from a single config.

## When to use it

- A workspace has BOTH colocated unit tests (`src/**/*.test.ts`) AND a separate integration suite (`test/integration/**/*.test.ts`).
- A workspace mixes `node` and `jsdom` environments (not the case in MedBridge today).
- A workspace needs per-suite `setupFiles` (integration needs a testcontainers boot hook; unit does not).

For single-suite packages (`packages/contracts`, `apps/ui`), `test.projects` is unnecessary — just use the flat `test` block.

## Shape

```ts
// apps/api/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Defaults applied to every project unless overridden.
    globals: false,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/db/migrations/**'],
    },

    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['node_modules', 'dist'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.test.ts'],
          exclude: ['node_modules', 'dist'],
          setupFiles: ['./test/integration/setup.ts'], // boots testcontainers
          testTimeout: 60_000,                          // Postgres boot can take seconds
          hookTimeout: 60_000,
          pool: 'forks',                                // one process per file — see Rule 25
          poolOptions: { forks: { singleFork: false } },
        },
      },
    ],
  },
});
```

## Running a single project

```bash
pnpm test --project unit
pnpm test --project integration
```

Multiple `--project` flags select multiple; omitting the flag runs all projects.

## Per-project script wiring

In `apps/api/package.json`:

```json
{
  "scripts": {
    "test": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:all": "vitest run",
    "test:coverage": "vitest run --project unit --coverage"
  }
}
```

Rationale: the default `test` runs unit only (fast, no Docker needed). `test:integration` is opt-in for the wave that touches API routes. `test:all` is what CI invokes when the gate demands both. Coverage measures the unit suite only — integration runs exercise real DB code paths and produce noisy, environment-coupled coverage.

## Constraints

- Project `test.coverage` is ignored — coverage config MUST live on the outer `test` block. Inner projects inherit it.
- Project `name` is required for `--project` selection. Use lowercase kebab-case (`unit`, `integration`, never `Unit` or `Integration Tests`).
- Two projects with the same `include` glob will double-run those files. Verify `include` sets are disjoint.
- Vitest still loads ALL project configs at startup. A broken setup file in `integration` will fail `pnpm test --project unit`. Keep setup files defensive.

## Migration note

If you encounter a legacy `workspace` field (file `vitest.workspace.ts` or top-level `workspace: [...]`), it still works in Vitest 2.1 but is deprecated. Convert to `test.projects` in-place; the inner shape is identical.
