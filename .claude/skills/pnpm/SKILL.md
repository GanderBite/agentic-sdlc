<!-- version: 1.0.0 -->

# pnpm

## Purpose

Rules for using pnpm 10.x as the workspace package manager for MedBridge: lockfile hygiene, recursive (`-r`) and `--filter` commands, the `workspace:*` protocol, dependency placement (deps vs devDeps vs peerDeps), hoisting behavior, and `.npmrc` knobs. Encodes WHAT goes in the lockfile and the workspace manifests — never the BEHAVIOR of when to install.

## Consumers

- `task-builder` — adds/removes deps inside an app or package, runs scripts, ensures lockfile updates are committed.
- `wave-reviewer` — verifies new deps are in the correct manifest section and that `pnpm-lock.yaml` changes match `package.json` changes.
- `verification-gates` author — relies on `pnpm -r <script>` semantics when wiring CI gates.

## Rules

Numbered, imperative, verifiable. The full pnpm reference (selectors, hoisting modes, deep `.npmrc` matrix) lives in `references/`.

### Version + boot

1. The repo root `package.json` MUST contain `"packageManager": "pnpm@10.x.x"` pinned to an exact patch. Corepack reads it; do not change it without a coordinated bump.
2. Never call `npm install` or `yarn install` in this repo. Only `pnpm`.
3. Never commit a `package-lock.json`, `npm-shrinkwrap.json`, or `yarn.lock`. Only `pnpm-lock.yaml`.

### Lockfile

4. Commit `pnpm-lock.yaml` for every change that mutates dependencies. A `package.json` diff without a matching `pnpm-lock.yaml` diff is a wave-review reject.
5. CI and every `Dockerfile` install step MUST use `pnpm install --frozen-lockfile`. This fails the build if `pnpm-lock.yaml` is out of sync with any `package.json`, instead of silently rewriting it.
6. Never hand-edit `pnpm-lock.yaml`. Regenerate with `pnpm install` and commit the result.
7. To upgrade a single dep, run `pnpm --filter <pkg> update <name>@<range>`, never `pnpm install <name>@latest` at root unless the dep belongs at root.

### Workspace layout

8. Workspace globs live in `pnpm-workspace.yaml` at the repo root. For MedBridge:
   ```yaml
   packages:
     - apps/*
     - packages/*
   ```
9. Each workspace package MUST have a unique `name` field. Internal packages use the scoped form `@medbridge/<name>` (e.g. `@medbridge/contracts`).
10. Internal cross-package deps MUST use the `workspace:*` protocol in `package.json`. Never write a registry version range for an internal dep.
    ```json
    "dependencies": { "@medbridge/contracts": "workspace:*" }
    ```
11. On `pnpm publish` (not used in MedBridge today, but reserved), `workspace:*` is rewritten to the published version. Do not assume the literal `workspace:*` survives outside the repo.

### Recursive + filtered commands

12. Run scripts across all workspaces with `pnpm -r <script>`. Run them across a subset with `pnpm --filter <selector> <script>`. See `references/filters.md` for the exhaustive selector list.
13. The standard CI sequence is, in order: `pnpm install --frozen-lockfile`, `pnpm -r build`, `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`. Do not reorder; `typecheck` and `test` may depend on `build` outputs.
14. Use `pnpm -r --parallel <script>` ONLY for scripts with no inter-package ordering (lint, typecheck if standalone). Never for `build` — pnpm computes the topological order automatically without `--parallel`.
15. Use `pnpm --filter <pkg>...` (trailing `...`) to include downstream dependents, `pnpm --filter ...<pkg>` (leading) for upstream dependencies. See `references/filters.md`.

### Dependency placement

16. Place a dep in `dependencies` if it is `require`d / `import`ed by code shipped at runtime.
17. Place a dep in `devDependencies` if it is only used by build tools, tests, linters, type generators, or local scripts.
18. Place a dep in `peerDependencies` only when the package is a library that expects the consumer to provide the dep (typically `@medbridge/contracts` w.r.t. `zod`). Pair every `peerDependencies` entry with a matching `devDependencies` entry so local dev works.
19. Never duplicate a dep across `dependencies` and `devDependencies` in the same `package.json`. Pick one.
20. Add deps in the correct workspace, never at the root, unless the dep is consumed by a root-level script.
    ```bash
    pnpm --filter @medbridge/api add fastify
    pnpm --filter @medbridge/api add -D vitest
    pnpm --filter @medbridge/contracts add zod
    pnpm add -Dw turbo   # root-only tool; -w == workspace root
    ```

