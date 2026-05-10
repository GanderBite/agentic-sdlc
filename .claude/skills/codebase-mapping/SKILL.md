<!-- version: 1.0.0 -->

# codebase-mapping

## Purpose

Codify how to derive `docs/INTEL.md` and `.planning/intel/{modules.json, conventions.md, hot-files.md, test-layout.md, build-graph.json, schema.md, .snapshot}` so the planner can rely on field-level precision instead of parsing prose. See `AGENTIC_SDLC.md §4` and `§4.1`.

## Consumers

- **`intel-keeper`** — invokes this skill on every fresh build (no `.snapshot`) and every diff run (`.snapshot` exists). Writes all intel artifacts to disk.
- **`sprint-planner`** (downstream reader; `.claude/agents/sprint-planner.md`) — derives `task.target_files`, `task.verification`, and `task.context` strictly from these files. Loose intel produces broken plans.

## Rules

1. **Two modes only.** `.planning/intel/.snapshot` absent → FRESH RUN. Present → DIFF RUN. Switch is the file's existence; never mix the two.
2. **FRESH RUN steps (in order):** (a) `Glob` source files; (b) detect language and package manager from manifests; (c) enumerate modules from workspace config or top-level package boundaries; (d) derive `build-graph.json` commands strictly from the manifest's scripts/tasks; (e) write all seven intel files; (f) write `.snapshot` containing `git rev-parse HEAD`.
3. **DIFF RUN steps (in order):** (a) read `.planning/intel/.snapshot`; (b) run `git diff <snapshot>..HEAD --name-only`; (c) zero changed files → exit without rewriting; (d) for each changed path, map to intel file(s) using rule 4; (e) patch only those files; (f) update `.snapshot` to current `HEAD`.
4. **Path → intel mapping (DIFF RUN).** A file may map to multiple intel files. Prefer narrower update over rewrite.

   | Changed path pattern | Intel file(s) to patch |
   |---|---|
   | manifest files (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, etc.) | `build-graph.json`, `conventions.md`, `INTEL.md` |
   | new/removed top-level dir under a module root | `modules.json`, `INTEL.md` |
   | source file with new/removed cross-module imports | `modules.json` (`depends_on`), `hot-files.md` |
   | files in test directories or matching test glob | `test-layout.md` |
   | schema/migration files (`prisma/schema.prisma`, `*.sql`, `migrations/`, `alembic/`) | `schema.md` |
   | style/lint config (`.eslintrc`, `biome.json`, `ruff.toml`, `.prettierrc`) | `conventions.md` |
   | nothing matches | no patch; update `.snapshot` only |

5. **Never invent commands.** Every command in `build-graph.json` traces to a manifest entry. If a slot is undefined in the manifest, omit it and add an `## Open gaps` line in `INTEL.md`. The planner fails-fast (`§5.1.1` step 2) and the human extends the graph.
6. **Never speculate about modules that don't exist.** Document only modules verifiable via `Read`/`Glob`. Mark ambiguous purpose `inferred`, never fabricate.
7. **Never rewrite when nothing changed.** A clean `git diff` on DIFF RUN is a no-op. This is the single biggest cost saving in the pipeline (`§4`).
8. **Never include URL schemes (`http`-colon-slash-slash, `https`-colon-slash-slash) in `conventions.md`.** Cache cited content into `references/` then link locally. The linter (`§19.3`) rejects any SKILL.md or intel file containing such schemes.
9. **Conventions sections are self-contained.** The planner copies one section at a time into `task.context` (`§5.1.1` step 1). No cross-references like "see Logging above."
10. **Hot-files threshold = 15%** of last 200 commits. `OPTIONAL:` override via `INTEL_HOT_FILES_PCT`. Command:
    ```bash
    git log -n 200 --pretty=format: --name-only \
      | sort | uniq -c | sort -rn \
      | awk -v T=30 '$1>=T {print $2 " (" $1 ")"}'
    ```
    `T=30` is `200 × 0.15`. Adjust if the env var is set.
