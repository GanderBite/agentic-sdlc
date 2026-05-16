<!-- version: 1.0.0 -->

# react

## Purpose

Encodes idiomatic React 19 usage for `apps/ui` in MedBridge: hooks rules, suspense/error boundaries, forms via `react-hook-form` + Zod, TanStack Router/Query integration, and React 19 primitives (`use`, `useTransition`, actions, `useOptimistic`).

## Consumers

- `builder` — writes/edits React components, hooks, routes, and forms under `apps/ui/src/`.
- `code-reviewer` — checks PRs touching `apps/ui/**` against these rules.

## Stack constants (do not deviate)

- React `^19.0.x`, Vite `^7.0.x`, `@vitejs/plugin-react`.
- Router: `@tanstack/react-router ^1.95.x` (file-based, `routeTree.gen.ts` auto-generated).
- Data: `@tanstack/react-query ^5.62.x`.
- Forms: `react-hook-form ^7.54.x` + `@hookform/resolvers/zod` with schemas from `packages/contracts`.
- UI: Tailwind 4 + Shadcn UI (Radix primitives copy-in under `apps/ui/src/components/ui/`).
- HTTP: hand-written `fetch` wrapper in `apps/ui/src/api/`. Never import `ky`, `axios`, or a Hono RPC client.
- No UI tests (unit, component, or e2e). Rely on TypeScript strict mode + manual a11y review.

## Rules

### Component shape

1. Write every component as a typed function declaration. Never use `React.FC` or `React.FunctionComponent`.
2. Type props with a local `type Props = { … }`. Destructure props in the parameter list.
3. Export the component as a named export. Default exports are reserved for TanStack Router route files (`Route.component`).
4. Use PascalCase for components, camelCase for hooks (`useFoo`), kebab-case for filenames except route files which follow TanStack file-based conventions.

### Hooks

5. Call hooks unconditionally at the top of a component or custom hook. Never call hooks inside loops, conditions, callbacks, or after early returns.
6. Name every custom hook `useXxx`. A function that does not call other hooks is not a hook — drop the prefix.
7. List every reactive value a hook reads in its dependency array. Never disable `react-hooks/exhaustive-deps` for the convenience of a stale closure.
8. Reach for `useMemo`/`useCallback` only when a measured render cost or referential-identity contract demands it. Default to no memoization.

### React 19 primitives

9. Use `use(promise)` or `use(context)` inside a Suspense subtree to unwrap async data or read context conditionally. Never call `use()` at the top level of a route component — wrap the consumer in `<Suspense>`.
10. Wrap non-urgent state updates (filters, search, tab switches) in `startTransition` from `useTransition`. Display the `isPending` flag through a subtle UI affordance (opacity, spinner) — never block input.
11. Use `useOptimistic(state, reducer)` for write actions where the server response is highly likely to succeed (toggle, reorder, like). Always reconcile against the authoritative server state on settle.
12. Use `useActionState(fn, initial)` + `<form action={fn}>` for progressive-enhancement forms only when you do not need react-hook-form's per-field validation UX. For validated forms, prefer rule 19.

### Boundaries

13. Wrap every async data consumer in a `<Suspense fallback={…}>`. Place the boundary at the smallest subtree that meaningfully needs the fallback — never at the app root unless the entire page is async.
14. Wrap every Suspense subtree (or sibling) in an Error Boundary. Use TanStack Router's `errorComponent` for route-level errors; use a hand-rolled class boundary (or `react-error-boundary` if added) for sub-route regions.
15. Never `try/catch` an awaited promise in render. Errors propagate to the nearest Error Boundary by design.

### Lists and keys

16. Pass a stable, unique `key` for every sibling in a list. Use the row's primary key from the API, never the array index, never `Math.random()`, never a stringified object.
17. Never put a side effect inside `.map()`. Map produces JSX only.

### Forms (react-hook-form + Zod)

18. Define the schema in `packages/contracts` and import it. Never redefine validation in `apps/ui`.
19. Build forms with `useForm({ resolver: zodResolver(schema) })`. Bind inputs with `register('field')` for plain inputs and with `<Controller>` for Radix/Shadcn primitives that own their state.
20. Never mix controlled and uncontrolled mode on the same input. Pick one per field and keep it for the life of the component.
21. Submit handlers receive a typed, validated payload from `handleSubmit(onValid, onInvalid)`. Never read `getValues()` inside a submit handler to bypass validation.

### TanStack Router

22. Place route files under `apps/ui/src/routes/` following file-based conventions; let `routeTree.gen.ts` regenerate — never hand-edit it.
23. Load route data with the route's `loader` returning a `queryClient.ensureQueryData(...)` promise, then read it in the component with `useSuspenseQuery(...)`. Never `useEffect(() => fetch(...))` for initial data.
24. Type search params with a Zod schema in `validateSearch`. Never parse `window.location.search` by hand.

### TanStack Query

25. Define every query key as a tuple starting with a string namespace, e.g. `['patient', id]`. Co-locate factories in `apps/ui/src/api/queries/`.
26. Use `useSuspenseQuery` for data the component cannot render without; use `useQuery` only when a non-suspending loading state is required.
27. Invalidate by key prefix after a mutation: `queryClient.invalidateQueries({ queryKey: ['patient'] })`. Never call `refetch()` from inside another component's effect.

### Composition and state

28. Compose with children and slots. Never extend a component class to add behavior — wrap it.
29. Lift state to the lowest common ancestor only. Prefer URL state (TanStack Router search) over component state for anything a user might bookmark or share.
30. Pass primitives or stable references through props. Never pass freshly-constructed objects/arrays as memoized component props without memoizing them.

