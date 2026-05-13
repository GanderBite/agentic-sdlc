---
name: data-fetching skill scoping
description: Tanstack Query / data-layer skills should defer cache semantics ownership and cross-reference router/component skills explicitly
type: feedback
---

For `framework/data-fetching` skills (Tanstack Query and similar), scope ownership tightly to caching, mutation flow, and key conventions. Defer rendering/Suspense to the React skill, defer routing/loader mechanics to the router skill, defer DTO shapes to the validation skill.

**Why:** In a multi-skill UI suite (react + tanstack-router + tanstack-query + zod + tailwind + shadcn-ui), every skill that overlaps Suspense ordering or routing context creates contradictory rules. The data-fetching skill is the LATE consumer in this chain — it inherits the boundary contract from `react` and the loader contract from `tanstack-router`.

**How to apply:**
- In Consumers, list explicitly which sibling skills own what (routing, Suspense, DTO types, HTTP client choice).
- The `useSuspenseQuery` ↔ loader `ensureQueryData` contract MUST be documented identically in both the data-fetching and router skills (use the same factory pattern in both examples). The `tanstack-router` skill's `pattern_router_skill.md` memory already pins this.
- Hono client: provide BOTH `hc` typed RPC AND hand-rolled fetch as separate options in references; do not pick for the user. Document tradeoffs.
- Optimistic update recipe is the highest-value reference content — full four-callback pattern with cancel/snapshot/rollback/invalidate. Worth its own references file.
- Token budget: SKILL.md ~4k tokens is reasonable for this domain (mine landed at 4038); split four reference docs (keys, mutations, router-integration, hono-client).
