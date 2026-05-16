# testcontainers — CI configuration

## GitHub Actions (`.github/workflows/ci.yml`)

The MedBridge CI runs on `ubuntu-latest`, which ships Docker pre-installed and running. No extra setup steps are required for testcontainers — the test process spawns containers itself.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 25
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: pnpm -r lint
      - run: pnpm -r typecheck
      - run: pnpm -r test
        env:
          CI: 'true'
```

`CI=true` is already set by GitHub Actions; the explicit `env` block makes the reuse gate (Rule 18) deterministic for any runner that omits it.

## Pre-pulling the image (optional optimization)

Cold image pull adds 10–30 s to the first test file. To amortize across all integration test files in one CI job, pre-pull once:

```yaml
      - name: Pre-pull Postgres image
        run: docker pull postgres:17-alpine
      - run: pnpm -r test
```

This is optional — testcontainers handles pulling on first `start()` automatically.

## Parallelism

Vitest 2.x defaults to `pool: 'forks'` with `maxWorkers = os.cpus().length`. Each fork that loads an integration test file spawns one Postgres container. On a 4-vCPU GitHub-hosted runner this yields ≤ 4 concurrent containers — fine for the runner's 16 GB RAM.

For self-hosted runners with fewer cores or less memory, cap explicitly:

```jsonc
// apps/api/vitest.config.ts
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
  },
});
```

Or per-invocation: `pnpm --filter api test -- --maxWorkers=4`.

## Memory budget

Per integration-test fork: ~250 MB (Node test runner + drizzle + pg + open pool + container metadata). Per Postgres container: ~200 MB resident. Budget ≈ 450 MB per parallel test file. A 16 GB runner safely sustains 8 parallel forks; a 7 GB runner caps at 4.

## Self-hosted Linux runners

Ensure the runner user is in the `docker` group, or the runner service runs with permission to access `/var/run/docker.sock`. The testcontainers library does NOT use `sudo` — UID 0 is not required, but socket access is.

If running inside Docker (DinD), mount the host socket:

```yaml
container:
  image: node:25-alpine
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
```

This is the "sibling container" pattern. Avoid the alternative `docker:dind` service — it adds startup cost without any benefit for testcontainers.

## Troubleshooting CI-only failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Works locally, fails in CI with `Could not connect to Docker` | Runner has no Docker daemon (self-hosted) | Install Docker on the runner, or switch to `ubuntu-latest` (GitHub-hosted) |
| `getMappedPort` returns the wrong port | TestContainers is using `host.docker.internal` from a DinD context | Set `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` only when actually running DinD; remove on bare runners |
| Random `ECONNRESET` mid-test | Container OOM-killed (default shared_buffers too high) | Add `.withCommand(['postgres', '-c', 'shared_buffers=64MB'])` to the container builder |
| Tests pass but CI step exits with code 137 | Runner OOM under parallelism | Cap `maxWorkers` per the memory budget above |

## Cache strategy

Do NOT cache `~/.testcontainers` between CI runs — it stores ephemeral state. DO cache the Node modules and pnpm store. Docker layer cache for `postgres:17-alpine` is provided by the runner's local daemon and does not need to be configured explicitly on GitHub-hosted runners.
