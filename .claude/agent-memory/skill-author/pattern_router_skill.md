---
name: Pattern — file-based router skill scoping
description: How to scope a tanstack-router-style skill alongside a peer data-layer skill so loader/query integration has one owner without duplication
type: feedback
---

For a file-based router skill that integrates with a separate data-cache skill (Tanstack Query), the router skill owns the *integration recipe* (loader → `ensureQueryData` → component `useSuspenseQuery` with shared `queryOptions`), while the data-cache skill owns query semantics (staleTime, mutations, invalidation).

**Why:** The shared-queryOptions pattern is the contract that links the two libraries — neither skill alone makes the integration verifiable. If both skills repeat the contract, they will drift and contradict each other (Schema Orphan / Clone anti-patterns from skill-authoring §A-4, §A-5).

**How to apply:** In the router skill, write a single explicit rule ("loader calls `context.queryClient.ensureQueryData(queryOptions)`; the same `queryOptions` factory backs the component's `useSuspenseQuery`"). In the peer data-cache skill, point at that rule rather than restating it. Reciprocally, the router skill must NOT define `staleTime`, `gcTime`, mutation patterns, or invalidation — defer to the data-cache skill by name.

Other router-skill recurring decisions worth keeping consistent across projects:
- File-name grammar table (`__root`, `index`, `$param`, `_layout`, splat, dot-nesting) belongs in a `references/file-routing.md`, not SKILL.md.
- The `declare module '@tanstack/react-router' { interface Register { router } }` augmentation must be a hard rule — without it the typed `<Link>` story collapses silently.
- `redirect()` (thrown sentinel) vs `useNavigate()` (post-render) is the most common loader/guard mistake; surface it as an INCORRECT example.
