# Customization: edit vs wrap

Shadcn primitives are project-owned. There is no upstream version pin — every local edit is a drift point. This file expands SKILL.md Rules 12, 31–33.

## 1. The wrap-vs-edit decision

Decide BEFORE writing any code:

| Question | Answer | Action |
|---|---|---|
| Does the change apply to every consumer of the primitive? | yes | Edit `components/ui/<x>.tsx` in place. |
| Does the change apply to one feature or one variant? | yes | Wrap in `components/<feature>/<X>.tsx`. |
| Does the change add a new variant to an existing `cva` table? | yes | Edit `components/ui/<x>.tsx` to extend `xVariants.variants`. |
| Does the change add an `aria-*` or `data-*` attribute Radix did not emit? | yes | Wrap — adding to the primitive breaks future `--overwrite`. |
| Does the change fix WCAG-AAA contrast or a keyboard bug? | yes | Edit in place. Contrast and a11y are universal. |
| Does the change change the export shape (rename, signature)? | yes | Edit in place; bump the primitive's local version comment. |

When you edit in place, the file gets a leading divergence comment:

```tsx
// shadcn:diverged — raise focus ring contrast to AAA (4.5:1 vs 3:1 default).
// Reapply on shadcn add --overwrite. See PR #123 for the prior content.
import * as React from 'react';
// …
```

Keep one `shadcn:diverged` comment per file. Append to the existing comment when adding new divergences. Never delete it without confirming the upstream now matches.

## 2. Wrap-pattern template

```tsx
// apps/ui/src/components/patients/PatientActionButton.tsx
import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = ButtonProps & {
  intent: 'primary' | 'danger';
};

export const PatientActionButton = React.forwardRef<HTMLButtonElement, Props>(
  function PatientActionButton({ intent, className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        variant={intent === 'danger' ? 'destructive' : 'default'}
        className={cn('min-w-32', className)}
        {...props}
      />
    );
  },
);
```

Notes:

- `ButtonProps` is exported from the primitive — re-use it; do not redeclare.
- Forward `ref`. Radix focus management depends on it.
- Caller `className` comes LAST in `cn()` (SKILL.md Rule 29).

## 3. Adding a `cva` variant in place

```tsx
// apps/ui/src/components/ui/button.tsx
// shadcn:diverged — added `medbridge` variant for primary CTAs.
const buttonVariants = cva(
  'inline-flex items-center justify-center …',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        medbridge: 'bg-medical-teal text-white shadow-md hover:bg-medical-teal/90', // ADDED
      },
      size: { /* … */ },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
```

`VariantProps<typeof buttonVariants>` picks up the new variant automatically. Type-check after every edit.

## 4. Diff-then-merge recipe (pulling upstream)

```bash
# 1. Confirm clean working tree for the target file.
git status apps/ui/src/components/ui/button.tsx

# 2. Stash any uncommitted edits.
git stash push apps/ui/src/components/ui/button.tsx

# 3. Force-overwrite from the registry.
cd apps/ui
pnpm dlx shadcn@latest add button --overwrite

# 4. Inspect the new file.
git diff HEAD apps/ui/src/components/ui/button.tsx

# 5. Re-apply local divergences from the stash.
git stash pop
# resolve conflicts; re-add the `shadcn:diverged` comment if removed.

# 6. Verify the build.
pnpm -F ui typecheck && pnpm -F ui build
```

Commit: `chore(ui): refresh button.tsx from shadcn registry`.

## 5. What can go wrong

| Failure mode | Cause | Recovery |
|---|---|---|
| `--overwrite` destroys local edits silently | No stash before re-run. | `git reflog` to find the prior commit; cherry-pick or hard-reset the file. |
| Imports break after `--overwrite` | Upstream renamed a Radix prop. | Read the new file; update consumers. |
| Tailwind utilities drop from upstream classes | New shadcn release migrated to newer Tailwind 4 utilities. | Accept upstream; verify visual; update `@theme` if a token name changed. |
| `cn()` not found | `lib/utils.ts` deleted/renamed by another author. | Recreate from the canonical Shadcn template (see SKILL.md Rule 28 / Stack constants). |
| `forwardRef` deprecation warnings on React 19 | React 19 makes `ref` a regular prop; older Shadcn templates still use `forwardRef`. | Acceptable — upstream is migrating. Do NOT remove `forwardRef` until the registry does. |

## 6. Periodic refresh policy

There is no automatic check. Plan a quarterly "shadcn refresh" task: run §4 for every primitive in `apps/ui/src/components/ui/`, batch-commit one file per commit, and update divergence comments. Visual regression check is manual (a11y review, see brief §7).
