# Shadcn CLI workflow

Detailed CLI usage for MedBridge. SKILL.md covers the high-level rules; this file covers commands, troubleshooting, and dependency placement.

## 1. One-time init

From `apps/ui/`:

```bash
pnpm dlx shadcn@latest init
```

The CLI asks several questions. For MedBridge answer:

- Style → `New York`
- Base color → `Neutral`
- CSS variables → `Yes`
- Tailwind config path → empty (Tailwind 4 has no JS config)
- Components alias → `@/components`
- Utils alias → `@/lib/utils`
- React Server Components → `No` (Vite SPA, see ARCHITECTURE.md §3)
- Icon library → `lucide`

`init` writes/updates:

- `apps/ui/components.json` — see SKILL.md schema section.
- `apps/ui/src/lib/utils.ts` — the `cn()` helper (`clsx` + `tailwind-merge`).
- `apps/ui/src/index.css` — `@theme` block with CSS-variable tokens for light/dark.
- `apps/ui/package.json` — adds `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`.

Commit all of the above in one commit titled `chore(ui): init shadcn`. Do not split.

## 2. Adding a component

```bash
pnpm dlx shadcn@latest add button
pnpm dlx shadcn@latest add dialog
pnpm dlx shadcn@latest add form
```

Each `add` invocation:

1. Writes `apps/ui/src/components/ui/<component>.tsx` (and any helpers like `apps/ui/src/components/ui/dialog.tsx` + portal types).
2. Adds the needed `@radix-ui/react-*` package to `apps/ui/package.json` `dependencies` (NOT `devDependencies` — Radix is a runtime dep).
3. Updates `pnpm-lock.yaml`.

Commit message: `feat(ui): add shadcn <component>`.

## 3. Idempotency check

Re-running `pnpm dlx shadcn@latest add button` (no `--overwrite`) prints `Component already exists. Use --overwrite to overwrite.` and exits 0. Use this to verify a clean working tree before pulling upstream changes.

## 4. Pulling upstream updates (diff-then-merge)

Shadcn does not version components. Upstream changes ship as new file content. To pull them safely:

```bash
# 1. Stash any local edits to the file under management.
git stash push apps/ui/src/components/ui/<component>.tsx

# 2. Force-overwrite from the registry.
pnpm dlx shadcn@latest add <component> --overwrite

# 3. Diff against the previous local version.
git diff apps/ui/src/components/ui/<component>.tsx

# 4. Re-apply your stash (manual conflict resolution if needed).
git stash pop
```

If a conflict persists, prefer the upstream version + re-apply your divergence comment (`// shadcn:diverged — <reason>`). Never silently drop the comment.

## 5. Dependency placement

`pnpm dlx shadcn add` writes Radix deps into the dependency object of `apps/ui/package.json` corresponding to where it found Tailwind. Verify after every add:

```bash
pnpm -F ui list --depth 0 | grep '@radix-ui'
```

Radix packages MUST be in `dependencies`, not `devDependencies`. If the CLI miscategorizes them, move them with `pnpm -F ui remove @radix-ui/react-foo && pnpm -F ui add @radix-ui/react-foo`.

## 6. Removing a component

There is no `shadcn remove`. Delete the file by hand and prune the orphaned Radix dep:

```bash
rm apps/ui/src/components/ui/<component>.tsx
pnpm -F ui remove @radix-ui/react-<primitive>
```

Search the repo for residual imports before committing.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module '@/components/ui/button'` | `aliases` in `components.json` drift from `tsconfig.json` `paths`. | Sync both. |
| `cn is not a function` | `init` did not run, or `lib/utils.ts` was deleted. | Re-run `init` or recreate `cn()` (see SKILL.md Rule 28). |
| CLI exits with `No tailwind config detected` | Tailwind 4 has no JS config; CLI sometimes still looks. | Pass `--config ""` or accept the prompt as empty. |
| `Failed to install dependencies` | Network or registry block. | Run the install manually with `pnpm -F ui add <pkg>` and resume. |
| `--overwrite` clobbered local edits | No stash before re-run. | Use the diff-then-merge recipe in §4. Recover from `git reflog` if uncommitted. |

## 8. CI implications

`pnpm dlx shadcn@latest` is a network operation. NEVER include it in CI. CI only runs `pnpm install --frozen-lockfile` against the committed files. The CLI is a developer-laptop tool.
