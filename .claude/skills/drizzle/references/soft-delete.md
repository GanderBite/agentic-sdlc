# Soft-delete

Convention for tables that must retain deleted rows (medical record, account, document, appointment history).

## Column

```ts
deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
```

Nullable. `NULL` means "alive". A non-null value means "deleted at this instant".

Add a partial index when read paths overwhelmingly hit alive rows:

```ts
(t) => ({
  aliveByPatient: index("medical_record_alive_patient_idx")
    .on(t.patientId)
    .where(sql`${t.deletedAt} is null`),
}),
```

## Which tables get it

Only tables whose deletion must be auditable or undoable. Per the MedBridge brief:

- `account`, `medical_record`, `document`, `appointment` — soft-delete.
- `slot`, `refresh_token`, `csrf_token` — hard-delete (no `deletedAt` column).

If a table does NOT have a `deletedAt` column, treat deletes as `db.delete(t).where(...)` and accept that the row is gone.

## Read paths

Every SELECT on a soft-deletable table MUST filter `isNull(t.deletedAt)`:

```ts
import { eq, and, isNull } from "drizzle-orm";

db.select()
  .from(medicalRecord)
  .where(and(eq(medicalRecord.id, id), isNull(medicalRecord.deletedAt)));
```

For relational queries:

```ts
db.query.medicalRecord.findFirst({
  where: (t, { and, eq, isNull }) =>
    and(eq(t.id, id), isNull(t.deletedAt)),
  with: {
    patient: {
      where: (p, { isNull }) => isNull(p.deletedAt), // also filter joined tables
    },
  },
});
```

There is no global "alive-only" filter in Drizzle 0.38. Every query must include the predicate explicitly. Reviewers should reject any read on a soft-deletable table that omits `isNull(deletedAt)`.

## Write paths

"Delete":

```ts
db.update(medicalRecord)
  .set({ deletedAt: new Date(), updatedAt: new Date() })
  .where(and(eq(medicalRecord.id, id), isNull(medicalRecord.deletedAt)))
  .returning();
```

The `isNull(deletedAt)` predicate in `WHERE` makes the operation idempotent: deleting an already-deleted row affects zero rows. Use `returning()` to detect that case.

Never `db.delete(...)` on a soft-deletable table.

## Restore

```ts
db.update(medicalRecord)
  .set({ deletedAt: null, updatedAt: new Date() })
  .where(eq(medicalRecord.id, id));
```

Restoring is also a soft-delete inverse — same `updatedAt` bump, no foreign-key revalidation needed (the FKs were never removed).

## Foreign keys

Soft-deleted rows still satisfy FK constraints. A child table referencing a soft-deleted parent is still valid by Postgres rules — the row exists.

For UX, decide per relation:

- "A doctor's deleted appointment should disappear from her list" → filter `isNull(deletedAt)` in the read.
- "An audit query must see the deleted appointment" → omit the filter in that specific read.

Never use `onDelete: "cascade"` for soft-deletable parents; the cascade would only fire on a hard-delete you should never perform. Use `onDelete: "restrict"` so an accidental hard-delete fails loudly.

## Uniqueness with soft-delete

A `UNIQUE` constraint on `email` becomes a problem if a deleted row keeps occupying the email. Two options:

1. **Partial unique index** (preferred):
   ```ts
   uniqueIndex("account_email_uniq")
     .on(t.email)
     .where(sql`${t.deletedAt} is null`)
   ```
   Drizzle Kit emits this as `CREATE UNIQUE INDEX ... WHERE "deleted_at" IS NULL`. Deleted rows can share emails.

2. **Email rewrite on delete**: set `email = id || '@deleted'` in the same UPDATE that sets `deletedAt`. Lossy; only when option 1 is impractical.

MedBridge uses option 1 for `account.email`.

## Cascading soft-delete

If deleting an `account` should soft-delete its `medical_record` rows, do it explicitly in the service layer inside a transaction:

```ts
db.transaction(async (tx) => {
  const now = new Date();
  await tx.update(medicalRecord).set({ deletedAt: now }).where(eq(medicalRecord.patientId, id));
  await tx.update(account).set({ deletedAt: now }).where(eq(account.id, id));
});
```

There is no DB-level cascade for soft-delete; relying on a trigger would hide the operation from the audit trail.
