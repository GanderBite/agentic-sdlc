# Dark mode (class strategy, FOUC-free)

MedBridge requires user-controlled theme switching with `'light' | 'dark' | 'system'`. Implementation is the **class strategy** (Tailwind 4 idiom): a `dark` class on `<html>` flips a parallel set of CSS variables.

## 1. Register the variant

At the top of `apps/ui/src/styles/index.css` (after `@import "tailwindcss";`):

```css
@custom-variant dark (&:where(.dark, .dark *));
```

`:where()` keeps specificity at zero so the variant is overridable. Both `.dark` and any descendant of `.dark` match — including the root element itself.

## 2. Define semantic tokens twice

Light defaults live in `@theme`. Dark overrides live in a `:root.dark { ... }` block. Use **the same custom-property names** so utilities like `bg-bg`, `text-fg`, `border-border` auto-swap.

```css
@theme {
  --color-bg:     oklch(0.99 0 0);
  --color-fg:     oklch(0.18 0 0);
  --color-muted:  oklch(0.55 0 0);
  --color-border: oklch(0.90 0 0);
  --color-ring:   oklch(0.55 0.18 250);

  --color-brand-500: oklch(0.55 0.18 250);
  --color-danger:    oklch(0.55 0.20 25);
  --color-success:   oklch(0.45 0.16 145);
  --color-warning:   oklch(0.65 0.18 75);
}

:root.dark {
  --color-bg:     oklch(0.16 0 0);
  --color-fg:     oklch(0.96 0 0);
  --color-muted:  oklch(0.65 0 0);
  --color-border: oklch(0.30 0 0);
  --color-ring:   oklch(0.70 0.16 250);

  /* shift saturated accents toward lighter shades for AAA */
  --color-brand-500: oklch(0.70 0.16 250);
  --color-danger:    oklch(0.70 0.18 25);
  --color-success:   oklch(0.70 0.14 145);
  --color-warning:   oklch(0.80 0.16 75);
}
```

Brand `--color-brand-{shade}` does NOT need re-declaration if shades are used directly; only the *semantic* variables flip. But when a single shade is used as an accent, override it explicitly to keep contrast.

## 3. Theme-store hook

`apps/ui/src/lib/theme.ts`:

```ts
type Theme = "light" | "dark" | "system";
const KEY = "medbridge:theme";

export function getTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  const isDark =
    t === "dark" ||
    (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", isDark);
}

export function setTheme(t: Theme): void {
  localStorage.setItem(KEY, t);
  applyTheme(t);
}
```

A React wrapper hook (`useTheme`) belongs in `apps/ui/src/hooks/use-theme.ts` and is owned by the `react` skill's component patterns — link the two skills, do not duplicate the hook here.

## 4. FOUC-free init script

Place this **inline** in `apps/ui/index.html` `<head>`, before any module script:

```html
<script>
  (function () {
    try {
      var k = "medbridge:theme";
      var t = localStorage.getItem(k) || "system";
      var dark =
        t === "dark" ||
        (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      if (dark) document.documentElement.classList.add("dark");
    } catch (_) {}
  })();
</script>
```

This runs synchronously before Tailwind CSS is parsed by the browser, so the very first paint already has the correct background/foreground values.

## 5. Reacting to system-theme changes

When the user picks `system`, listen for `prefers-color-scheme` changes so the page flips live:

```ts
const mql = window.matchMedia("(prefers-color-scheme: dark)");
mql.addEventListener("change", () => {
  if (getTheme() === "system") applyTheme("system");
});
```

Tear down in a React `useEffect` cleanup.

## 6. Authoring rule: when to use `dark:` variants

For the 90% case, semantic tokens (`bg-bg`, `text-fg`, `border-border`) auto-swap. The `dark:` variant should be used **only** for:

- Shadows that need different opacity in dark mode (`shadow-md dark:shadow-none`).
- Background images / illustrations that have a separate dark asset.
- One-off accent colors that don't map cleanly to a semantic token.
- Logos with dark and light variants.

If you find yourself writing `dark:bg-X dark:text-Y` on most components, fix the semantic tokens instead.

## 7. Reduced motion

Combine dark mode with a reduced-motion guard:

```css
@layer base {
  @media (prefers-reduced-motion: reduce) {
    *, ::before, ::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
}
```

Brief WCAG AAA target benefits from this baseline.
