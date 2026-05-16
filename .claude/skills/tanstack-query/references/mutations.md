# Mutations

## Lifecycle

`useMutation` exposes four callbacks. Their firing order:

1. `onMutate(input)` — runs before `mutationFn`. Use for optimistic updates. Return a `context` value that flows to `onError` and `onSettled`.
2. `mutationFn(input)` — performs the request.
3. `onSuccess(data, input, context)` — runs only on resolved promise. Use for invalidation and toasts.
4. `onError(error, input, context)` — runs on rejected promise. Use for rollback and error UI.
5. `onSettled(data, error, input, context)` — runs after success OR error. Use for cleanup (final invalidation that reconciles optimistic state).

## `mutate` vs `mutateAsync`

- `mutate(input)` — fire and forget. Errors flow to `onError`. `mutate` itself never throws.
- `mutateAsync(input)` — returns a promise that resolves with the data or rejects with the error. Use only when the caller's control flow depends on awaiting the result (e.g. multi-step wizard where step 2 only opens after step 1 succeeds).

If you use `mutateAsync`, wrap it in `try/catch`:

```tsx
async function onSubmit(values: Input) {
  try {
    const created = await create.mutateAsync(values);
    navigate({ to: `/patients/${created.id}` });
  } catch (e) {
    // already shown in onError toast; swallow to suppress unhandledrejection
  }
}
```

## Invalidation by prefix

The right granularity is "the broadest correct prefix":

```ts
onSuccess: (_, vars) => {
  // Most surgical: only this one patient's detail cache.
  qc.invalidateQueries({ queryKey: patientKeys.detail(vars.id) });
  // Plus any list that might include this patient.
  qc.invalidateQueries({ queryKey: patientKeys.lists() });
}
```

If the mutation could touch many entities (e.g. bulk import), invalidate `patientKeys.all`. Do not chase exact correctness at the cost of stale list rows.

## Optimistic-update template

```tsx
const toggle = useMutation({
  mutationFn: (id: string) => api.patients.toggleArchive(id),

  onMutate: async (id) => {
    await qc.cancelQueries({ queryKey: patientKeys.detail(id) });
    const prev = qc.getQueryData<Patient>(patientKeys.detail(id));
    if (prev) {
      qc.setQueryData<Patient>(patientKeys.detail(id), {
        ...prev,
        archived: !prev.archived,
      });
    }
    return { prev };                              // ⟵ context
  },

  onError: (_err, id, ctx) => {
    if (ctx?.prev) qc.setQueryData(patientKeys.detail(id), ctx.prev);
  },

  onSettled: (_d, _e, id) => {
    qc.invalidateQueries({ queryKey: patientKeys.detail(id) });
  },
});
```

Notes:
- `cancelQueries` prevents a stale in-flight refetch from clobbering the optimistic write.
- `setQueryData` mutates the cache synchronously; React renders the optimistic value on the next paint.
- `onError` restores the snapshot; `onSettled` invalidates so the eventual server-truth refetch reconciles.

## When NOT to use optimistic updates

Skip the pattern when:
- The mutation's success rate is not very high (validation-heavy create flows).
- The server response shape differs from the input shape (e.g. server assigns `id`, `createdAt`). Use a regular `onSuccess` invalidate.
- The action is destructive (delete). Show pending UI and confirm post-success.

For purely local optimism (a counter, a like button, a draft state), prefer React 19's `useOptimistic` — no cache coordination needed.

## Multi-mutation coordination

Two patterns:

1. **Sequential (typed pipeline)** — chain `await mutateAsync()` calls. Errors abort the chain.
2. **Parallel (Promise.all)** — fire independent mutations together; collect errors with `Promise.allSettled` if partial success is acceptable.

Never coordinate by reading another mutation's `isSuccess` from a `useEffect`. That re-introduces effect-based control flow.
