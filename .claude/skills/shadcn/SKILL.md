<!-- version: 1.0.0 -->

# shadcn

## Purpose

Encodes how the Shadcn UI CLI scaffolds Radix-based primitives into MedBridge's `apps/ui/src/components/ui/`, how those project-owned files are customized, composed, themed (Tailwind 4 + dark mode), and paired with `react-hook-form` + Zod from `packages/contracts`.

## Consumers

- `builder` — runs the Shadcn CLI, edits or wraps generated primitives, builds feature forms and surfaces under `apps/ui/src/`.
- `code-reviewer` — checks PRs touching `apps/ui/src/components/ui/**` and `apps/ui/components.json`.

## Stack constants (do not deviate)

- `shadcn` CLI — invoked via `pnpm dlx shadcn@latest …`. No runtime package; the CLI copies source into the repo.
- Radix UI primitives — installed as `@radix-ui/react-*` peer deps by `shadcn add` into `apps/ui/package.json` under `dependencies` (NOT `devDependencies`).
- Tailwind CSS `^4.0.x` — config-as-CSS via `@theme` in `apps/ui/src/index.css`. No `tailwind.config.{js,ts}`. No PostCSS config.
- React `^19.0.x` + TanStack Router/Query, `react-hook-form ^7.54.x`, `@hookform/resolvers/zod`, schemas from `@medbridge/contracts`.
- Class-merge helper: `cn()` exported from `apps/ui/src/lib/utils.ts` (`clsx` + `tailwind-merge`).
- Accessibility floor: WCAG-AAA color contrast; every interactive primitive must keep Radix's keyboard semantics intact.

## Rules

### CLI usage

1. Run the CLI from `apps/ui/`. Never from the repo root, never from another workspace.
2. Use `pnpm dlx shadcn@latest init` exactly once per workspace to write `apps/ui/components.json`. Re-running `init` rewrites the config — never re-init unless the team agrees to migrate.
3. Add one component per command: `pnpm dlx shadcn@latest add <component>`. Never script bulk-add of components the feature does not need.
4. Commit every file the CLI writes under `apps/ui/src/components/ui/` and every dependency the CLI adds to `apps/ui/package.json` in the SAME commit. Never split CLI output across commits.
5. Re-run `add <component>` without `--overwrite` to confirm idempotency. Use `--overwrite` only after stashing local edits — see `references/customization.md` for the diff-then-merge recipe.

### `components.json`

6. `components.json` lives at `apps/ui/components.json`. Never duplicate it under `apps/` or the repo root.
7. Keep the field set listed in the Schema section below. Do not add fields the CLI did not emit.
8. `style` is fixed at `"new-york"` for MedBridge. `baseColor` is fixed at `"neutral"`. `tailwind.cssVariables` is `true`. Changing any of these is a design-system decision, not a build choice.
9. Path aliases (`aliases.components`, `aliases.utils`, `aliases.ui`, `aliases.lib`, `aliases.hooks`) MUST match `apps/ui/tsconfig.json` `paths`. Drift breaks `add`.

### File location and ownership

10. Generated primitives live under `apps/ui/src/components/ui/<name>.tsx`. Domain-specific composites live under `apps/ui/src/components/<feature>/`. Never mix.
11. `apps/ui/src/components/ui/` is reserved for generic, project-agnostic primitives only. Never put feature props, business strings, or MedBridge-specific copy in a file under that directory.
12. Treat the source as project-owned. Edit it freely, but record non-trivial divergences from upstream in a leading comment: `// shadcn:diverged — <reason>`.

### Radix composition

13. Render every Shadcn primitive as the named export the CLI generates (`<Button>`, `<Dialog>`, `<DialogContent>`, `<Select>`, `<SelectTrigger>`, `<Tooltip>`, …). Never reach into `@radix-ui/react-*` directly when a Shadcn wrapper exists for it.
14. Preserve every Radix subcomponent the upstream pattern requires (`Trigger`, `Content`, `Portal`, `Overlay`, `Item`, `Label`, etc.). Never collapse them into a single element — the keyboard/focus semantics live in the subcomponent tree.
15. Forward `ref` and unknown props to the underlying Radix primitive when wrapping. Use `React.forwardRef` + `...props` spread. Never strip the `data-*` and `aria-*` attributes Radix attaches.
16. Use `asChild` (Radix slot pattern) to render a primitive as a different element when semantics demand it — e.g. `<Button asChild><Link to="/x">Go</Link></Button>`. Never wrap a `<Link>` in a `<Button>` to get button styles.