### Hoisting + node_modules

21. pnpm uses an isolated `node_modules` by default: only declared deps are resolvable. Never rely on transitive packages — if your code `import`s it, add it to your `package.json`.
22. Do not enable `node-linker=hoisted` or `shamefully-hoist=true` without a documented reason. Both defeat isolation and hide missing deps.
23. The default `.npmrc` for this repo is in `references/npmrc.md`. Treat any added knob as a change requiring review.

### Scripts

24. Define these scripts in every workspace package that supports them: `build`, `lint`, `typecheck`, `test`. Packages without a given script are skipped silently by `pnpm -r <script>`; that is expected, not an error. OPTIONAL: skip scripts that genuinely do not apply (e.g. no `build` for a pure-source contracts package).
25. Use `pnpm <script>` from inside a package, or `pnpm --filter <pkg> <script>` from the root. Never use `pnpm run <script> --` to pass args — pass them after `<script>` directly.

## Schema — `package.json` (workspace member)

```json
{
  "name": "@medbridge/api",                            // required, scoped, unique
  "version": "0.0.0",                                  // required; internal pkgs stay 0.0.0
  "private": true,                                     // required for non-published packages
  "type": "module",                                    // OPTIONAL: ESM packages
  "scripts": {                                         // OPTIONAL
    "build": "tsc -p tsconfig.build.json",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {                                    // OPTIONAL
    "@medbridge/contracts": "workspace:*",             // internal: workspace protocol
    "fastify": "^5.0.0"                                // external: caret range
  },
  "devDependencies": {                                 // OPTIONAL
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  },
  "peerDependencies": {                                // OPTIONAL: only for libraries
    "zod": "^3.23.0"
  }
}
```

Constraints not in the type system:

- `name` MUST be unique across the workspace.
- A `workspace:*` value MUST resolve to a package present in `pnpm-workspace.yaml` globs.
- Every `peerDependencies` entry MUST have a matching `devDependencies` entry (otherwise local installs error in pnpm 10).

## Schema — root `package.json` (minimal)

```json
{
  "name": "medbridge",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

## Examples

### CORRECT — add a runtime dep to one workspace

```bash
pnpm --filter @medbridge/api add fastify
git add apps/api/package.json pnpm-lock.yaml
```

Diff in `apps/api/package.json`:

```json
"dependencies": {
  "@medbridge/contracts": "workspace:*",
  "fastify": "^5.0.0"
}
```

### CORRECT — add a dev tool at the root

```bash
pnpm add -Dw turbo
git add package.json pnpm-lock.yaml
```

### CORRECT — wire an internal package

```json
// apps/ui/package.json
"dependencies": {
  "@medbridge/contracts": "workspace:*"
}
```

### INCORRECT — bare `npm install` in CI

```dockerfile
RUN npm install        # violates Rule 2 and Rule 5
```

Violates Rule 2 (use only pnpm) and Rule 5 (CI MUST use `pnpm install --frozen-lockfile`). FIX:

```dockerfile
RUN corepack enable && pnpm install --frozen-lockfile
```

### INCORRECT — internal dep with a registry range

```json
"dependencies": { "@medbridge/contracts": "^0.1.0" }
```

Violates Rule 10. FIX: `"@medbridge/contracts": "workspace:*"`.

### INCORRECT — `package.json` diff with no lockfile change

```
apps/api/package.json   | 1 +
1 file changed
```

Violates Rule 4 (the lockfile MUST move with the manifest). FIX: re-run `pnpm install`, commit `pnpm-lock.yaml`.

### INCORRECT — dep duplicated across sections

```json
"dependencies": { "zod": "^3.23.0" },
"devDependencies": { "zod": "^3.23.0" }
```

Violates Rule 19. FIX: pick one section based on runtime usage (Rules 16–17).

### INCORRECT — passing args via `--`

```bash
pnpm run test -- --watch     # treats `--watch` inconsistently across scripts
```

Violates Rule 25. FIX: `pnpm test --watch` or `pnpm --filter @medbridge/api test --watch`.

## Deeper reference

- `references/filters.md` — `--filter` selectors (name globs, paths, `...` dependents/dependencies, `[<since>]` since-ref, combinators).
- `references/npmrc.md` — `.npmrc` knobs MedBridge sets and the ones it explicitly leaves at defaults; hoisting modes (`isolated` vs `hoisted`), `auto-install-peers`, `strict-peer-dependencies`, `dedupe-peer-dependents`.
- `references/lockfile.md` — what `--frozen-lockfile` checks, common drift causes, recovery commands, and how `overrides` interact with the lockfile.

## Glossary

- **Workspace** — the set of packages declared in `pnpm-workspace.yaml`. The repo root is also a workspace member (the "workspace root").
- **`workspace:*` protocol** — a dep range that resolves only inside the workspace. Rewritten at publish time.
- **Isolated `node_modules`** — pnpm default: each package sees only its declared deps. Transitives live in `node_modules/.pnpm/` and are not directly resolvable.
- **`--frozen-lockfile`** — install mode that fails instead of mutating `pnpm-lock.yaml`. Reproducibility gate for CI and Docker.

## Builder protocol

Contract per `verification-gates §R6`. Runs **after edits, before `task.verification`**, only when the task mutated `package.json` or `pnpm-workspace.yaml`. Idempotent.

```sh
# Re-sync the lockfile if any manifest changed. Rule 4 says a package.json
# diff without a lockfile diff is a wave-reviewer reject — catch it here.
if printf '%s\n' ${TARGET_FILES} | grep -qE '(^|/)(package\.json|pnpm-workspace\.yaml)$'; then
  pnpm install --lockfile-only
