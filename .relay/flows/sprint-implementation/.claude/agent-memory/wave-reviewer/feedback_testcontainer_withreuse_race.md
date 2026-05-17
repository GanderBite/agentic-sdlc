---
name: feedback_testcontainer_withreuse_race
description: Sprint-001 integration tests flake because every test file calls container.stop() in afterAll while sharing a withReuse() container. singleFork mitigates but does not fix.
metadata:
  type: feedback
---

When integration test files share a Testcontainers container via `builder.withReuse()` but each file independently calls `container.stop()` in `afterAll`, the docker daemon races: the first file to finish stops the container, subsequent files get a `(HTTP code 404) no such container` from `docker-modem` when their own `container.stop()` runs. Symptom in vitest output: a `TypeError: Cannot read properties of undefined (reading 'pool')` cascades because the failing file's `beforeAll` already errored out and `testDb` is undefined.

**Why:** Observed in sprint-001 wave-smoke 2nd attempt. Phase 1 test gate failed on attempt 1 (`auth.constant-time.test.ts`), passed clean on attempt 2. The vitest.config.ts `pool: 'forks' + singleFork: true` fix added in the wave reduces parallelism but does NOT prevent the race because all 11 integration files still call `stopPostgresContainer` in their own `afterAll`.

**How to apply:** When reviewing waves that add testcontainers + withReuse(), check whether container lifecycle (start/stop) lives in per-file `beforeAll/afterAll` vs `vitest globalSetup/globalTeardown`. Per-file → flag `high`/architecture with recommendation to move to globalSetup. Also remember to retry the tests gate up to R3's cap of 2 when this is the failure signature — the bug is real but the run-to-run outcome is non-deterministic.

Related: [[feedback_vitest_projects]] (projects-key trap), [[project_sprint001_lockfile]].
