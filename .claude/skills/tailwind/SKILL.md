<!-- version: 1.0.0 -->

# tailwind

## Purpose

Encodes idiomatic Tailwind CSS 4 usage for `apps/ui` in MedBridge: `@tailwindcss/vite` setup, CSS-first config via `@theme`, layer/`@utility` directives, dark mode, the `cn()` composition helper, and WCAG-AAA focus/contrast rules.

## Consumers

- `builder` — writes/edits CSS, components, and design tokens under `apps/ui/src/`.
- `code-reviewer` — checks PRs touching `apps/ui/**/*.css` or `className=` props.

## Stack constants (do not deviate)

- Tailwind CSS `^4.0.x` via `@tailwindcss/vite`. No `postcss.config.*`, no `tailwind.config.{js,ts}`.
- Tailwind 4 is **config-as-CSS**: every design token lives in a `@theme { ... }` block in CSS.
- Paired with Shadcn UI (peer skill `shadcn`). React 19 component conventions live in the peer skill `react` — this skill owns CSS only.
- Brief target: WCAG 2 AAA contrast on every shipped view.

## Rules

### Setup

1. Install Tailwind 4 with `pnpm --filter @medbridge/ui add -D tailwindcss @tailwindcss/vite`. Never add `postcss`, `autoprefixer`, or a `tailwind.config.*` file.
2. Register the plugin in `apps/ui/vite.config.ts` as `tailwindcss()` from `@tailwindcss/vite`, after `react()` in the plugins array.
3. Create exactly one entry stylesheet at `apps/ui/src/styles/index.css` and import it once from `apps/ui/src/main.tsx`.
4. Begin the entry stylesheet with `@import "tailwindcss";`. Never use the v3 triple-directive (`@tailwind base; @tailwind components; @tailwind utilities;`) — it is a no-op in v4.

### Tokens (`@theme`)

5. Define every design token inside one `@theme { ... }` block in the entry stylesheet. Token names follow Tailwind's namespaced grammar: `--color-*`, `--font-*`, `--spacing`, `--radius-*`, `--breakpoint-*`, `--shadow-*`, `--animate-*`, `--text-*`. Full namespace list: `references/theme-tokens.md`.
6. Define brand colors with the `--color-brand-<shade>` pattern (shades `50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950`). Tailwind auto-generates `bg-brand-500`, `text-brand-700`, etc.
7. Express semantic tokens (`--color-bg`, `--color-fg`, `--color-muted`, `--color-border`, `--color-ring`, `--color-accent`, `--color-danger`, `--color-success`, `--color-warning`, `--color-info`) as CSS variables that reference brand shades. Never hard-code a hex inside a component class.
8. Set `--spacing: 0.25rem;` once; utilities like `p-4` resolve to `calc(var(--spacing) * 4)`. Never define `--spacing-4`, `--spacing-8` individually.
9. Override the default sans/serif/mono stacks with `--font-sans`, `--font-serif`, `--font-mono`.
10. Disable a default token namespace by writing `--color-*: initial;` before re-declaring your own.

### Layers and custom utilities

11. Put base resets, element defaults, and CSS-variable themes in `@layer base { ... }`. Never write base styles outside a layer — they defeat utility precedence.
12. Put multi-element component recipes in `@layer components { ... }`. A component-layer class composes utilities with `@apply` and may be overridden by any utility class at the call site.
13. Define new single-purpose utilities with `@utility <name> { ... }`. The v4 `@utility` directive replaces v3's `@layer utilities` and supports functional utilities via `--value(<type>)`. See `references/theme-tokens.md`.
14. Never write raw CSS rules that target `.utility-name` outside a `@layer` or `@utility` block — they bypass cascade ordering and break variants.

### `@apply`

15. Use `@apply` only inside `@layer components` or `@utility` blocks.
16. Keep `@apply` chains short (≤6 utilities). Split longer recipes into multiple component classes or a React component.
17. Never `@apply` an arbitrary value (e.g. `@apply text-[#abc123]`). Add a token to `@theme` instead.

