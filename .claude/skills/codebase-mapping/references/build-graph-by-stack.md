<!-- version: 1.0.0 -->

# Build-graph commands by stack

Per-stack rules for deriving `.planning/intel/build-graph.json`. The `intel-keeper` consults this when it has detected the package manager but needs the canonical command shape. Every command on this page must be re-validated against the actual manifest before being written — this table is a recipe, not a substitute for reading the manifest.

## How to use this file

1. Detect the package manager from manifest files (rule 2 in `SKILL.md`).
2. Look up the row below.
3. Substitute `<module>` with the workspace/package/crate name.
4. **Confirm the substituted command exists in the manifest.** If the manifest does not define it (e.g., no `test` script in `package.json`), leave that slot absent and document the gap in `INTEL.md`.

## Detection: manifest → package_manager

| Manifest file present | `tools.package_manager` |
|---|---|
| `pnpm-workspace.yaml` or `pnpm-lock.yaml` | `pnpm` |
| `yarn.lock` | `yarn` |
| `bun.lockb` or `bun.lock` | `bun` |
| `package-lock.json` (and none of the above) | `npm` |
| `Cargo.toml` | `cargo` |
| `uv.lock` | `uv` |
| `poetry.lock` | `poetry` |
| `requirements.txt` (and none of the above Python tools) | `pip` |
| `go.mod` | `go` |
| `pom.xml` | `maven` |
| `build.gradle` or `build.gradle.kts` | `gradle` |
| `Gemfile.lock` | `bundler` |
| `composer.lock` | `composer` |
| nothing recognized | `unknown` (fail loudly per `SKILL.md` rule 13) |

If multiple Node lockfiles exist, prefer the most specific (`pnpm-lock.yaml` > `yarn.lock` > `bun.lock` > `package-lock.json`). Treat extra lockfiles as a gap to document in `INTEL.md`.

## pnpm

Workspace projects (most common):

| Slot | Global | Per-module |
|---|---|---|
| test | `pnpm test` | `pnpm --filter <module> test` |
| lint | `pnpm lint` | `pnpm --filter <module> lint` |
| build | `pnpm build` | `pnpm --filter <module> build` |
| typecheck | `pnpm typecheck` | `pnpm --filter <module> typecheck` |

Notes:
- `--filter <module>` requires the workspace package's `name` field, not its path.
- If the project also uses Turborepo (`turbo.json` present), prefer Turbo per the row below — it adds caching the planner gains nothing from circumventing.

## Turborepo (with pnpm/npm/yarn)

| Slot | Global | Per-module |
|---|---|---|
| test | `<pm> turbo run test` | `<pm> turbo run test --filter=<module>` |
| lint | `<pm> turbo run lint` | `<pm> turbo run lint --filter=<module>` |
| build | `<pm> turbo run build` | `<pm> turbo run build --filter=<module>` |

`<pm>` = `pnpm`, `npm exec`, or `yarn` depending on detection. Verify the corresponding `pipeline` keys exist in `turbo.json` before writing them.

## npm

| Slot | Global | Per-module |
|---|---|---|
| test | `npm test` | `npm test --workspace=<module>` |
| lint | `npm run lint` | `npm run lint --workspace=<module>` |
| build | `npm run build` | `npm run build --workspace=<module>` |

`--workspace=` requires `workspaces` in root `package.json`.

## yarn (classic vs berry)

Classic (1.x):

| Slot | Global | Per-module |
|---|---|---|
| test | `yarn test` | `yarn workspace <module> test` |
| lint | `yarn lint` | `yarn workspace <module> lint` |
| build | `yarn build` | `yarn workspace <module> build` |

Berry (3+, `.yarnrc.yml` present): same shape but verify each script via `yarn workspaces foreach -A run …` if the workspace command is missing.

## bun

| Slot | Global | Per-module |
|---|---|---|
| test | `bun test` | `bun --filter <module> test` |
| lint | `bun run lint` | `bun --filter <module> lint` |
| build | `bun run build` | `bun --filter <module> build` |

Bun's filter is recent — confirm `bun --version` is ≥ 1.1 before relying on it; otherwise fall back to per-package `cd` invocations.

## cargo (Rust)

| Slot | Global | Per-module (per-crate) |
|---|---|---|
| test | `cargo test --workspace` | `cargo test -p <crate>` |
| lint | `cargo clippy --workspace --all-targets -- -D warnings` | `cargo clippy -p <crate> --all-targets -- -D warnings` |
| build | `cargo build --workspace` | `cargo build -p <crate>` |
| typecheck | `cargo check --workspace` | `cargo check -p <crate>` |

