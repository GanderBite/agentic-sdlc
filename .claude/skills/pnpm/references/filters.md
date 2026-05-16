# pnpm `--filter` reference

Cached reference for the `--filter` selector grammar in pnpm 10.x. SKILL.md cites this file by relative path.

## Selector forms

All forms accept globs (`*`, `**`, `?`) and may be combined by repeating `--filter`.

| Form | Meaning |
| --- | --- |
| `--filter <name>` | Match by `package.json#name`. Globs OK: `--filter "@medbridge/*"`. |
| `--filter "./apps/**"` | Match by filesystem path relative to the workspace root. Must contain a `/` or start with `./`. |
| `--filter <name>...` | The package PLUS all packages that depend on it (downstream, transitively). |
| `--filter ...<name>` | The package PLUS all packages it depends on (upstream, transitively). |
| `--filter <name>^...` | Same as `<name>...` but EXCLUDES `<name>` itself; only its dependents. |
| `--filter ...^<name>` | Same as `...<name>` but EXCLUDES `<name>` itself; only its dependencies. |
| `--filter "[<git-ref>]"` | All packages changed since `<git-ref>`. Combine with `...` for transitive impact. |
| `--filter !<name>` | Exclude packages. Applied AFTER other filters. |

The `...` markers can be applied to ANY of the above (name, path, since-ref).

## Common MedBridge recipes

```bash
# Build the api and everything it depends on (transitive upstream).
pnpm --filter ...@medbridge/api build

# Test the contracts package and every package that imports it.
pnpm --filter @medbridge/contracts... test

# Lint only packages changed since main.
pnpm --filter "[origin/main]" lint

# Build everything affected by the current branch's changes.
pnpm --filter "...[origin/main]" build

# Run a script in every workspace EXCEPT the api.
pnpm -r --filter !@medbridge/api typecheck

# Combine path + name (run in apps/* but not @medbridge/ui).
pnpm --filter "./apps/**" --filter !@medbridge/ui test
```

## `-r` vs `--filter`

- `pnpm -r <script>` is shorthand for "all workspace packages that define `<script>`".
- `pnpm --filter <selector> <script>` runs the script only in matched packages.
- `pnpm -r --filter <selector>` is redundant; `--filter` already implies recursive when the selector matches >1 package. Prefer `pnpm --filter ...` alone.

## Ordering

Without `--parallel`, pnpm computes a topological order from `dependencies` / `devDependencies` / `peerDependencies` and runs the script package-by-package in dependency order. With `--parallel`, ordering is abandoned — all matched packages run concurrently. With `--workspace-concurrency=<N>`, pnpm caps concurrent topo-ordered runs at `N`.

## Exit codes

- `0` — script succeeded in every matched package (or no package matched, with `--if-present`).
- non-zero — first failing package's exit code surfaces. `--no-bail` continues past failures and returns 1 at the end.

## Pitfalls

- `--filter` selectors with `@` or `*` MUST be quoted in shells (`"@medbridge/*"`).
- A typo in `<name>` matches zero packages and exits 0. Use `--filter <selector> --if-present=false` if you want a typo to fail loudly (pnpm 10 default: silent skip).
- `--filter "[<ref>]"` requires a valid git ref; in shallow CI clones, fetch the ref first.
