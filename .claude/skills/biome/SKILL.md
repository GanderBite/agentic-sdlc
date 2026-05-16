<!-- version: 1.0.0 -->

# biome

## Purpose

Rules for using Biome `^1.9.x` as MedBridge's single linter + formatter across every workspace. Encodes the shape of `biome.json`, the rule set this repo pins, the CLI surface (`check` vs `lint` vs `format`, `--write` vs CI mode), file ignores, per-workspace overrides, and the pre-commit + CI wiring. Biome replaces ESLint + Prettier entirely. Boundary enforcement (`docs/ARCHITECTURE.md §2.3`) is owned by `scripts/check-boundaries.ts`, NOT by Biome — see Rule 23.

## Consumers

- `task-builder` — runs `biome check --write` after edits; adds/removes rules in `biome.json`; resolves Biome diagnostics in produced TS/TSX.
- `wave-reviewer` — verifies new code passes `biome check` (CI mode, no `--write`); rejects waves that disabled rules without justification.
- `verification-gates` author — wires `pnpm -r lint` (which invokes Biome) as a gate.

## Rules

Numbered, imperative, verifiable. Deeper material (full rule list, CLI matrix, editor + hook wiring) lives in `references/`.

### Config location + shape

1. One `biome.json` lives at the repo root. Never add per-workspace `biome.json` files; use the `overrides` array (Rule 11) instead.
2. The top of `biome.json` MUST set `"$schema": "./node_modules/@biomejs/biome/configuration_schema.json"` so editors validate the config.
3. Enable both subsystems explicitly: `"linter": { "enabled": true }` and `"formatter": { "enabled": true }`. Never rely on defaults.
4. Set `"organizeImports": { "enabled": true }` at the top level. This sorts imports on `biome check --write`.

### Rule selection

5. Set `"linter.rules.recommended": true`. Never disable it wholesale; disable individual rules in-place with a reason comment when justified.
6. Pin these MedBridge-mandatory rules ABOVE the recommended set:
   - `correctness.noUnusedImports: "error"`
   - `style.useImportType: "error"` (forces `import type { … }` for type-only imports — pairs with the `typescript` skill)
   - `suspicious.noExplicitAny: "error"` (no `any`; use `unknown` and narrow — see `typescript` skill rules)
7. Never set a rule to `"off"` in `biome.json` without a sibling `// reason: …` comment in the JSON OR a matching `references/rules.md` entry. Wave-reviewer rejects silent disables.
8. Do not add new rule groups without coordinating with the `wave-reviewer` — rule churn invalidates the existing test/build baseline.

### Formatter

9. Pin the formatter to these values; never diverge per-workspace:
   - `indentStyle: "space"`
   - `indentWidth: 2`
   - `lineWidth: 100`
   - `lineEnding: "lf"`
10. Pin the JS/TS formatter (`javascript.formatter`) to:
    - `quoteStyle: "single"`
    - `jsxQuoteStyle: "double"`
    - `semicolons: "always"`
    - `trailingCommas: "all"`
    - `arrowParentheses: "always"`
11. Use the `overrides` array ONLY to relax these defaults for generated code or vendor dirs. Never use it to change style per-workspace.

### Ignores

12. List ignored paths in `files.ignore` as gitignore-style globs at the repo root. Standard MedBridge ignores: `dist/**`, `build/**`, `coverage/**`, `**/node_modules/**`, `**/migrations/meta/**`, `pnpm-lock.yaml`, `.turbo/**`.
13. Never add `**/*.generated.ts` to `files.ignore` unless the file is genuinely machine-emitted; type-checked generated code MUST still pass Biome.
14. The Drizzle migration SQL meta is excluded (`**/migrations/meta/**`); the `.sql` files themselves are JSON-free and ignored by Biome's default extension list.

### CLI usage