11. **Per-stack command derivation.** See `references/build-graph-by-stack.md`. The planner reads only `build-graph.json`; it never sees the table.
12. **Unknown stack → fail loudly.** If no manifest is recognized, set `tools.package_manager: "unknown"`, `global: {}`, exit 1 with a diagnostic. Never guess.
13. **`.snapshot` format.** Single line, output of `git rev-parse HEAD`. No JSON, no header, no comments.
14. **Atomicity.** Write each file via temp-file + rename. A crashed run must not leave a partial intel file for the planner to read.

## Schema / Format / Template

### `.planning/intel/modules.json`

```json
{
  "modules": [
    {
      "name": "resource",
      "path": "src/modules/resource",
      "language": "typescript",
      "test_path": "src/modules/resource/__tests__",
      "depends_on": ["common", "auth"],
      "exports": ["src/modules/resource/index.ts"],
      "owners": ["@team-platform"]
    }
  ]
}
```

- `modules[]` REQUIRED (array, may be empty).
- `modules[].name` REQUIRED, **unique** across the array, matches `[a-z0-9][a-z0-9-]*`.
- `modules[].path` REQUIRED, repo-relative; the directory must exist.
- `modules[].language` REQUIRED, one of: `typescript`, `javascript`, `python`, `go`, `rust`, `java`, `kotlin`, `ruby`, `php`, `csharp`, `swift`, `unknown`. No other values.
- `modules[].test_path` OPTIONAL.
- `modules[].depends_on` REQUIRED, array of `name`s in this same `modules[]`. May be empty. Must NOT contain self.
- `modules[].exports` OPTIONAL, repo-relative paths to public entry points.
- `modules[].owners` OPTIONAL, array of strings (`@team-…` or email).

### `.planning/intel/build-graph.json`

```json
{
  "tools": {
    "package_manager": "pnpm",
    "test_runner": "vitest",
    "linter": "biome",
    "builder": "tsc"
  },
  "global": {
    "test":      "pnpm test",
    "lint":      "pnpm lint",
    "build":     "pnpm build",
    "typecheck": "pnpm typecheck"
  },
  "per_module": {
    "resource": {
      "test":  "pnpm test --filter resource",
      "lint":  "pnpm lint --filter resource",
      "build": "pnpm build --filter resource"
    }
  },
  "smoke": ["pnpm test", "pnpm build", "pnpm lint"]
}
```

- `tools.package_manager` REQUIRED, one of: `pnpm`, `npm`, `yarn`, `bun`, `cargo`, `uv`, `poetry`, `pip`, `go`, `maven`, `gradle`, `bundler`, `composer`, `unknown`. No other values.
- `tools.test_runner`, `tools.linter`, `tools.builder` OPTIONAL strings.
- `global.test` REQUIRED. `global.lint`, `global.build`, `global.typecheck` OPTIONAL but recommended. Each value is a single shell command derivable from the manifest.
- `per_module[<name>]` OPTIONAL; key MUST match a `modules[].name`. Missing entry signals "no per-module command — planner falls back to `global`."
- `per_module[<name>].test|lint|build` same shape as `global`.
- `smoke` REQUIRED, array of commands the smoke wave runs (`§10.5`). Order matters; commands run sequentially. Default: `[global.test, global.build, global.lint]`, dropping undefined slots.

### `.planning/intel/conventions.md`

Required sections, in order, each as a top-level `##` heading: `Naming`, `Layering`, `Error handling`, `Logging`, `Public/private boundaries`, `Test conventions`. Each MUST stand alone (planner copies one at a time).

### `.planning/intel/hot-files.md`

Header: `# Hot files (touched in >N% of last 200 commits, N=15)`. Then a list sorted descending by commit count:

```
- `src/modules/index.ts` (47 commits)
- `src/common/logger.ts` (38 commits)
```

Used by the planner as a soft signal to add files to `task.target_files.may_also_touch`.