fi

# Assert packageManager pin format (Rule 1). Catches the unsatisfiable-regex
# class of plan defects: validate the actual JSON value, not a string regex.
if [ -f package.json ]; then
  node -e '
    const m = require("./package.json").packageManager || "";
    if (!/^pnpm@\d+\.\d+\.\d+$/.test(m)) {
      console.error(`[pnpm builder protocol] packageManager must match pnpm@X.Y.Z, got: ${m}`);
      process.exit(1);
    }
  '
fi
```

**Why `--lockfile-only` and not bare `pnpm install`:** Builder protocols must not install/extract tarballs (slow, network-touching, mutates `node_modules/`). `--lockfile-only` updates `pnpm-lock.yaml` in place — exactly what Rule 4 requires the builder to commit.

## Verification recipe

Gates the **planner** may append for tasks that touched dependency manifests.

```json
{
  "custom": [
    { "cmd": "pnpm install --frozen-lockfile --offline", "expect_exit": 0 }
  ]
}
```

Recipe rules:
- Only emit when `task.target_files.{create,update}` contains a `package.json` or `pnpm-workspace.yaml`.
- `--frozen-lockfile` is mandatory (Rule 5) — it's the gate that asserts the lockfile and manifests agree. `--offline` keeps the gate hermetic; if a dep was added the Builder protocol already pulled it via `--lockfile-only` + a separate fetch the planner cannot rely on, so the planner only emits this gate when it is confident the cache is warm.
- Never emit `pnpm install` (without `--frozen-lockfile`) as a gate — that mutates the lockfile and turns the gate into an edit.

## Common pitfalls

1. **`packageManager` pin validated with a hand-rolled regex** (the wave-1 block in sprint-001 used `^packageManager\":\s*\"pnpm@10` — no leading `"`, no match possible). FIX: validate the parsed JSON value (`require("./package.json").packageManager`) against `/^pnpm@\d+\.\d+\.\d+$/`, never grep the raw file. Builder protocol above shows the pattern; `sprint-planning §R4a` enforces it at plan time.
2. **`package.json` diff with no `pnpm-lock.yaml` diff** (Rule 4). FIX: Builder protocol runs `pnpm install --lockfile-only` automatically when a manifest is in scope.
3. **Adding a dep at the repo root that belongs in a workspace** (Rule 20). FIX: use `pnpm --filter <pkg> add <dep>`; root deps use `pnpm add -Dw`.
4. **CI step using bare `pnpm install`** instead of `--frozen-lockfile` (Rule 5). FIX: every CI / `Dockerfile` install step is `pnpm install --frozen-lockfile`.
5. **Internal dep with a registry version range** (Rule 10). FIX: `workspace:*`.
