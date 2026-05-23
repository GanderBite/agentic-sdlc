# Vitest CLI

## Subcommands

| Subcommand        | Purpose                                                       |
|-------------------|---------------------------------------------------------------|
| `vitest`          | Watch mode. Re-runs affected tests on file change. Local-dev only. |
| `vitest run`      | Single-shot mode. Exit 0 on green, non-zero on red. The CI form. |
| `vitest watch`    | Explicit alias for the default watch mode.                    |
| `vitest bench`    | Run files matching `*.bench.ts`. Not used in MedBridge.       |
| `vitest related <files...>` | Run only the tests that import the listed files (or their transitive importers). |
| `vitest --changed [ref]`    | Run only tests for files changed since the git ref (default `HEAD`). |
| `vitest list`     | Print the test files Vitest would run for the current config. Useful for diagnosing glob mistakes. |

## Most-used flags

| Flag                          | Effect                                                       |
|-------------------------------|--------------------------------------------------------------|
| `--coverage`                  | Enable coverage; require a `coverage` block in config.       |
| `--reporter <name>`           | One of `default | verbose | dot | json | junit | html | tap | tap-flat`. Combine via repeated flag. |
| `-t "<pattern>"` / `--testNamePattern` | Filter by test name (substring or regex).               |
| `--project <name>`            | Run only the named project (see `references/projects.md`). Repeatable. |
| `--bail <n>`                  | Stop after N failures. `--bail 1` is "fail fast".            |
| `--retry <n>`                 | Retry failing tests N times. Use SPARINGLY — it hides flakes. |
| `--reporter=junit --outputFile=junit.xml` | Emit a JUnit XML for CI.                          |
| `--no-coverage`               | Disable coverage even if config defines it.                  |
| `--silent`                    | Suppress test-file `console.log`. CI default in some setups; we leave on for diagnostics. |
| `--ui`                        | Open the Vitest UI in a browser. Local dev only.             |
| `--update` / `-u`             | Update snapshot files. Never in CI.                          |
| `--passWithNoTests`           | Exit 0 when no test files match. Use ONLY in workspaces that legitimately have zero tests (today: `apps/ui`). |

## Selection examples

```bash
# Single file
pnpm vitest run src/modules/scheduling/scheduling.test.ts

# By test name across all files
pnpm vitest run -t "rejects expired"

# Only files importing a specific module
pnpm vitest run --related src/modules/auth/jwt.ts

# Only files changed vs main
pnpm vitest run --changed origin/main
```

## CI pattern (GitHub Actions step)

```yaml
- name: Test
  run: pnpm -r test
- name: Test (coverage)
  if: github.event_name == 'pull_request'
  run: pnpm -r test:coverage
- name: Upload coverage
  if: always() && hashFiles('**/coverage/**') != ''
  uses: actions/upload-artifact@v4
  with:
    name: coverage
    path: '**/coverage/'
```

Note: MedBridge runs `pnpm -r test` (not `pnpm test`) so every workspace's `test` script executes. Workspaces with zero test files (today: `apps/ui`) MUST set `--passWithNoTests` in their script OR omit the `test` script so `pnpm -r` skips them.

## Exit codes

| Code  | Meaning                                            |
|-------|----------------------------------------------------|
| 0     | All tests passed.                                  |
| 1     | One or more tests failed, OR a config error.       |
| Other | Unhandled error inside Vitest itself (rare).       |

## VS Code integration

Install the official "Vitest" extension. It reads each workspace's `vitest.config.ts` automatically when opened as a multi-root workspace and shows the run/debug gutter icons on each `it(...)`. No additional config required.

The extension respects `test.projects`, surfacing both `unit` and `integration` projects in the test explorer. Running an integration test from the gutter will boot the testcontainers fixture exactly as the CLI would — make sure Docker Desktop is running.