15. Use `biome check` as the canonical command in package scripts and CI. It is the union of lint + format-check + import-sort.
16. Use `biome check --write` to apply safe fixes (writes files in place). Never use `--write` in CI — CI MUST fail when fixes would be needed, not silently apply them.
17. Use `biome check --write --unsafe` only manually and only when reviewing the diff. Never wire `--unsafe` into a script, hook, or CI.
18. Use `biome format` ONLY when explicitly skipping lint diagnostics (rare; almost always prefer `biome check`). `biome lint` exists symmetrically for lint-only runs.
19. Pass exact paths or a glob; never run `biome check .` against the repo root without first verifying `files.ignore` covers `dist/`. Prefer `biome check apps packages` in scripts.
20. Biome exits non-zero when ANY diagnostic is at the configured `--diagnostic-level` (default `error`). Wire scripts to fail on warnings via `--error-on-warnings` if a wave bumps a warn-level rule.

### Workspace scripts

21. Every workspace package (`apps/*`, `packages/*`) MUST expose a `lint` script that runs Biome against its own source. The root `package.json` ships `"lint": "biome check apps packages"`; per-workspace `lint` scripts are `"biome check src"`. `pnpm -r lint` fans out.
22. Every workspace package MUST also expose a `format` script: `"biome check --write src"`. Use this locally before commit; CI never invokes it.

### Boundary enforcement (DO NOT use Biome for this)

23. Module-graph import boundaries (`docs/ARCHITECTURE.md §2.3`) are enforced by `tsx scripts/check-boundaries.ts`, run as its own gate. Never attempt to encode boundary rules in `biome.json` — Biome 1.9 has no equivalent of `eslint-plugin-boundaries`. Adding `noRestrictedImports` patterns for cross-app rules is a Rule 23 violation.

### Pre-commit + CI wiring

24. The repo uses `simple-git-hooks` + `lint-staged`. The pre-commit hook runs `pnpm exec lint-staged`; `lint-staged` maps staged files to `biome check --write --no-errors-on-unmatched <files>`. Staged paths are passed; the hook mutates the working tree, then `lint-staged` re-adds them. See `references/integration.md`.
25. CI runs `pnpm -r lint` AS PART of the standard sequence (`install --frozen-lockfile`, `build`, `lint`, `typecheck`, `test`) defined by the `pnpm` skill. Never insert a separate `biome` CI step — `pnpm -r lint` is the single entry point.
26. The `check-boundaries` gate runs as a separate CI step AFTER `pnpm -r lint`. Failing either gate fails the wave.

## Schema — `biome.json` (root, COMPLETE)

```jsonc
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "organizeImports": { "enabled": true },          // required
  "files": {                                       // required
    "ignore": [
      "dist/**",
      "build/**",
      "coverage/**",
      "**/node_modules/**",
      "**/migrations/meta/**",
      "pnpm-lock.yaml",
      ".turbo/**"
    ]
  },
  "vcs": {                                         // OPTIONAL: enables `--staged` and respects .gitignore
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "linter": {                                      // required
    "enabled": true,
    "rules": {
      "recommended": true,                         // required: keep on
      "correctness": {
        "noUnusedImports": "error"                 // MedBridge-pinned
      },
      "style": {
        "useImportType": "error"                   // MedBridge-pinned
      },
      "suspicious": {
        "noExplicitAny": "error"                   // MedBridge-pinned
      }
    }
  },
  "formatter": {                                   // required
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {                                  // required when formatting JS/TS
    "formatter": {
      "quoteStyle": "single",
      "jsxQuoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  },
  "json": {                                        // OPTIONAL: stays at defaults today
    "formatter": { "trailingCommas": "none" }
  },
  "overrides": [                                   // OPTIONAL
    {
      "include": ["**/*.test.ts", "**/*.test.tsx"],
      "linter": { "rules": { "suspicious": { "noExplicitAny": "off" } } }
      // reason: test fixtures may legitimately reach for `any`; see references/rules.md
    }
  ]
}
```

Field constraints not in JSON-Schema:

- The only valid `"$schema"` value is the local `node_modules` path above; CDN URLs are forbidden (see linter rule §19.3 in `skill-authoring`).
- Every rule severity is one of: `"off" | "warn" | "error"`. No other strings.
- An `overrides[].include` glob MUST match at least one file in the repo; orphan overrides are a wave-review reject.

