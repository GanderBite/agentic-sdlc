# Theming, tokens, dark mode

Expands SKILL.md Rules 21–23. Tailwind 4 + Shadcn use CSS variables (`--background`, `--foreground`, `--primary`, …) defined in `apps/ui/src/index.css` and exposed to utilities via `@theme`.

## 1. The token file

`apps/ui/src/index.css` (full sketch — comments and divider lines omitted):

```css
@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.45 0 0);             /* AAA: ≥7:1 on --background */
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.45 0.20 25);              /* AAA contrast vs white */
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.92 0 0);
  --input: oklch(0.92 0 0);
  --ring: oklch(0.205 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.27 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.27 0 0);
  --muted-foreground: oklch(0.78 0 0);             /* AAA: ≥7:1 on dark --background */
  --accent: oklch(0.27 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.72 0.20 25);
  --destructive-foreground: oklch(0.145 0 0);
  --border: oklch(0.27 0 0);
  --input: oklch(0.27 0 0);
  --ring: oklch(0.78 0 0);
}
```

Notes:

- `oklch()` is chosen so lightness deltas correspond to perceived-contrast deltas.
- `--muted-foreground` and `--destructive` must hit WCAG AAA (≥7:1 normal text, ≥4.5:1 large text). Verify with any contrast checker after any token change.
- The `@custom-variant dark` directive aliases the `dark:` Tailwind variant to `.dark` class on any ancestor.

## 2. The toggle pattern

Add a tiny theme provider at the app root. Persist in `localStorage`, default to `system`:

```tsx
// apps/ui/src/theme/ThemeProvider.tsx
import * as React from 'react';

type Theme = 'light' | 'dark' | 'system';
const ThemeContext = React.createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: 'system', setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>(() =>
    (localStorage.getItem('theme') as Theme | null) ?? 'system'
  );

  React.useEffect(() => {
    const root = document.documentElement;
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        : theme;
    root.classList.toggle('dark', resolved === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return React.useContext(ThemeContext); }
```

Wire it once in `apps/ui/src/main.tsx`:

```tsx
<ThemeProvider>
  <RouterProvider router={router} />
</ThemeProvider>
```

## 3. Toggle UI

```tsx
import { useTheme } from '@/theme/ThemeProvider';
import { Button } from '@/components/ui/button';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  );
}
```

## 4. Using tokens

Always use the utility classes that resolve to the CSS variables:

```tsx
<div className="bg-background text-foreground border-border">…</div>
<button className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring">…</button>
```

Never write `bg-white`, `text-black`, `dark:bg-zinc-900`. These hard-code the palette and bypass the AAA contrast tokens.

## 5. WCAG-AAA checks

Per brief §7 the floor is AAA. After every token edit:

1. Run a contrast checker on each foreground/background pair (`--foreground` vs `--background`, `--muted-foreground` vs `--background`, `--primary-foreground` vs `--primary`, `--destructive-foreground` vs `--destructive`).
2. Target ≥7:1 for normal text, ≥4.5:1 for large text (18pt+ or 14pt bold), ≥3:1 for non-text UI components (borders, focus rings).
3. Repeat in dark mode.
4. Record any concessions (a pair that achieves AA but not AAA) in a `// shadcn:diverged` comment with the rationale.

## 6. Common mistakes

- Toggling dark mode by data attribute (`data-theme="dark"`) instead of the `dark` class. The `@custom-variant dark` directive expects `.dark` — change one, change both.
- Adding a `dark:` variant to a token definition itself (e.g. `--background: dark:#000`). Tokens are values; `dark:` only applies to utilities.
- Importing tokens from a JS file. Tokens live in CSS; the JS layer reads them through the utility classes.
- Re-defining tokens per-route. Tokens are global; per-route overrides defeat the contrast guarantee.
