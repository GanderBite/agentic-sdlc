---
name: React 19 skill scope in a Vite SPA
description: How to scope a React skill when routing/data/styling/primitives each have their own dedicated skills.
type: project
---

When the host project is a Vite SPA (not Next.js / Waku) and routing, data, styling, and component primitives each own dedicated skills, the `react` skill shrinks to React-the-library only.

Concretely for MedBrige's `apps/ui` the react skill covers:

- Function-component shape, props typing (no `React.FC`), named exports.
- Ref-as-prop (React 19 — `forwardRef` is forbidden).
- The `use()` hook — promises (must be created outside the component) and context.
- `useSyncExternalStore` for non-React stores; tear-free under concurrent rendering.
- Transitions (`startTransition` / `useTransition` / `useDeferredValue`).
- `useActionState` / `useFormStatus` / `useOptimistic` — note the action runs in the browser, no server-action wire format in a Vite SPA.
- Suspense + error-boundary ordering (ErrorBoundary outside, Suspense inside).
- Controlled vs uncontrolled input policy.
- The single sanctioned class: `ErrorBoundary` wrapper. No other class components.

Explicit non-coverage (defer to peer skills): routing → `tanstack-router`; data fetching/caching/optimistic UI integration → `tanstack-query`; styling → `tailwind`; UI primitives → `shadcn-ui`; schema validation → `zod`.

**Why:** Without this scoping a React skill balloons past the 5k token cap and starts duplicating peer skills' rules (Clone anti-pattern A-4).

**How to apply:** State the non-coverage list explicitly in the skill's Consumers section. When tempted to add a rule about routing/data/styling, check whether a peer skill already owns it and link instead.
