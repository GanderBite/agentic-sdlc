<!-- version: 1.0.0 -->

# testcontainers

## Purpose

Encodes `@testcontainers/postgresql` `^10.13.x` usage for MedBridge: starting a per-test-file Postgres 17 container, retrieving its connection string, applying the production migration set via Drizzle's programmatic `migrate()`, sharing the container across `describe` blocks in one file, and tearing down cleanly. Covers infra mechanics only — what to assert inside a test belongs to the `api-integration-testing` strategy skill.

## Consumers

- `tester` (builder persona authoring `apps/api/test/integration/*.test.ts`)
- `code-reviewing` (verifies setup/teardown shape during integration-test review)

## Rules

### Container lifecycle

1. Use `@testcontainers/postgresql`'s `PostgreSqlContainer` class. Never use the bare `testcontainers` package's `GenericContainer` for Postgres — the typed module wires user/password/database defaults and the readiness wait strategy.
2. Pin the image to `postgres:17-alpine` via `.withImage('postgres:17-alpine')`. The version MUST match `docs/TECH_STACK.md §5` and the compose service. Never let the default image float.
3. Await `start()` exactly once per test file, inside `beforeAll`. Store the started container in a `let` declared at file scope so every `describe` and `it` in the file shares it.
4. Call `await container.stop()` in `afterAll`. Never skip teardown — orphaned containers leak across CI runs.
5. Set `beforeAll`/`afterAll` timeout to ≥ 60_000 ms. Cold-pull of `postgres:17-alpine` plus `start()` plus `migrate()` routinely exceeds Vitest's 5_000 ms default.

### Connection string and pool

6. Read the connection string with `container.getConnectionUri()`. Never hand-assemble it from `getHost()`/`getMappedPort()` — the helper handles auth, database name, and port mapping.
7. Construct exactly one `pg.Pool` per container and pass it to `drizzle(pool)` from `drizzle-orm/node-postgres`. Close the pool with `await pool.end()` in `afterAll` BEFORE `container.stop()`.
8. Do not export the test pool from production code paths. Wire the test `db` instance by importing the production module's factory and passing the test pool, or by overriding the module's exported `db` via a test-only seam.

### Migrations

9. Apply schema in `beforeAll` using `migrate(db, { migrationsFolder: '<abs>/apps/api/src/db/migrations' })` from `drizzle-orm/node-postgres/migrator`. The migrations folder MUST be the same one the production `api-migrate` container consumes — never maintain a second migration set for tests.
10. Resolve the migrations folder with `path.resolve(__dirname, '../../src/db/migrations')` (or the ESM equivalent using `import.meta.url`). Never hard-code an absolute path; integration tests run on developer machines and CI.
11. `migrate()` MUST run after `container.start()` resolves and before any test query. Do not parallelize the two.
12. `pgcrypto` is enabled by the first committed migration (provides `gen_random_uuid()`). Never add a separate `CREATE EXTENSION` step in test setup.

### Isolation model

13. One container per test file. Never share a container across files — Vitest runs files in parallel worker processes by default; cross-file sharing requires `globalSetup` and is explicitly out of scope for this skill.
14. Inside a file, isolate tests by truncating tables in `beforeEach`, not by restarting the container. Restarting per test costs ~3–5 s and is forbidden.
15. Do not wrap service-layer code in a test-managed transaction to fake isolation. The architecture decision (TECH_STACK §6, closes ARCHITECTURE §8 Q7) chose file-scoped containers precisely so multi-statement transactions in service code run unmodified.
16. Truncate with `TRUNCATE TABLE <t1>, <t2>, ... RESTART IDENTITY CASCADE` in a single statement. Never delete row-by-row; never drop and re-migrate between tests.

### Performance and reuse

17. Set `TESTCONTAINERS_REUSE_ENABLE=true` and call `.withReuse()` on the container builder when running locally. The Testcontainers daemon keeps a hashed container alive between `pnpm test` invocations, cutting setup from ~6 s to ~200 ms. Never enable reuse in CI — every CI job MUST start from a clean container.
18. Gate reuse on `process.env.CI !== 'true'`. CI sets `CI=true` (GitHub Actions default); local runs do not.
19. Do not preload data via `withCopyFilesToContainer` or SQL init scripts. All seed data goes through the same fixture builders the API integration tests use — owned by `api-integration-testing`.

### Docker prerequisites and failure modes

