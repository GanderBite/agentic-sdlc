# Prepared statements

Covers `.prepare()`, `db.placeholder()`, lifecycle, and when prepared statements actually help.

## Shape

```ts
import { sql, eq } from "drizzle-orm";
import { db } from "../../shared/db";
import { account } from "./schema";

// Define once at module load. The "name" must be unique within the pool.
const findAccountByEmail = db
  .select()
  .from(account)
  .where(eq(account.email, sql.placeholder("email")))
  .limit(1)
  .prepare("account_by_email");

// Execute many times. `execute(params)` returns the rows.
export const byEmail = (email: string) =>
  findAccountByEmail.execute({ email });
```

`sql.placeholder("<key>")` marks a parameter. `db.placeholder("<key>")` (older alias) works too. The keys passed to `execute({...})` MUST match the placeholders one-for-one.

## What `.prepare()` actually does

It runs `PREPARE <name> AS <plan>` on a Postgres connection the first time it executes on that connection. Subsequent executions skip the parse step. The plan is cached on the connection.

The `pg` driver maintains the prepared statement per connection. When the pool reuses a connection, the prepared plan is still cached.

## When prepared statements help

- Hot read paths with stable shape, executed > ~50 times per second per process (login, session lookup, slot availability check).
- Queries with expensive plans (multi-join, aggregation on indexed columns).

When prepared statements DO NOT help (or hurt):

- One-off admin queries.
- Queries whose shape depends on runtime conditions (`if (filter.x) qb = qb.where(...)`). The query builder shape must be fixed at `prepare` time.
- Inserts of small batches where the parse cost is negligible.

## Placeholders for `in`-clauses

The placeholder mechanism does NOT auto-expand arrays. To bind an `IN (?, ?, ?)` shape, use the `sql` tag explicitly OR use `inArray` with a literal array at execute time (which prevents prepare benefit).

```ts
// pragmatic: don't prepare; use inArray with a runtime array
import { inArray } from "drizzle-orm";
db.select().from(account).where(inArray(account.id, ids));
```

## Lifecycle

- Prepared statements live for the lifetime of the connection.
- `pool.end()` releases connections; prepared statements vanish with them.
- No explicit `.deallocate()` is needed; do not call `DEALLOCATE` manually unless debugging.

## Naming

Prepared statement names must be unique per connection. Use a stable, descriptive name (`"account_by_email"`, `"slot_availability_window"`). Drizzle will error if two `.prepare()` calls collide.

## Inside transactions

`tx.prepare("...")` works. The prepared statement still lives on the underlying connection — it survives the transaction's commit. Do not name a prepared statement after a transaction-scoped concept.

## Verifying with `EXPLAIN`

To confirm Postgres is using a cached plan:

```sql
EXPLAIN (ANALYZE, VERBOSE) EXECUTE account_by_email('user@example.com');
```

Note: Postgres uses a "custom plan" for the first 5 executions of a prepared statement, then switches to a "generic plan" if it appears comparable. If a generic plan is worse than a custom one for your data distribution, set `plan_cache_mode = 'force_custom_plan'` on the session (rare; measure first).
