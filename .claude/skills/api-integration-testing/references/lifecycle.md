# lifecycle.md — container ↔ migration ↔ app ↔ tests

## Ordering inside a test file

```
beforeAll
 ├─ startTestDb()              # testcontainers skill: pulls image, starts, waits for health
 ├─ migrate(db.url)            # drizzle-kit migrate against the container's connection URL
 └─ app = makeApp({ db })      # one Hono app per file; reused across all it()s

beforeEach
 ├─ seed()                     # TRUNCATE ... RESTART IDENTITY CASCADE + insert canonical rows
 └─ request.reset()            # clears cookie jar + CSRF state

afterAll
 └─ stopTestDb()               # SIGTERM + remove
```

## Why `beforeAll` for migrations, not `beforeEach`

Running `drizzle-kit migrate` per test is too slow (full schema apply takes 200–600 ms on a cold container; the canonical fixture seed is 20–40 ms). Migrations are idempotent and isolated from row state — once applied, they stay applied. Truncate-and-seed handles per-test isolation at the row level, which is what tests actually need.

## Why one container per file (not per suite, not per test)

- **Per test:** prohibitive — container startup is 1–3 s. A 200-test suite would take 5–10 minutes just on container boot.
- **Per suite (one shared container):** breaks file-level parallelism. Vitest defaults to running test files in parallel; sharing a container forces serial execution.
- **Per file (chosen):** each file owns a container, files run in parallel, in-file `it`s share state through truncate-and-seed. The per-file startup cost (1–3 s) is amortized over all `it`s in the file.

## Vitest config implications

In `apps/api/vitest.config.ts`, integration tests live in their own project:

```ts
test: {
  projects: [
    { test: { include: ['src/**/*.test.ts'] } },                  // unit
    {
      test: {
        include: ['test/integration/**/*.test.ts'],
        testTimeout: 30_000,                                       // container boot headroom
        hookTimeout: 60_000,                                       // migration + boot
        pool: 'forks',                                             // process isolation per file
        poolOptions: { forks: { singleFork: false } },             // parallel files OK
        sequence: { concurrent: false },                            // in-file: serial it()s
      },
    },
  ],
}
```

The `pool: 'forks'` choice matters: a forked worker per file means a container leak in one file cannot poison another file's worker. Threads share the same Node process and the `pg` connection pool would tangle.

## Environment isolation across parallel files

Each forked worker reads its own `DATABASE_URL` from the container it started. Never read `DATABASE_URL` from `process.env` at module-load time — load it lazily inside the app factory so the per-file container URL wins. The `makeApp({ db })` injection pattern in the skeleton achieves this; a module-level `const db = drizzle(process.env.DATABASE_URL!)` would read the wrong URL.

## Cleanup ordering on failure

If a test throws inside `beforeAll`, Vitest still calls `afterAll`. The `stopTestDb` helper must be tolerant of an undefined/half-started container (no-op if `db` is undefined). Otherwise the failure mode is "real error masked by teardown crash".

## What happens with `--bail`

When Vitest exits early on first failure (`--bail=1`), `afterAll` hooks still fire — but only for files that started. Files that hadn't started have no leak. Use `testcontainers`' reaper container (Ryuk) as the safety net for the rare process kill (`SIGKILL`, OOM). Ryuk wiring is owned by the `testcontainers` skill.

## Migrations on a fresh container

`drizzle-kit migrate` reads from `apps/api/src/db/migrations/`. The journal lives in `meta/_journal.json`. There is no per-test migration generation; the suite uses whatever migrations are committed to the repo. If a feature adds a new migration, that file ships in the same PR as the test.

## Debug mode (keep container alive)

For local debugging, expose an env switch `KEEP_CONTAINER=1` that skips `stopTestDb()` in `afterAll`. The container URL is logged so the developer can `psql` into it. CI must reject this flag — it's local-only.