### `.planning/intel/test-layout.md`

Required `##` sections: `Test locations` (paths/globs), `Naming` (e.g., `*.spec.ts`, `test_*.py`), `Fixtures` (location + convention), `Mock strategy` (library + project rules), `How to run` (exact commands; must match `build-graph.json`).

### `.planning/intel/schema.md`

Required `##` sections: `Storage` (engine + version), `Migration tool` (tool + migration directory path), `Domain entities` (one line each), `How to apply` (exact migration command). If the project has no data layer, write a single line: `No data layer in this project.`

### `.planning/intel/.snapshot`

Single line: `git rev-parse HEAD` output. No JSON, no header, no comments.

### `docs/INTEL.md`

Required `##` sections: `Overview` (2–4 sentences), `Stack` (language(s), package manager, frameworks), `Modules` (table: `name | path | language | depends_on`), `How to build/test/lint` (copy from `build-graph.global`), `Pointers` (bullet list linking to each `.planning/intel/*` file), `Open gaps` (anything `unknown` or `inferred`; empty section permitted).

## Examples

### CORRECT — `build-graph.json` derived from a pnpm workspace manifest

`package.json` has `"scripts": { "test": "vitest", "lint": "biome check", "build": "tsc -b" }`; `pnpm-workspace.yaml` lists `packages/*` including `resource`.

```json
{
  "tools": { "package_manager": "pnpm", "test_runner": "vitest", "linter": "biome", "builder": "tsc" },
  "global": {
    "test":  "pnpm test",
    "lint":  "pnpm lint",
    "build": "pnpm build"
  },
  "per_module": {
    "resource": { "test": "pnpm --filter resource test", "lint": "pnpm --filter resource lint", "build": "pnpm --filter resource build" }
  },
  "smoke": ["pnpm test", "pnpm build", "pnpm lint"]
}
```

Why correct: every command maps to a script in `package.json`. `--filter resource` is a real pnpm flag and `resource` is a real workspace package. `package_manager` is from the enum.

### INCORRECT — invented commands

```json
{
  "tools": { "package_manager": "pnpm", "test_runner": "jest" },
  "global": {
    "test":  "pnpm run all-tests",
    "lint":  "pnpm lint:strict",
    "build": "pnpm build:prod"
  },
  "per_module": {
    "resource": { "test": "pnpm test:resource:full" }
  },
  "smoke": ["pnpm full-ci"]
}
```

Why wrong:
- `package.json` defines `test`, `lint`, `build` — not `all-tests`, `lint:strict`, `build:prod`. Script names invented.
- `test:resource:full` is not a script and not a valid filter shape.
- `pnpm full-ci` is fabricated.
- `test_runner: jest` contradicts the manifest's `vitest`.

The planner copies these into `task.verification`. Every builder fails at gate execution. The plan validator (`§19.1`) only catches the cascading failure at the verification-token check — meanwhile the keeper's own error has already corrupted every task.

### CORRECT — DIFF RUN with no changes

```
$ git diff <snapshot>..HEAD --name-only
(empty)
```

Action: do nothing. Do not touch any intel file. Do not update `.snapshot` (already current). Report "intel up to date" and exit.

### INCORRECT — DIFF RUN that rewrites everything

Re-running the FRESH RUN procedure on every invocation, ignoring `.snapshot`. Burns the diff-only refresh — the single biggest cost saving in the pipeline.

## Glossary

- **Intel artifact set** — the seven files under `.planning/intel/` plus `docs/INTEL.md`.
- **FRESH RUN / DIFF RUN** — the two operating modes; switch is `.planning/intel/.snapshot` existence.
- **Smoke wave** — final wave of every sprint; runs `build-graph.smoke` (`§10.5`).
- **Hot file** — file touched in >15% of last 200 commits (override: `INTEL_HOT_FILES_PCT`).
- **Manifest** — the package manager's project descriptor (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, etc.). Single source of truth for build commands.
