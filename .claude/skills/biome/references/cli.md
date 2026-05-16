# biome — CLI reference

Biome `^1.9.x` ships a single `biome` binary, invoked via `pnpm exec biome <subcommand>` or as a `package.json` script. This document is the exhaustive subcommand + flag matrix MedBridge uses.

## 1. Subcommands

| Subcommand | What it does | When to use |
|---|---|---|
| `biome check` | Lint + format-check + organize-imports, in one pass. | **Default.** All package scripts and CI use this. |
| `biome lint` | Lint only; no format diagnostics, no import sort. | Rare. Use when isolating a lint failure for debugging. |
| `biome format` | Format only (check or write); no lint diagnostics. | Almost never. Prefer `biome check`. |
| `biome ci` | Equivalent to `biome check --reporter=github` and exit non-zero on any diagnostic. | Optional GitHub Actions UX; we use `biome check` instead for consistency. |
| `biome migrate` | Rewrites `biome.json` to match the current Biome's config schema. | Only when bumping Biome (see `rules.md` §5). |
| `biome explain <rule>` | Prints docs for a rule by name. | Local debugging. |

## 2. Flags (most-used)

### Mutation control

- `--write` — apply safe fixes in place. **Never in CI.** Used by `--write` package scripts and `lint-staged`.
- `--unsafe` — additionally apply potentially-behavior-changing fixes. Only with `--write`. Manual local use only; never wired into a script or hook.
- (no flag) — check-only mode. Exits non-zero on diagnostics, writes nothing. This is what CI uses.

### Scoping

- `--staged` — operate only on files staged in git. Requires `vcs.enabled: true` in `biome.json`. Useful for hooks, but MedBridge prefers passing explicit file lists from `lint-staged`.
- `--changed` — operate on files changed vs. the default VCS branch (also requires `vcs.enabled`).
- Positional paths — files or globs. `biome check src` or `biome check apps packages` are the canonical forms.

### Diagnostic surface

- `--diagnostic-level=<info|warn|error>` — minimum severity to print. Default `info`. Exit code is governed by `--error-on-warnings`.
- `--error-on-warnings` — exit non-zero on warnings too. MedBridge does not set this by default — promote rules to `"error"` in config instead.
- `--reporter=<summary|json|github|junit>` — output format. Default is human-readable. `github` produces annotations in GitHub Actions; we rely on the default to keep the CI step uniform across providers.
- `--max-diagnostics=<N>` — cap the number of diagnostics shown (default 20). Bump to 100 when triaging a large rule introduction.

### Hygiene

- `--no-errors-on-unmatched` — don't exit non-zero when a glob matches no files. **Required in `lint-staged` configs** because lint-staged may pass an empty set.
- `--verbose` — extra logging. Local debugging only.
- `--colors=off` — disable ANSI. Useful when piping to a log file.

## 3. Exit codes

| Exit code | Meaning |
|---|---|
| `0` | No diagnostics at or above the configured level. |
| `1` | One or more diagnostics at or above the configured level. |
| `2` | Configuration error (invalid `biome.json`, unknown rule, bad CLI flags). |
| `3+` | Internal Biome error (rare). Treat as a Biome bug. |

CI MUST treat any non-zero exit as failure. The default `pnpm -r lint` propagates exit codes correctly.

## 4. Canonical invocations

### Local development (mutating)

```bash
pnpm format           # root: biome check --write apps packages
pnpm --filter @medbridge/api format
```

### Local pre-commit (mutating, scoped to staged)

```bash
# lint-staged passes the file list; Biome writes; lint-staged re-adds.
pnpm exec biome check --write --no-errors-on-unmatched <files…>
```

### CI (non-mutating)

```bash
pnpm install --frozen-lockfile
pnpm -r lint          # each workspace runs `biome check src`
pnpm check-boundaries # separate gate, NOT Biome
```

### Triage a single failing rule

```bash
pnpm exec biome explain useExhaustiveDependencies
pnpm exec biome check --max-diagnostics=200 apps/ui/src
```

### Test a Biome version bump locally

```bash
pnpm --filter @medbridge/api exec biome migrate
git diff biome.json
pnpm -r lint
```

## 5. What NOT to do

- Do not run `biome check .` from the repo root without verifying `files.ignore` covers `dist/`, `coverage/`, etc. Prefer explicit roots: `biome check apps packages`.
- Do not pass `--write` from CI under any condition, including "auto-fix bot" workflows. If you need an auto-fix bot, run it in a dedicated workflow that opens a PR — not in the main CI pipeline.
- Do not chain Biome with `prettier` or `eslint`. Both are uninstalled. Reintroducing either is a wave-review reject.
- Do not run `biome check --apply` — that flag was removed in 1.0; use `--write`.