20. The Docker daemon MUST be running on the host. The `@testcontainers/postgresql` module throws `Could not connect to Docker` on `start()` if it is not. Document this prerequisite in the test file's top-of-file comment when it is the first integration test added to a module.
21. On macOS with Docker Desktop, the default socket path works without configuration. On Linux CI runners, ensure the runner has `docker` group membership or uses the `docker://` service container pattern.
22. Never call `container.exec(['psql', ...])` for assertions. Use the `pg.Pool` over TCP — `exec` is slower, harder to debug, and bypasses the same code path production uses.

### CI considerations

23. In GitHub Actions, use the default `ubuntu-latest` runner; Docker is pre-installed. No extra `services:` block is needed — testcontainers manages container lifecycle from within the test process.
24. Set Vitest's `pool: 'forks'` (already the Vitest 2.x default) so each test file gets its own process, allowing parallel containers to coexist. Never set `pool: 'threads'` for integration tests — Docker socket handles do not survive across threads cleanly.
25. Cap CI concurrency with `vitest --maxWorkers=4` (or lower on small runners). Each worker spawns one Postgres container ≈ 200 MB resident — unbounded parallelism OOMs the runner.

## Template

`apps/api/test/integration/<resource>.<verb>.test.ts`:

```typescript
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as schema from '../../src/db/schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(__dirname, '../../src/db/migrations');

let container: StartedPostgreSqlContainer;
let pool: Pool;
let db: NodePgDatabase<typeof schema>;

beforeAll(async () => {
  const builder = new PostgreSqlContainer('postgres:17-alpine');
  if (process.env.CI !== 'true') builder.withReuse();
  container = await builder.start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
}, 60_000);

afterEach(async () => {
  await pool.query(
    'TRUNCATE TABLE appointment, document, patient, doctor, "user", refresh_token RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await pool.end();
  await container.stop();
}, 30_000);

describe('appointment.create', () => {
  it('persists a row', async () => {
    // db is shared with all describes in this file
  });
});
```

## Examples

### CORRECT — see Template above

Single `beforeAll`/`afterAll` per file, pinned image, programmatic `migrate()` against the production migrations folder, `pg.Pool` over TCP, `TRUNCATE ... RESTART IDENTITY CASCADE` between tests, reuse gated on `!CI`, 60 s timeout.

### INCORRECT — restart container per test

```typescript
beforeEach(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
});
```

WHY wrong: violates Rule 3 (one start per file) and Rule 14 (truncate, do not restart). Adds ~5 s per test for no isolation benefit a `TRUNCATE` does not already provide.

### INCORRECT — transaction-rollback fake-isolation

```typescript
beforeEach(async () => {
  await db.execute(sql`BEGIN`);
});
afterEach(async () => {
  await db.execute(sql`ROLLBACK`);
});
```

WHY wrong: violates Rule 15. The service layer uses `db.transaction(...)` internally for multi-statement writes; an outer `BEGIN`/`ROLLBACK` collides with nested transactions and makes the test exercise a code path production never sees. The architecture decision (TECH_STACK §6) rejected this approach explicitly.

### INCORRECT — unpinned image and missing teardown

```typescript
beforeAll(async () => {
  container = await new PostgreSqlContainer().start(); // floating image
  pool = new Pool({ connectionString: container.getConnectionUri() });
});
// no afterAll
```

WHY wrong: violates Rule 2 (image MUST be `postgres:17-alpine`) and Rule 4 (afterAll teardown is mandatory). Floating images drift from production; missing teardown leaks containers across CI runs and exhausts disk.

### INCORRECT — separate migrations folder for tests

```typescript
await migrate(db, { migrationsFolder: resolve(__dirname, './fixtures/migrations') });
```

WHY wrong: violates Rule 9. A second migration set diverges from production and silently masks migration bugs. The migrations folder MUST be `apps/api/src/db/migrations`.

## Deeper reference

- `references/lifecycle.md` — full lifecycle diagram, timeout tuning, error taxonomy from `@testcontainers/postgresql`, Docker socket configuration.
- `references/ci.md` — GitHub Actions runner configuration, parallelism tuning, troubleshooting `Could not connect to Docker`.
- `references/migrations-in-tests.md` — why programmatic `migrate()` is used in tests despite the drizzle skill's "NEVER auto-migrate on boot" rule, and how the two contexts differ.
