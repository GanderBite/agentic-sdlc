# `.npmrc` reference for MedBridge

Cached reference for the pnpm `.npmrc` knobs that matter to this repo. The repo root `.npmrc` is small on purpose — every added line is a deviation requiring review.

## Recommended root `.npmrc`

```ini
# Use the default isolated linker. Each package sees only its declared deps.
# (This is the default in pnpm 10; written for explicitness.)
node-linker=isolated

# Auto-install peer dependencies declared by direct deps. pnpm 10 default = true.
auto-install-peers=true

# Fail install when a peer dep is missing or mismatched. We want loud failures.
strict-peer-dependencies=true

# Resolve peers to a single instance when multiple dependents agree on a range.
dedupe-peer-dependents=true

# Save versions with the caret range by default.
save-prefix=^

# Pin the registry; corepack already pins pnpm itself.
registry=https://registry.npmjs.org/
```

## Knob matrix (pnpm 10.x)

| Knob | Default | MedBridge | Effect when changed |
| --- | --- | --- | --- |
| `node-linker` | `isolated` | `isolated` | `hoisted` recreates an npm-style flat `node_modules` and hides missing deps; `pnp` switches to Yarn Plug'n'Play resolution. |
| `shamefully-hoist` | `false` | `false` | When `true`, hoists ALL deps to the workspace `node_modules/`. Defeats isolation; reserved for tools that monkey-patch resolution (rare). |
| `hoist-pattern` | `["*eslint*", "*prettier*"]` | default | List of patterns to hoist to the workspace `node_modules/.pnpm/<pkg>/node_modules`. Affects only `node_modules/.pnpm`. |
| `public-hoist-pattern` | `["*types*", "*eslint*", "@types/*"]` | default | Patterns hoisted to the workspace ROOT `node_modules/`. Avoid adding to this; prefer explicit deps. |
| `auto-install-peers` | `true` | `true` | When `false`, peer deps must be installed manually in every consumer. |
| `strict-peer-dependencies` | `true` | `true` | When `false`, missing/mismatched peers warn instead of erroring. |
| `dedupe-peer-dependents` | `true` | `true` | Reduces duplicate copies of peer-shared packages. |
| `prefer-frozen-lockfile` | `true` | default | In CI, pnpm uses `--frozen-lockfile` even without the flag. We pass `--frozen-lockfile` explicitly anyway. |
| `resolution-mode` | `highest` | default | `time-based` prefers older versions when ranges allow. Don't change without a reason. |
| `save-workspace-protocol` | `rolling` | default | Controls how `pnpm add @medbridge/contracts` writes the version: `rolling` → `workspace:^`, `true` → `workspace:*`, `false` → resolved version. Rule 10 in SKILL.md mandates `workspace:*`. |
| `link-workspace-packages` | `true` | default | When `false`, internal deps resolve from the registry instead of via symlinks. Never disable in a monorepo. |
| `prefer-workspace-packages` | `false` | default | When `true`, pnpm picks workspace versions even if registry has higher matching versions. Leave off; rely on `workspace:*`. |

## Per-package `.npmrc`

`.npmrc` can live in a workspace package as well as at the root. Per-package overrides are scoped to that package's install. Use them rarely — prefer encoding the knob at the workspace root so behavior is uniform.

## CI hardening

Add to the workspace `.npmrc` for CI parity:

```ini
# Fail loudly when scripts try to write outside the package's node_modules.
fund=false
audit=false
```

(Both also accepted as CLI flags: `pnpm install --no-fund --no-audit`.)

## See also

- `references/lockfile.md` — how these knobs interact with `pnpm-lock.yaml`.
- `references/filters.md` — selector grammar; orthogonal to `.npmrc`.
