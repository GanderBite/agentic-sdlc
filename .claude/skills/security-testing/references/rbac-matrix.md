# RBAC role matrix testing pattern

The role matrix is one `describe.each` table per module. Adding a role or a route is a row edit, not a new test. This keeps the security floor mechanical: a reviewer can read the table and reason about coverage without reading test bodies.

## Row shape

```ts
type Role = "patient" | "doctor" | "admin";
type Method = "GET" | "POST" | "PATCH" | "DELETE";

type MatrixRow = {
  /** Human label for the test name. */
  label: string;
  role: Role;
  method: Method;
  /** Path template with concrete IDs from the fixture. */
  path: string;
  /** Optional JSON body for non-GET requests. */
  body?: unknown;
  /** Expected HTTP status. 2xx = allowed; 403 = forbidden. */
  expected: 200 | 201 | 204 | 403;
  /** Required when expected === 403. */
  code?: "FORBIDDEN" | "SHARE_INVALID";
};
```

## Example — documents module

```ts
// apps/api/src/modules/documents/__tests__/documents.rbac.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { mintJwt } from "@/test/security/tokens";
import { assertAppError } from "@/test/security/envelope";
import { seedDocuments } from "@/test/security/factories";
import { app } from "@/app";

let ownDocId: string;
let otherDocId: string;

beforeAll(async () => {
  ({ ownDocId, otherDocId } = await seedDocuments());
});

const rows: MatrixRow[] = [
  // GET /api/documents/:id
  { label: "patient reads own doc",        role: "patient", method: "GET",    path: () => `/api/documents/${ownDocId}`,   expected: 200 },
  { label: "patient reads other doc",      role: "patient", method: "GET",    path: () => `/api/documents/${otherDocId}`, expected: 403, code: "SHARE_INVALID" },
  { label: "doctor reads shared doc",      role: "doctor",  method: "GET",    path: () => `/api/documents/${ownDocId}`,   expected: 200 },
  { label: "doctor reads unshared doc",    role: "doctor",  method: "GET",    path: () => `/api/documents/${otherDocId}`, expected: 403, code: "SHARE_INVALID" },
  { label: "admin reads any doc",          role: "admin",   method: "GET",    path: () => `/api/documents/${otherDocId}`, expected: 200 },

  // DELETE /api/documents/:id
  { label: "patient deletes own doc",      role: "patient", method: "DELETE", path: () => `/api/documents/${ownDocId}`,   expected: 204 },
  { label: "doctor deletes any doc",       role: "doctor",  method: "DELETE", path: () => `/api/documents/${ownDocId}`,   expected: 403, code: "FORBIDDEN" },
  { label: "admin deletes any doc",        role: "admin",   method: "DELETE", path: () => `/api/documents/${otherDocId}`, expected: 204 },
];

describe.each(rows)("RBAC :: $label", (row) => {
  it(`${row.method} ${row.path()} → ${row.expected}`, async () => {
    const token = await mintJwt({ sub: subFor(row.role), role: row.role });
    const res = await app.request(row.path(), {
      method: row.method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        // CSRF wired by helper for non-GET; see api-integration-testing skill.
      },
      body: row.body ? JSON.stringify(row.body) : undefined,
    });
    expect(res.status).toBe(row.expected);
    if (row.expected === 403) {
      await assertAppError(res, row.code!);
    }
  });
});
```

## Coverage invariants

For each route in the module, the table MUST include one row per `Role`. Missing rows hide regressions where a new role silently inherits permissions.

A linter-style sanity check at the top of the test:

```ts
const routes = new Set(rows.map(r => `${r.method} ${routeKey(r.path())}`));
const roles: Role[] = ["patient", "doctor", "admin"];
for (const route of routes) {
  for (const role of roles) {
    const hit = rows.some(r => `${r.method} ${routeKey(r.path())}` === route && r.role === role);
    if (!hit) throw new Error(`RBAC matrix missing: ${role} × ${route}`);
  }
}
```

Place this before `describe.each`. It fails fast at module load when coverage drops.

## When to split the matrix

- Module has > 30 rows → split by resource (e.g., `documents.read.rbac.test.ts`, `documents.write.rbac.test.ts`).
- A row needs custom fixture state different from the rest → keep it in the table but factor the seed into a helper; do NOT move it to a bespoke `it()` outside the matrix.

## Anti-pattern

```ts
it("admin can do everything", async () => { ... });
it("patient cannot do admin things", async () => { ... });
```

Two opaque tests cannot encode a 3×N permission grid. Use the table.
