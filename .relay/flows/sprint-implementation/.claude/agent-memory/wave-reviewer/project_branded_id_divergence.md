---
name: branded-id-divergence
description: When contracts package and apps/api/shared both declare a branded ID with the same name but different brand strategies (Zod brand vs structural brand), downstream service code will need to cast across them — flag medium/architecture.
metadata:
  type: project
---

In sprint-001 wave-3, packages/contracts/src/auth.ts declared `UserId = z.string().uuid().brand<'UserId'>()` while apps/api/src/shared/ids.ts declared `type UserId = string & { readonly __brand: 'UserId' }`. The two are structurally incompatible.

**Why:** A downstream auth.service call site receives loginResponse.user.id typed as the Zod-brand and may try to pass it to a repo function typed against the structural brand — TS rejects without a cast, but the cast hides any future drift.

**How to apply:** When reviewing scaffolding waves that touch BOTH a contracts package and an apps/api/shared/ids module, grep for same-named branded identifiers across the two and flag any divergence in brand strategy as a `medium` architecture finding before downstream service tasks consume them. Prefer suggesting that contracts owns the brand and apps/api re-exports it, OR vice versa — but pick ONE home.