### Class composition in JSX

18. Compose class names with the `cn()` helper from `apps/ui/src/lib/utils.ts` (`clsx` + `tailwind-merge`). Never use string concatenation or template literals for conditional classes — they break `tailwind-merge`'s last-write-wins resolution.
19. Order utilities inside `cn()` from least- to most-specific: layout → spacing → typography → color → state. Final overrides last.
20. Forward a `className?: string` prop on every reusable component and merge it via `cn(baseClasses, className)`.
21. Never construct class names from dynamic string fragments like `` `text-${color}-500` ``. The JIT scans for full class strings — interpolated fragments are invisible. Use a static map: `const cls = { red: 'text-red-500', blue: 'text-blue-500' }[color]`.

### Dark mode

22. Configure dark mode with `@custom-variant dark (&:where(.dark, .dark *));` at the top of the entry stylesheet, then toggle the `dark` class on `<html>` from React. Never rely on Tailwind 4's default `prefers-color-scheme` variant alone — the brief requires user-controlled theme switching.
23. Define every semantic color token twice: once in `@theme` (light defaults) and once in `:root.dark { ... }` (dark overrides). Both blocks set the **same** custom-property names. See `references/dark-mode.md` for the full pattern.
24. Use the `dark:` variant in JSX only when a class must differ in dark mode beyond what semantic tokens already provide (e.g. shadows, opacity). For routine bg/text/border, semantic tokens auto-swap and `dark:` is redundant.
25. Persist the chosen theme in `localStorage` under the key `medbridge:theme` (`'light' | 'dark' | 'system'`) and apply the `dark` class in a synchronous `<script>` in `index.html` before React mounts. See `references/dark-mode.md` for the FOUC-free init snippet.

### Accessibility (WCAG 2 AAA)

26. Pair every interactive element with a visible focus ring: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. Never remove the ring without an equivalent visible indicator. `--color-ring` must contrast ≥3:1 against any background it appears on.
27. Pick foreground/background token pairs that achieve **7:1** contrast for normal text and **4.5:1** for large text (AAA). Verify each pair with a contrast checker and record it in `references/accessibility.md`.
28. Never use color as the only signal for state. Pair color with an icon, label, underline, or shape (e.g. error inputs get `aria-invalid` + a red ring + a leading icon).
29. Set `outline-offset: 2px` on `:focus` in `@layer base` so rings are never clipped by parent `overflow: hidden`. Never style `:focus` without `:focus-visible` if a mouse user would see an unwanted ring on click.

### Build

30. Let `@tailwindcss/vite` discover content via Vite's module graph. Never write a `content: [...]` array (v3 concept).
31. Keep one production CSS bundle. Never split Tailwind output per route — the engine already produces minimal atomic CSS.

## Schema: `@theme` namespace cheat sheet

Required tokens for a MedBridge UI:

```css
@theme {
  /* required */
  --color-brand-50:  oklch(0.98 0.02 250);
  --color-brand-500: oklch(0.55 0.18 250);
  --color-brand-900: oklch(0.20 0.10 250);

  --color-bg:      oklch(0.99 0 0);
  --color-fg:      oklch(0.18 0 0);
  --color-muted:   oklch(0.55 0 0);
  --color-border:  oklch(0.90 0 0);
  --color-ring:    var(--color-brand-500);
  --color-danger:  oklch(0.55 0.20 25);
  --color-success: oklch(0.55 0.18 145);
  --color-warning: oklch(0.75 0.18 75);

  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;

  --spacing: 0.25rem;
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 1rem;
}
```

OPTIONAL token namespaces (define only when used): `--shadow-*`, `--animate-*`, `--ease-*`, `--text-*`, `--leading-*`, `--tracking-*`, `--breakpoint-*`.

Full namespace reference: `references/theme-tokens.md`.

## Examples

