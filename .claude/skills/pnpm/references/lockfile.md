# `pnpm-lock.yaml` and `--frozen-lockfile`

Cached reference: what the lockfile records, what `--frozen-lockfile` validates, and how to recover from drift.

## What the lockfile records

`pnpm-lock.yaml` is a single YAML file at the workspace root that records, for every package in every workspace member:

- The exact resolved version and integrity hash (`sha512-…`).
- The full set of transitive deps, with their resolved versions.
- The dependency graph keyed by both the package name and its peer-resolution context — pnpm encodes "this copy of `react` was resolved when `peer=@medbridge/ui` was present" via the `(peer)` suffix syntax.
- An `importers:` section per workspace package, recording the deps declared in that package's `package.json`.
- An `overrides:` snapshot when the root `package.json` declares `pnpm.overrides`.

The lockfile is the source of truth for reproducibility. A given `package.json` set + a given lockfile = a deterministic `node_modules` tree across every machine running pnpm 10.x.

## What `--frozen-lockfile` checks

`pnpm install --frozen-lockfile` performs an install that REFUSES to modify the lockfile. It fails the install (non-zero exit) if any of the following is true:

1. `pnpm-lock.yaml` is missing.
2. `pnpm-lock.yaml` was produced by an incompatible major version of pnpm (the `lockfileVersion` field).
3. Any `package.json` in the workspace declares a dep that is not present in the lockfile's `importers:` section for that package.
4. Any `package.json` declares a range that the lockfile's recorded resolution no longer satisfies.
5. Any `overrides`/`patchedDependencies` entry in the root `package.json` differs from the lockfile.
6. A workspace package was added or removed (mismatch with `pnpm-workspace.yaml` globs).

When `--frozen-lockfile` fails, pnpm prints exactly which importer and which spec disagrees. Read that message; do not blindly delete the lockfile.

## Common drift causes

| Cause | Symptom | Fix |
| --- | --- | --- |
| Manual edit to `package.json` without rerunning install | `--frozen-lockfile` fails in CI | Run `pnpm install` locally, commit the lockfile diff. |
| Lockfile committed from a different pnpm major version | `ERR_PNPM_LOCKFILE_BREAKING_CHANGE` | Upgrade pnpm locally to match `packageManager`, rerun `pnpm install`. |
| Forgotten `pnpm install` after merge | Local `node_modules` stale | Run `pnpm install` after every merge; husky `post-merge` hook can automate. |
| `pnpm.overrides` added to root `package.json` only | `--frozen-lockfile` fails | Rerun `pnpm install` so `overrides:` is reflected in the lockfile. |
| Branch with stale lockfile vs main | Merge conflict in `pnpm-lock.yaml` | Resolve by taking the union of `package.json` files, delete `pnpm-lock.yaml`, rerun `pnpm install`, recommit. Never hand-resolve YAML conflicts. |

## Recovery commands

```bash
# Standard regeneration — what 99% of fixes look like.
pnpm install

# Lockfile-only refresh: don't touch node_modules, just bring the lockfile in sync.
pnpm install --lockfile-only

# Rebuild lockfile from scratch (last resort, large diff — review carefully).
rm pnpm-lock.yaml
pnpm install

# Verify the lockfile is in sync without changing anything.
pnpm install --frozen-lockfile --lockfile-only
```

## `overrides`

`pnpm.overrides` in the root `package.json` lets you force a transitive dep to a specific version across the workspace. Example:

```json
{
  "pnpm": {
    "overrides": {
      "semver@<7.5.2": ">=7.5.2"
    }
  }
}
```

After editing `overrides`, you MUST run `pnpm install` so the lockfile's `overrides:` block matches. `--frozen-lockfile` will otherwise reject the install.

## `patchedDependencies`

`pnpm.patchedDependencies` records `.patch` files applied to specific dep versions. Patches live under `patches/`. After adding or editing a patch, rerun `pnpm install` so the lockfile records the patch hash. Both the patch file and the lockfile diff MUST be committed together.

## Lockfile diff hygiene

- A pure version bump on a single dep should produce a small, contiguous diff. Sprawling diffs across unrelated packages usually mean pnpm version skew or an accidental `--no-frozen-lockfile` install.
- Reviewers should sanity-check that the count of changed `importers:` entries equals the number of `package.json` files in the PR.
- Never `git checkout --ours` or `--theirs` the lockfile during a merge. Resolve manifests, then regenerate.
