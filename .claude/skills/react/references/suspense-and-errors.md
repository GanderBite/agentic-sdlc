# Suspense and Error Boundaries

## Boundary placement strategy

Suspense and Error Boundaries answer different questions:

- **Suspense** — "what do I show while this part is loading?"
- **Error Boundary** — "what do I show when this part has crashed?"

Place each at the **smallest subtree that owns the loading or failure mode**. A single app-root boundary turns every transient blip into a full-page spinner or full-page error.

## Decision table

| Failure scope | Suspense placement | Error placement |
|---|---|---|
| Whole route (data not loaded) | Route `pendingComponent` | Route `errorComponent` |
| One panel inside a route | `<Suspense>` around that panel | `<ErrorBoundary>` around that panel |
| One row in a list | Don't suspend; render skeleton row inline | Render an error row inline; do not propagate |
| Page-level boot (auth, theme) | App-root `<Suspense>` once | App-root `<ErrorBoundary>` once |

## Suspense fallback design

- Skeletons match the final layout's bounding box. Avoid layout shift on resolve.
- Never show a generic spinner for >200ms when a layout-shaped skeleton would do.
- For sibling panels, prefer staggered Suspense boundaries (each with its own fallback) over one big boundary covering both.

## Error boundary contract

TanStack Router's `errorComponent` receives `{ error, reset, info }`. The minimum implementation:

```tsx
function ErrorPanel({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="p-6">
      <h2>Something went wrong</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

For non-route boundaries, write a class component (React still requires a class for the catching API) or import `react-error-boundary` if added to the project.

```tsx
import { Component, type ReactNode } from 'react';

type Props = { fallback: (e: Error, reset: () => void) => ReactNode; children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  reset = () => this.setState({ error: null });
  render() {
    return this.state.error
      ? this.props.fallback(this.state.error, this.reset)
      : this.props.children;
  }
}
```

## What can go wrong

1. **Fallback flicker on every keystroke** — a query key changes per keystroke, so Suspense fires its fallback. Recovery: wrap the update in `startTransition`. The previous UI stays mounted until the new data resolves.
2. **Whole-page crash on a transient API error** — the only Error Boundary is at the app root. Recovery: add a route-level `errorComponent`, or a `<ErrorBoundary>` around the failing panel, so the rest of the page survives.
3. **Suspense waterfall** — sibling components each kick off their own fetch on mount, serially. Recovery: hoist the queries into the route's `loader` and call `Promise.all([ensureQueryData(...), ensureQueryData(...)])` so they run in parallel.

## Recovery actions

- A reset button must always be reachable when an Error Boundary is showing. A page with no escape is a dead end.
- Log errors via the project's logger (when added). Never `console.error` and call it done.
- Do not swallow errors in `try/catch` inside render to keep the UI quiet. Let the boundary handle them, or surface them to the user.
