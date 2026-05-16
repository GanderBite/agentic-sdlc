# Drizzle transactions

Covers `db.transaction(...)`, isolation levels, nested savepoints, retry on serialization failure, and cross-module `tx` plumbing.

## Shape

```ts
import { db, type Db, type Tx } from "../../shared/db";

await db.transaction(async (tx) => {
  await tx.insert(a).values({...});
  await tx.update(b).set({...}).where(...);
  // throwing aborts; returning normally commits
});
```

`tx` has the same query API as `db` plus `tx.rollback()` and `tx.transaction(...)` (savepoint).

## Commit vs rollback semantics

- Returning normally from the callback → COMMIT.
- Throwing any exception → ROLLBACK and the exception is re-thrown to the caller.
- Calling `tx.rollback()` → ROLLBACK and Drizzle throws a `TransactionRollbackError` to escape the callback. Use ONLY when you have already produced the return value and need to discard the writes (rare).
- `return` from a nested function inside the callback does NOT roll back. The outer `async` function continues; only thrown errors trigger rollback.

## Isolation level + access mode

```ts
await db.transaction(
  async (tx) => { /* ... */ },
  { isolationLevel: "repeatable read", accessMode: "read write", deferrable: false },
);
```

Exhaustive `isolationLevel`: `"read uncommitted" | "read committed" | "repeatable read" | "serializable"`. PostgreSQL treats `"read uncommitted"` as `"read committed"`.

Default is whatever Postgres defaults to (`"read committed"`). Use `"repeatable read"` for slot reservation / multi-step booking flows where another transaction must not change the rows you have already read.

## Retrying on serialization failure

Postgres can abort a `"repeatable read"` or `"serializable"` transaction with SQLSTATE `40001`. The caller is expected to retry. Drizzle does NOT retry automatically.

```ts
import { DatabaseError } from "pg";

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      if (e instanceof DatabaseError && e.code === "40001" && i < attempts - 1) continue;
      throw e;
    }
  }
  throw new Error("unreachable");
}

await withRetry(() => db.transaction(book, { isolationLevel: "repeatable read" }));
```

Three attempts is the project convention. Anything more masks an actual conflict bug.

## Nested savepoints

```ts
await db.transaction(async (tx) => {
  await tx.insert(audit).values({...}); // outer

  try {
    await tx.transaction(async (sp) => {
      await sp.insert(child).values({...}); // savepoint
      if (badCondition) throw new Error("rollback child only");
    });
  } catch {
    // savepoint rolled back; outer transaction continues
  }

  await tx.insert(another).values({...});
}); // commits outer (audit + another), child was rolled back
```

Use savepoints only for genuinely retryable inner units (e.g. probing a unique constraint). Do not use them as control flow — early-return + a single outer transaction is simpler.

## Cross-module transaction plumbing

A module's `index.ts` (public surface) exposes functions that accept `Db | Tx`:

```ts
// modules/scheduling/index.ts
import type { Db, Tx } from "../../shared/db";
export { reserveSlot, releaseSlot } from "./service";

// modules/scheduling/service.ts
export const reserveSlot = (executor: Db | Tx, slotId: string, patientId: string) =>
  /* repo call against executor */;
```

The caller passes `tx` from inside its own transaction:

```ts
// modules/appointments/service.ts
import { reserveSlot } from "../scheduling";

export const book = (input: BookInput) =>
  db.transaction(async (tx) => {
    await reserveSlot(tx, input.slotId, input.patientId);
    // ...
  });
```

Never call `db.transaction(...)` from inside an already-running transaction. Postgres has no nested transactions; Drizzle would issue `SAVEPOINT`, which is rarely what you want and silently changes the rollback semantics.

## What `tx` exposes that `db` does not

- `tx.rollback()` — explicit abort.
- `tx.transaction(...)` — savepoint.

`db.prepare(...)` works on `tx` too; the prepared name is unique per connection, not per transaction.

## Type aliases

The `Tx` type in `shared/db.ts`:

```ts
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
```

Repo functions accept `Db | Tx` as the executor so the same function works inside and outside a transaction.

## Anti-patterns

- Calling `db.method(...)` (not `tx`) inside the callback. The query runs on a separate connection and is NOT part of the transaction.
- `await Promise.all([tx.insert(...), tx.update(...)])` — Drizzle's `tx` is bound to one connection; concurrent queries on the same `tx` are unsupported. Run sequentially.
- Catching and swallowing inside the callback. The transaction commits as if nothing went wrong. Either re-throw or call `tx.rollback()`.