### CORRECT — entry stylesheet skeleton (`apps/ui/src/styles/index.css`)

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-brand-500: oklch(0.55 0.18 250);
  --color-bg:        oklch(0.99 0 0);
  --color-fg:        oklch(0.18 0 0);
  --color-ring:      var(--color-brand-500);
  --font-sans:       "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --spacing:         0.25rem;
  --radius-md:       0.5rem;
}

:root.dark {
  --color-bg: oklch(0.18 0 0);
  --color-fg: oklch(0.96 0 0);
}

@layer base {
  html { color-scheme: light dark; }
  body { @apply bg-bg text-fg font-sans antialiased; }
  :focus { outline-offset: 2px; }
}

@layer components {
  .card { @apply rounded-md border border-border bg-bg p-4 shadow-sm; }
}

@utility surface-elevated {
  background: color-mix(in oklch, var(--color-bg) 95%, var(--color-fg));
  box-shadow: 0 1px 3px oklch(0% 0 0 / 0.12);
}
```

### CORRECT — class composition in a component

```tsx
import { cn } from "@/lib/utils";

type Props = { variant?: "primary" | "ghost"; className?: string; children: React.ReactNode };

export function Button({ variant = "primary", className, children }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:pointer-events-none",
        variant === "primary" && "bg-brand-500 text-white hover:bg-brand-600",
        variant === "ghost"   && "bg-transparent text-fg hover:bg-muted/10",
        className,
      )}
    >
      {children}
    </button>
  );
}
```

### INCORRECT — multiple violations

```tsx
export function Bad({ color }: { color: string }) {
  return (
    <div
      style={{ color: "#3366ff" }}
      className={`text-${color}-500 p-[13px] focus:outline-none`}
    >
      hello
    </div>
  );
}
```

WHY this is wrong:

- `text-${color}-500` — violates Rule 21 (dynamic class fragment; invisible to the JIT).
- `p-[13px]` — violates Rule 17 (arbitrary value; add a token instead).
- inline `style={{ color: '#3366ff' }}` — violates Rule 7 (hard-coded hex; use a semantic token).
- `focus:outline-none` with no replacement ring — violates Rule 26 (breaks WCAG focus visibility).
- string-template `className` — violates Rule 18 (defeats `tailwind-merge`).

### INCORRECT — legacy v3 directives + JS config

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

module.exports = { content: ["./src/**/*.{ts,tsx}"], theme: { extend: { colors: { brand: "#3366ff" } } } };
```

WHY this is wrong:

- `@tailwind base/components/utilities` — violates Rule 4 (v3 directives; no-op in v4).
- JS-shaped `content`/`theme` object — violates Rules 1 and 5 (Tailwind 4 is CSS-first; no JS config).
- Brand color as a single hex instead of a `--color-brand-*` shade scale — violates Rule 6.

## OPTIONAL: Glossary

- **`@theme`** — v4 directive declaring design tokens as CSS custom properties; Tailwind generates utilities from each token namespace.
- **`@utility`** — v4 directive defining a new utility class; replaces v3's `@layer utilities { .foo { ... } }`.
- **`@custom-variant`** — v4 directive registering a new variant (e.g. dark mode, container queries).
- **`cn()`** — project helper at `apps/ui/src/lib/utils.ts` wrapping `clsx` + `tailwind-merge`; resolves duplicate utility conflicts.
- **`oklch()`** — perceptually uniform color space (CSS Color 4); preferred over hex for tokens because shade scales stay even.

## Deeper reference

- `references/theme-tokens.md` — full namespace catalog, functional `@utility` syntax, v3-to-v4 migration notes.
- `references/dark-mode.md` — `.dark` class strategy, FOUC-free init script, `prefers-color-scheme` opt-in.
- `references/accessibility.md` — WCAG AAA contrast pairs for the MedBridge palette, focus-ring tokens, reduced-motion variant.
- `references/vite-setup.md` — `vite.config.ts` plugin order, source-map and HMR notes, monorepo path aliases.