### Accessibility

31. Use semantic elements (`<button>`, `<a>`, `<label>`, `<nav>`, `<main>`). Never bind `onClick` to a non-interactive element without `role` + keyboard handlers.
32. Associate every form input with a `<label htmlFor={id}>` or wrap it. Shadcn's `<Label>` component is the default.
33. Author keyboard interactions for every mouse interaction. Visible focus rings are mandatory (Tailwind `focus-visible:` utilities).

### Forbidden

34. Never import from `react-dom/client` outside `apps/ui/src/main.tsx`.
35. Never use `dangerouslySetInnerHTML` without a sanitized source documented in a code comment.
36. Never read or write `document` / `window` in render. Confine to `useEffect` or event handlers, and guard with `typeof window !== 'undefined'` only when SSR is in play (it is not, currently).
37. Never bypass the `apps/ui/src/api/` fetch wrapper. No raw `fetch` in components, no `axios`, no `ky`, no Hono RPC client.

## Template — typed function component

```tsx
import { useState } from 'react';

type Props = {
  patientId: string;            // REQUIRED
  initialTab?: 'overview' | 'history'; // OPTIONAL, default 'overview'
  onTabChange?: (tab: 'overview' | 'history') => void; // OPTIONAL
};

export function PatientPanel({ patientId, initialTab = 'overview', onTabChange }: Props) {
  const [tab, setTab] = useState(initialTab);
  return (
    <section aria-labelledby={`patient-${patientId}`}>
      {/* … */}
    </section>
  );
}
```

## Template — route with loader + suspense query

```tsx
// apps/ui/src/routes/patients/$patientId.tsx
import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { patientQuery } from '@/api/queries/patient';

export const Route = createFileRoute('/patients/$patientId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(patientQuery(params.patientId)),
  component: PatientRoute,
  errorComponent: ({ error }) => <ErrorPanel error={error} />,
  pendingComponent: () => <PatientSkeleton />,
});

function PatientRoute() {
  const { patientId } = Route.useParams();
  const { data } = useSuspenseQuery(patientQuery(patientId));
  return <PatientPanel patientId={data.id} />;
}
```

## Template — form with react-hook-form + Zod

```tsx
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreatePatientSchema, type CreatePatientInput } from '@medbridge/contracts';

export function CreatePatientForm({ onSubmit }: { onSubmit: (v: CreatePatientInput) => Promise<void> }) {
  const form = useForm<CreatePatientInput>({
    resolver: zodResolver(CreatePatientSchema),
    defaultValues: { name: '', dob: '' },
  });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <label htmlFor="name">Name</label>
      <input id="name" {...form.register('name')} aria-invalid={!!form.formState.errors.name} />
      {form.formState.errors.name && <p role="alert">{form.formState.errors.name.message}</p>}
      <button type="submit" disabled={form.formState.isSubmitting}>Create</button>
    </form>
  );
}
```

## Examples

### CORRECT — list with stable keys, no inline effect

```tsx
export function PatientList({ patients }: { patients: Patient[] }) {
  return (
    <ul>
      {patients.map((p) => (
        <li key={p.id}>
          <PatientRow patient={p} />
        </li>
      ))}
    </ul>
  );
}
```

### CORRECT — non-urgent filter update with transition

```tsx
const [filter, setFilter] = useState('');
const [pending, startTransition] = useTransition();

function onChange(e: React.ChangeEvent<HTMLInputElement>) {
  const next = e.target.value;
  startTransition(() => setFilter(next));
}
return <input value={filter} onChange={onChange} aria-busy={pending} />;
```

### INCORRECT — conditional hook + index key + raw fetch

```tsx
export const PatientList: React.FC<{ ids: string[] }> = ({ ids }) => {
  if (ids.length === 0) return null;
  const [data, setData] = useState<Patient[]>([]);                 // violates Rule 5 (hook after early return)
  useEffect(() => {
    fetch(`/api/patients?ids=${ids.join(',')}`)                    // violates Rule 37 (bypasses fetch wrapper) and Rule 23 (effect for initial load)
      .then((r) => r.json())
      .then(setData);
  }, []);                                                          // violates Rule 7 (missing `ids` dep)
  return (
    <ul>
      {data.map((p, i) => <li key={i}>{p.name}</li>)}              // violates Rule 16 (index key)
    </ul>
  );
};                                                                 // violates Rule 1 (React.FC) and Rule 3 (no named export)
```

### INCORRECT — uncontrolled→controlled flip on a single input

```tsx
const [name, setName] = useState<string | undefined>(undefined);
return <input value={name} onChange={(e) => setName(e.target.value)} />;
// violates Rule 20: `value={undefined}` makes the input uncontrolled on first render,
// then controlled once typing begins. Use `useState('')` or wrap in Controller.
```

## Deeper references

- `references/react-19.md` — `use`, `useTransition`, `useOptimistic`, `useActionState`, server-action interplay, when each primitive applies.
- `references/forms.md` — `react-hook-form` + Zod patterns, Controller usage with Shadcn primitives, error rendering, multi-step wizards.
- `references/tanstack.md` — Router loaders + Query integration, query-key conventions, mutations, optimistic updates, invalidation.
- `references/suspense-and-errors.md` — boundary placement strategy, fallback design, error-component contract, recovery patterns.
- `references/pitfalls.md` — common React 19 gotchas (StrictMode double-invoke, ref-as-prop, hydration, key collisions) and the recovery action for each.