`<crate>` is the `name` from each member's `Cargo.toml`, not the directory. Skip `--workspace` for single-crate repos.

## uv (Python, modern)

| Slot | Global | Per-module |
|---|---|---|
| test | `uv run pytest` | `uv run pytest <module-path>` |
| lint | `uv run ruff check` | `uv run ruff check <module-path>` |
| typecheck | `uv run mypy` | `uv run mypy <module-path>` |

uv workspaces (`tool.uv.workspace` in `pyproject.toml`): `uv run --package <pkg> <cmd>`.

## poetry (Python, classic)

| Slot | Global | Per-module |
|---|---|---|
| test | `poetry run pytest` | `poetry run pytest <module-path>` |
| lint | `poetry run ruff check` | `poetry run ruff check <module-path>` |
| typecheck | `poetry run mypy` | `poetry run mypy <module-path>` |

Poetry has no first-class workspace concept — per-module is path-scoping.

## pip / venv

| Slot | Global | Per-module |
|---|---|---|
| test | `pytest` | `pytest <module-path>` |
| lint | `ruff check` | `ruff check <module-path>` |

Assume the venv is activated; the planner will not invent `source venv/bin/activate`. If activation is required, document it in `INTEL.md`.

## go

| Slot | Global | Per-module |
|---|---|---|
| test | `go test ./...` | `go test ./<module-path>/...` |
| lint | `golangci-lint run` | `golangci-lint run ./<module-path>/...` |
| build | `go build ./...` | `go build ./<module-path>/...` |
| typecheck | `go vet ./...` | `go vet ./<module-path>/...` |

For Go workspaces (`go.work`), `./...` automatically spans members.

## maven (Java/Kotlin)

| Slot | Global | Per-module |
|---|---|---|
| test | `mvn -B test` | `mvn -B -pl <module> test` |
| build | `mvn -B package` | `mvn -B -pl <module> package` |
| lint | (project-specific plugin) | (project-specific plugin) |

`-pl` requires the module's `<artifactId>` from its `pom.xml`. Use `-am` if dependent modules must build first.

## gradle (Java/Kotlin)

| Slot | Global | Per-module |
|---|---|---|
| test | `./gradlew test` | `./gradlew :<module>:test` |
| build | `./gradlew build` | `./gradlew :<module>:build` |
| lint | `./gradlew check` | `./gradlew :<module>:check` |

Use the wrapper (`./gradlew`), not `gradle`, so versions are pinned.

## bundler (Ruby)

| Slot | Global | Per-module |
|---|---|---|
| test | `bundle exec rspec` (or `rake test`) | path-scoped |
| lint | `bundle exec rubocop` | `bundle exec rubocop <module-path>` |

Confirm `Rakefile` or `spec_helper.rb` before assuming RSpec/rake.

## composer (PHP)

| Slot | Global | Per-module |
|---|---|---|
| test | `composer test` (resolves to script in `composer.json`) | path-scoped |
| lint | `composer lint` (if defined) | path-scoped |

Always read the `scripts` block of `composer.json` to confirm.

## Cross-stack rules

- **Smoke array.** Default to `[global.test, global.build, global.lint]` in that order. Drop slots that are not defined (e.g., omit `build` for pure-Python repos that don't compile).
- **Typecheck slot.** Only set if a real type-checking step exists (TS `tsc`, Python `mypy`, Go `go vet`, Rust `cargo check`). Don't fabricate one for dynamically typed projects.
- **Multi-stack repos.** If a repo has both Node and Python (e.g., a backend + a sidecar), prefer one `build-graph.json` with both stacks represented:
  - `tools.package_manager` set to the *primary* stack (the one that drives the dominant module count).
  - `per_module` keys cover both. The planner picks per-module commands by module identity.
  - Document the multi-stack situation in `INTEL.md` under `## Open gaps`.

## When you cannot find a command

Do not invent. The keeper writes:
- The slot omitted from `build-graph.json`.
- A line in `INTEL.md` under `## Open gaps`: `- build-graph.json missing <slot> for <module> — reason`.

The planner then fails-fast on the first task that needs the missing command and `step.ask`s the human to extend the build graph (`AGENTIC_SDLC.md §5.1.1` step 2). Failing-fast at planning is far cheaper than discovering the gap during a builder's verification step.
