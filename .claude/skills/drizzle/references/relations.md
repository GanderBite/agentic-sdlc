# Relations API

Covers `relations(...)`, `one` vs `many`, junction tables, nested `with`, and the `findFirst` vs `select` distinction.

## Defining relations

`relations(...)` is a separate export per table. It does NOT change DDL — it only enriches the relational query API (`db.query.<table>.findX`).

```ts
import { relations } from "drizzle-orm";

export const appointment = pgTable("appointment", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  patientId: uuid("patient_id").notNull().references(() => account.id),
  doctorId: uuid("doctor_id").notNull().references(() => account.id),
  slotId: uuid("slot_id").notNull().references(() => slot.id),
});

export const appointmentRelations = relations(appointment, ({ one }) => ({
  patient: one(account, { fields: [appointment.patientId], references: [account.id], relationName: "patient_appointments" }),
  doctor:  one(account, { fields: [appointment.doctorId],  references: [account.id], relationName: "doctor_appointments" }),
  slot:    one(slot,    { fields: [appointment.slotId],    references: [slot.id] }),
}));
```

The barrel re-exports both the table AND the `*Relations` export. Drizzle's `drizzle(pool, { schema })` discovers relations by name; missing relations from the barrel break `db.query.*`.

## `one` vs `many`

- `one(target, { fields, references })` — FK on THIS table. The relation key returns one row (or null).
- `many(target)` — back-reference; the FK is on `target`. No `fields/references` parameters.

```ts
export const accountRelations = relations(account, ({ many }) => ({
  patientAppointments: many(appointment, { relationName: "patient_appointments" }),
  doctorAppointments:  many(appointment, { relationName: "doctor_appointments" }),
}));
```

When two relations connect the same pair of tables (account → appointment as patient AND as doctor), both sides MUST use `relationName` to disambiguate. Drizzle errors at startup if relation names collide ambiguously.

## Junction tables (many-to-many)

```ts
export const documentShare = pgTable("document_share", {
  documentId: uuid("document_id").notNull().references(() => document.id),
  accountId:  uuid("account_id").notNull().references(() => account.id),
}, (t) => ({ pk: primaryKey({ columns: [t.documentId, t.accountId] }) }));

export const documentShareRelations = relations(documentShare, ({ one }) => ({
  document: one(document, { fields: [documentShare.documentId], references: [document.id] }),
  account:  one(account,  { fields: [documentShare.accountId],  references: [account.id] }),
}));

export const documentRelations = relations(document, ({ many }) => ({
  shares: many(documentShare),
}));
```

To load a document with its sharing accounts:

```ts
db.query.document.findFirst({
  where: (t, { eq }) => eq(t.id, id),
  with: {
    shares: { with: { account: true } },
  },
});
```

There is no implicit "many-to-many through" — you traverse the junction explicitly.

## `findFirst` vs `findMany` vs `select`

- `db.query.t.findFirst({...})` → returns `T | undefined`. Use for single-row reads.
- `db.query.t.findMany({...})` → returns `T[]`. Use when you want nested loads.
- `db.select().from(t).where(...).limit(1)` → returns `T[]` of length ≤ 1. Use when you want explicit projection or aggregation.

The relational API loads relations with separate SQL queries (one per relation) and stitches in JS. It is NOT a SQL JOIN. For deep, perf-critical reads, write the JOIN by hand with `db.select(...).leftJoin(...)`.

## `with` filtering

```ts
db.query.patient.findFirst({
  where: (p, { eq }) => eq(p.id, id),
  with: {
    appointments: {
      where: (a, { and, gte, isNull }) =>
        and(gte(a.startsAt, new Date()), isNull(a.deletedAt)),
      orderBy: (a, { asc }) => asc(a.startsAt),
      limit: 5,
    },
  },
});
```

`with: { relationKey: true }` loads with default options. `with: { relationKey: { where, orderBy, limit, with } }` customizes the sub-query.

## Common pitfalls

- Forgetting to export `*Relations` from the barrel. The relation silently no-ops; `db.query.t.findFirst({ with: { rel: true } })` returns `undefined` for the relation key without erroring.
- Defining `one` on the side that does NOT hold the FK. Drizzle uses `fields/references` to know which side; putting `one` on the parent with parent's column as `fields` produces wrong joins.
- Using the relational API for aggregates. `db.query.*` has no `count()`. Use `db.select({ n: count() }).from(t)`.
- Expecting `with: { rel: { where: ... } }` to filter the PARENT row. It only filters the joined relation; the parent still returns even if the relation is empty.