### Accessibility

17. Keep every `aria-*` and `data-state` attribute Radix produces. Style with the `data-[state=open]:`, `data-[state=closed]:`, `data-[disabled]:`, `aria-invalid:` Tailwind variants — never replace state-driven attributes with React state.
18. Provide an accessible name for every icon-only trigger: `<Button aria-label="Close">`. Never rely on the icon's `<title>` alone.
19. Pair every form input with `<Label htmlFor={id}>` or wrap with `<Label>…</Label>`. The Shadcn `<Label>` is the default; never use a raw `<label>` in a Shadcn form surface.
20. Visible focus is mandatory. Keep the `focus-visible:ring-*` utilities the CLI emits. Never write `outline-none` without a matching `focus-visible:ring-*`.

### Dark mode and theming

21. Toggle dark mode by adding/removing the `dark` class on `<html>`. Tailwind 4's `dark:` variant resolves against that class. Never key dark mode off a media query in MedBridge.
22. Read CSS variables (`--background`, `--foreground`, `--primary`, `--ring`, …) from `apps/ui/src/index.css` `@theme` block. Never hardcode hex/rgb in component files — use `bg-background`, `text-foreground`, `border-input`, etc.
23. Define light vs dark token values in the `@theme` and `.dark` blocks of `index.css`. Never add a `dark:` variant for tokens themselves — only for utility classes that compose with those tokens.

### `react-hook-form` integration

24. Use the Shadcn `Form` family from `apps/ui/src/components/ui/form.tsx`: `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormDescription>`, `<FormMessage>`. Never roll a parallel error-rendering layer.
25. `<FormField>` takes `control={form.control}` and a `render={({ field }) => …}` prop. Spread `field` onto the input or pass it through `<FormControl>` to a Radix-state-owning primitive (Select, Checkbox, RadioGroup, Switch).
26. Resolve schemas with `zodResolver(Schema)` where `Schema` is imported from `@medbridge/contracts`. Never redefine validation client-side.
27. `<FormMessage>` renders the resolver's error automatically. Never pass a manual `error` prop or render errors next to `<FormMessage>` — duplication breaks the `aria-describedby` wiring.

### `cn()` and class merging

28. Compose className strings with `cn(...)` from `apps/ui/src/lib/utils.ts`. Never string-concatenate Tailwind classes (`'a ' + 'b'`) — `tailwind-merge` deduplicates conflicting utilities, plain concat does not.
29. Order matters in `cn()`: base classes first, variant-driven classes second, caller-passed `className` LAST so consumers can override. Never put the caller's `className` before defaults.
30. Use `cva` (class-variance-authority) for variant tables the CLI emits (`buttonVariants`, etc.). Never replace `cva` output with hand-written switch statements — variant types fall out of `VariantProps<typeof xVariants>`.

### Customization discipline

31. Prefer wrap-over-edit when MedBridge needs a styled variant: create `apps/ui/src/components/<feature>/PrimaryAction.tsx` that renders `<Button variant="default">` rather than editing `button.tsx`.
32. Edit a primitive in place ONLY when every consumer must change (e.g. WCAG-AAA contrast fix, mandatory `aria-*` attribute). Record the divergence with `// shadcn:diverged — <reason>` per Rule 12.
33. Never re-run `pnpm dlx shadcn@latest add <component> --overwrite` without first running `git status` to confirm the working tree is clean for that file. See `references/customization.md`.

### Forbidden

34. Never import a Radix primitive directly into a feature file. Go through the Shadcn wrapper under `components/ui/`.
35. Never add a Shadcn primitive to `apps/api/` or `packages/contracts/`. The UI is the only consumer.
36. Never publish `apps/ui/src/components/ui/*` from a package. These files are deliberately copied per-app.
37. Never edit `components.json` to add a registry URL that is not the default upstream one.

## Schema — `apps/ui/components.json`

```json
{
  "$schema": "<shadcn-schema-url>",           // OPTIONAL — CLI writes the real URL.
  "style": "new-york",                          // REQUIRED — enum: "new-york" | "default".
  "rsc": false,                                 // REQUIRED — false for Vite SPA; true for Next.js RSC apps.
  "tsx": true,                                  // REQUIRED — TS/TSX output.
  "tailwind": {                                 // REQUIRED
    "config": "",                               // REQUIRED — empty string for Tailwind 4 (config-as-CSS).
    "css": "src/index.css",                     // REQUIRED — path to the file owning @theme.
    "baseColor": "neutral",                     // REQUIRED — enum: "neutral" | "gray" | "zinc" | "stone" | "slate".
    "cssVariables": true,                       // REQUIRED — must be true; tokens are CSS variables.
    "prefix": ""                                // OPTIONAL — utility prefix; "" in MedBridge.
  },
  "aliases": {                                  // REQUIRED — must match tsconfig.json `paths`.
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"                       // REQUIRED — enum: "lucide" | "radix".
}
```

