# React 19 pitfalls and recovery

Named failure modes encountered with this stack, with the recovery action for each.

## 1. StrictMode double-invoke surprises

**Symptom:** Network requests fire twice in dev. State setters run twice. Effects mount/unmount/mount.

**Cause:** React StrictMode (enabled in `main.tsx`) intentionally double-invokes component bodies and effects in dev to surface non-idempotent code.

**Recovery:**
- Make render bodies pure. No `Math.random()` for keys, no `Date.now()` cached in module scope.
- Effects: always pair the side effect with a cleanup that undoes it. The mount→cleanup→mount sequence must net to the same state as a single mount.
- For `useEffect(fetchInitial, [])`: move the fetch into a TanStack Query (which dedupes by key) or into the route loader.

## 2. Controlled / uncontrolled flip warning

**Symptom:** Console warns "A component is changing an uncontrolled input to be controlled."

**Cause:** `value` is `undefined` on the first render, then a string later.

**Recovery:** Initialize `useState('')`, not `useState<string | undefined>()`. For react-hook-form, set complete `defaultValues`.

## 3. Suspense waterfall

**Symptom:** Page renders one panel, then waits, then renders the next panel. Total load time = sum of fetches, not max.

**Cause:** Each panel calls its own `useSuspenseQuery` on mount; children only mount after parent resolves.

**Recovery:** Hoist queries to the route loader with `Promise.all([ensureQueryData(A), ensureQueryData(B)])`. Children read with `useSuspenseQuery` from the warm cache and render in parallel.

## 4. Stale closure in event handler

**Symptom:** A handler reads an old value of a piece of state even though the UI shows the new one.

**Cause:** The handler was captured in a `useEffect` or `useMemo` with a missing dependency.

**Recovery:** Fix the dependency array. Do not disable `react-hooks/exhaustive-deps`. If the value should be read at call time without re-subscribing, use `useRef` and update it in an effect — but prefer fixing deps.

## 5. Key collisions on list reordering

**Symptom:** Inputs swap their values when a list is reordered. Animations play on the wrong row.

**Cause:** Keys are array indexes, or non-unique (e.g. shared `name`), or change across renders.

**Recovery:** Use the row's primary key from the API. If the API does not provide a stable id, derive one once on insert (e.g. `crypto.randomUUID()`) and store it with the row.

## 6. `use()` infinite suspense

**Symptom:** Component suspends forever; fallback never goes away.

**Cause:** `use(somePromise)` where `somePromise` is a new Promise on every render.

**Recovery:** Hoist the promise to a parent that creates it once, or to a route loader. Or use `useSuspenseQuery` which handles caching for you.

## 7. Ref-as-prop migration trap

**Symptom:** `forwardRef` wrapper exists; new code passes `ref` as a regular prop and TypeScript fails.

**Cause:** React 19 makes `ref` a regular prop, but `forwardRef` still works. Mixed conventions confuse callers.

**Recovery:** When you touch a `forwardRef` component, refactor it to take `ref` as a prop. Update its call sites. Don't introduce new `forwardRef` calls.

## 8. Tailwind 4 + Shadcn class name collisions

**Symptom:** Utility classes appear to fight (e.g. `bg-red-500 bg-blue-500`).

**Cause:** Composing class strings without `cn()` (the Shadcn `clsx + tailwind-merge` helper).

**Recovery:** Always pipe composed class strings through `cn(...)` from `@/lib/utils`. It merges conflicting utilities by predicate.

## 9. Hydration-related warnings (currently N/A)

The app is client-rendered only. If/when SSR is added, hydration mismatches become a concern; until then, ignore guidance referencing `useSyncExternalStore` SSR semantics.

## 10. Memoization over-reach

**Symptom:** Code is sprinkled with `useMemo` / `useCallback` everywhere; profiler shows no measurable benefit; bugs from stale memo deps appear.

**Cause:** Defensive memoization without a measured cost driving it.

**Recovery:** Delete memoization unless one of these is true: (a) the dependent component is wrapped in `React.memo` and identity matters, (b) the computation is provably expensive (>1ms in profiler), (c) a ref-equality contract (e.g. an effect dep) demands stability.
