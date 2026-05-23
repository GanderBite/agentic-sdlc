# React 19 primitives

Authoritative reference for the React 19 features available in `apps/ui`. Each section lists when to use the primitive, the exact API shape, and traps to avoid.

## `use(resource)`

`use` reads a Promise or Context inside a render path. Unlike hooks, `use` may be called conditionally — but only inside a Suspense subtree.

```tsx
import { use, Suspense } from 'react';

function PatientName({ promise }: { promise: Promise<{ name: string }> }) {
  const { name } = use(promise);   // suspends until resolved
  return <h2>{name}</h2>;
}

export function Page({ promise }: { promise: Promise<{ name: string }> }) {
  return (
    <Suspense fallback={<Skeleton />}>
      <PatientName promise={promise} />
    </Suspense>
  );
}
```

When to reach for `use`:

- Reading a context that may not always be present (`use(MaybeCtx)`) — beats `useContext` because it can be called conditionally.
- Unwrapping a promise from a parent that already kicked off the work (loader, route context, parent component). The promise must be stable across renders; never construct it in render.

Traps:

- Constructing a new Promise in render (`use(fetch(...))`) causes infinite suspense loops. Memoize or hoist.
- `use` at the top of a route component without a sibling `<Suspense>` boundary causes the whole route to suspend — usually you want a narrower boundary.

## `useTransition` and `startTransition`

Marks state updates as non-urgent. The renderer keeps the previous UI visible (no fallback) while the transition is pending.

```tsx
const [isPending, startTransition] = useTransition();

function changeTab(next: Tab) {
  startTransition(() => setTab(next));
}
```

When:

- Filtering large lists.
- Switching tabs that re-suspend on child queries.
- Any update where blank screens are worse than slightly-stale screens.

Not for:

- Form submits — use `useActionState` or `react-hook-form`'s `formState.isSubmitting`.
- Input value updates that must echo each keystroke — keep those urgent and debounce the *consumer* instead.

## `useOptimistic`

Local-only optimistic state that snaps back if the action fails.

```tsx
const [optimisticLikes, addOptimisticLike] = useOptimistic(
  serverLikes,
  (state, delta: number) => state + delta,
);

async function like() {
  addOptimisticLike(1);
  await api.likes.add(postId);    // on failure, React reconciles back to serverLikes
}
```

Rules:

- Only call inside an action/event handler, never in render.
- Always pair with TanStack Query's `onSettled` or `invalidateQueries` to reconcile authoritative state.
- Do not stack optimistic deltas if the server's accept/reject is uncertain — model the queue explicitly.

## `useActionState`

Pairs a `<form action>` with reducer-shaped state. Good for progressive-enhancement forms where react-hook-form would be overkill (single-field forms, search bars, simple toggles).

```tsx
const [state, formAction, pending] = useActionState(
  async (_prev, formData: FormData) => {
    const q = String(formData.get('q'));
    return await searchPatients(q);
  },
  { results: [] },
);

return (
  <form action={formAction}>
    <input name="q" />
    <button disabled={pending}>Search</button>
    <Results value={state} />
  </form>
);
```

Do not combine `useActionState` with `react-hook-form` on the same form. Pick one.

## Refs as props

In React 19, `ref` is a regular prop. You can forward refs without `forwardRef`:

```tsx
type Props = { ref?: React.Ref<HTMLInputElement>; placeholder?: string };
export function TextField({ ref, placeholder }: Props) {
  return <input ref={ref} placeholder={placeholder} />;
}
```

Migration: delete `forwardRef` wrappers when touching a component. Do not introduce new `forwardRef` calls.

## Document metadata

React 19 hoists `<title>`, `<meta>`, and `<link>` from any component to `<head>`. Use this for route-level metadata in lieu of a `react-helmet`-style library.

```tsx
function PatientRoute() {
  return (
    <>
      <title>Patient · MedBridge</title>
      <meta name="description" content="Patient overview" />
      <PatientPanel />
    </>
  );
}
```

## Concurrency invariants

- Components must be idempotent. StrictMode in dev double-invokes render and effect bodies — any test or behavior that breaks under double invocation is a real bug.
- Never mutate props or state during render.
- Side effects that must run once per mount: put them in `useEffect` and write the cleanup to undo them. The double-invoke pattern (mount → cleanup → mount) is the test.