## Examples

### CORRECT — wrapped primitive with caller className and forwarded ref

```tsx
// apps/ui/src/components/patients/DangerButton.tsx
import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = ButtonProps;

export const DangerButton = React.forwardRef<HTMLButtonElement, Props>(
  function DangerButton({ className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        variant="destructive"
        className={cn('uppercase tracking-wide', className)} // caller className LAST
        {...props}
      />
    );
  },
);
```

### CORRECT — Shadcn Form + react-hook-form + Zod contract

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreatePatientSchema, type CreatePatientInput } from '@medbridge/contracts';
import { Button } from '@/components/ui/button';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

export function CreatePatientForm({ onSubmit }: { onSubmit: (v: CreatePatientInput) => Promise<void> }) {
  const form = useForm<CreatePatientInput>({
    resolver: zodResolver(CreatePatientSchema),
    defaultValues: { name: '', dob: '' },
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>Create</Button>
      </form>
    </Form>
  );
}
```

### INCORRECT — direct Radix import + concat classes + missing FormMessage

```tsx
import * as DialogPrimitive from '@radix-ui/react-dialog'; // violates Rule 34 (direct Radix import)

export function ConfirmModal({ open, extra }: { open: boolean; extra: string }) {
  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Content
        className={'p-4 bg-white ' + extra}                 // violates Rule 28 (string concat) and Rule 22 (hardcoded bg-white)
      >
        Are you sure?
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}
```

### INCORRECT — caller className before defaults, no aria-label on icon button

```tsx
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CloseX({ className }: { className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(className, 'rounded-full')}             // violates Rule 29 (caller className must be LAST)
    >
      <X />
    </Button>                                                // violates Rule 18 (icon-only trigger has no aria-label)
  );
}
```

### INCORRECT — bulk-add commit + media-query dark mode

```bash
# violates Rule 3 (bulk-add of components the feature does not need)
pnpm dlx shadcn@latest add button input dialog select tooltip popover accordion alert avatar badge card
```

```css
/* violates Rule 21: media-query dark mode; MedBridge keys dark off the `dark` class on <html> */
@media (prefers-color-scheme: dark) {
  :root { --background: #0a0a0a; }
}
```

## Deeper references

- `references/cli-workflow.md` — full CLI invocations, `init` walkthrough, idempotency check, dependency placement, troubleshooting.
- `references/forms.md` — `Form`/`FormField`/`FormControl` deep dive, `Controller`-equivalent patterns for Select/Checkbox/RadioGroup/Switch/DatePicker, multi-step wizards, server-error reconciliation.
- `references/customization.md` — edit-vs-wrap decision rule, the diff-then-merge recipe, `shadcn:diverged` comment convention, upstream-drift management.
- `references/components.md` — common primitives (`button`, `dialog`, `select`, `tooltip`, `dropdown-menu`, `command`, `popover`, `tabs`, `toast`, `form`, `input`, `label`, `checkbox`, `radio-group`, `switch`, `textarea`, `table`, `sheet`, `accordion`, `alert`, `avatar`, `badge`, `card`, `separator`, `skeleton`) and the Radix primitive each composes.
- `references/theming.md` — Tailwind 4 `@theme` token grammar, light/dark token pairs, WCAG-AAA contrast checks, the `dark` class toggle pattern.

## Glossary

- **Primitive** — a generic file under `components/ui/` (e.g. `button.tsx`) generated by `shadcn add`.
- **Composite** — a feature-level component under `components/<feature>/` that composes one or more primitives.
- **Radix subcomponent** — `*.Trigger`, `*.Content`, `*.Portal`, etc.; the parts that own keyboard/focus semantics.
- **`asChild`** — Radix slot prop that renders the primitive as its single child instead of its own element.
- **`cva`** — `class-variance-authority`; the variant-table helper Shadcn emits for `Button`, `Badge`, `Alert`.
- **Drift point** — a primitive file where local edits diverge from the upstream CLI output.