## Schema — workspace `package.json` lint hooks (MINIMAL)

```json
{
  "scripts": {
    "lint": "biome check src",
    "format": "biome check --write src"
  }
}
```

Root:

```json
{
  "scripts": {
    "lint": "biome check apps packages",
    "format": "biome check --write apps packages",
    "check-boundaries": "tsx scripts/check-boundaries.ts"
  }
}
```

## Examples

### CORRECT — minimal valid `biome.json`

```jsonc
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "organizeImports": { "enabled": true },
  "files": { "ignore": ["dist/**", "**/node_modules/**"] },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": { "noUnusedImports": "error" },
      "style": { "useImportType": "error" },
      "suspicious": { "noExplicitAny": "error" }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "jsxQuoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  }
}
```

### CORRECT — `lint-staged` config (in root `package.json`)

```json
{
  "simple-git-hooks": { "pre-commit": "pnpm exec lint-staged" },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json,jsonc}": "biome check --write --no-errors-on-unmatched"
  }
}
```

### INCORRECT — disabling recommended set

```jsonc
"linter": {
  "enabled": true,
  "rules": { "recommended": false }
}
```

Violates Rule 5. FIX: keep `"recommended": true` and disable specific rules in-place with a reason.

### INCORRECT — `--write` in CI

```yaml
- run: pnpm exec biome check --write apps packages
```

Violates Rule 16 (and Rule 25, which routes lint through `pnpm -r lint`). FIX:

```yaml
- run: pnpm -r lint
```

### INCORRECT — encoding boundaries in `biome.json`

```jsonc
"linter": {
  "rules": {
    "nursery": {
      "noRestrictedImports": {
        "level": "error",
        "options": { "paths": ["apps/api/*"] }
      }
    }
  }
}
```

Violates Rule 23. Cross-workspace boundary rules belong in `scripts/check-boundaries.ts`. FIX: remove the rule; let the boundary gate own it.

### INCORRECT — silent rule disable

```jsonc
"linter": { "rules": { "suspicious": { "noExplicitAny": "off" } } }
```

Violates Rule 7 (no reason comment, no `references/rules.md` entry) and Rule 6 (this rule is MedBridge-pinned). FIX: keep it `"error"` globally; relax via `overrides` for test files with a reason comment.

### INCORRECT — divergent style per workspace

```jsonc
// apps/ui/biome.json  (does not exist; this is illegal)
{ "formatter": { "indentWidth": 4 } }
```

Violates Rule 1 and Rule 9. FIX: there is exactly one `biome.json` at the repo root; if a directory truly needs different style, use an `overrides[].include` entry — but `indentWidth` divergence is a Rule 9 violation regardless.

## Deeper reference

- `references/rules.md` — the recommended rule set Biome 1.9 ships, the MedBridge-pinned trio, justified `overrides` (test fixtures), and rules considered + rejected.
- `references/cli.md` — `biome` CLI surface: `check | lint | format | ci | migrate`, key flags (`--write`, `--unsafe`, `--staged`, `--changed`, `--reporter`, `--diagnostic-level`, `--error-on-warnings`), exit codes.
- `references/integration.md` — `simple-git-hooks` + `lint-staged` wiring, root + per-workspace `package.json` scripts, GitHub Actions step, VS Code `biomejs.biome` extension setup and `editor.defaultFormatter` settings.

## Glossary

- **`biome check`** — the catch-all subcommand: lint + format-check + organize-imports in one pass. Default CI entry.
- **`--write`** — apply safe fixes in place. Local-only; never in CI.
- **`--unsafe`** — additionally apply fixes Biome flags as potentially behavior-changing. Manual review only.
- **Recommended set** — the curated default rules Biome ships per major version. Bumping Biome may change membership; pin Biome to `^1.9.x` and validate on bump.
- **Override** — an entry under `overrides[]` that scopes config changes to a glob. Used for legitimate exceptions (test fixtures), not workspace style drift.
