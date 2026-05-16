# Zod v4 cheatsheet

Targeted reference for the patterns named in `SKILL.md`. Use as a lookup, not as a tutorial. Every example is keyed to a rule number from `SKILL.md`.

## Primitives & constraints (Rule 13)

```ts
z.string().min(1).max(255)
z.string().email()                    // RFC 5322 (Zod v4 ships a fast email check)
z.string().url()
z.string().uuid()                     // also: .ulid(), .nanoid(), .cuid2()
z.string().regex(/^\+\d{8,15}$/)
z.string().datetime({ offset: true }) // ISO-8601 with timezone offset, e.g. 2026-05-14T10:00:00+02:00
z.string().date()                     // calendar date YYYY-MM-DD (no time)
z.string().time()                     // wall-clock time HH:mm:ss
z.string().ip()
z.string().trim().toLowerCase()       // transforms — see Rule 19 limits

z.number().int().nonnegative().max(2_147_483_647)
z.number().finite()
z.bigint().nonnegative()

z.boolean()
z.literal("created")
z.enum(["draft", "published", "archived"])
z.nativeEnum(MyTsEnum)  // when an enum already exists in TS

z.null()
z.undefined()
z.void()
z.any()      // forbidden in this project — see TypeScript skill
z.unknown()  // narrow it before use
z.never()
```

## Optionality (Rule 11)

```ts
z.string().optional()  // T | undefined  — field may be omitted
z.string().nullable()  // T | null       — field is present but explicitly null
z.string().nullish()   // T | null | undefined — use only when wire format truly allows both

// Defaults (Rule 12): only when absence has deterministic server meaning.
z.array(z.string()).default(() => [])
z.boolean().default(false)
```

## Objects (Rules 9, 10)

```ts
z.object({ a: z.string(), b: z.number().optional() })   // default: .strip — unknown keys removed
z.object({ ... }).strict()                              // unknown keys → error (use for requests)
z.object({ ... }).passthrough()                         // unknown keys preserved (avoid in contracts)

// Composition
const Base   = z.object({ id: z.string().uuid() });
const Named  = Base.extend({ name: z.string().min(1) });
const Picked = Named.pick({ id: true });
const Omit   = Named.omit({ name: true });
const Partial = Named.partial();          // all fields optional
const Required = Named.required();        // all fields required
const Merged = Base.merge(z.object({ tag: z.string() }));
const Deep   = Named.deepPartial();       // recursive partial
```

## Arrays & tuples

```ts
z.array(z.string()).min(1).max(100)
z.array(z.object({ id: z.string().uuid() })).nonempty()
z.tuple([z.string(), z.number()])
z.tuple([z.string()]).rest(z.number())   // [string, ...number[]]
```

## Records, maps, sets

```ts
z.record(z.string(), z.number())          // { [k: string]: number }
z.record(UserId, z.array(z.string()))     // branded-key record
z.map(z.string(), z.number())
z.set(z.string()).min(1)
```

## Branded types (Rules 14, 15)

```ts
export const UserId = z.string().uuid().brand<"UserId">();
export type  UserId = z.infer<typeof UserId>;

function loadUser(id: UserId) { /* … */ }

const raw: string = "…";
loadUser(raw);                  // type error — must brand first
loadUser(UserId.parse(raw));    // OK at trust boundary
```

Brands are erased at runtime; they are a TypeScript-only tag. The brand IS the safety property — never strip it across function calls.

## Discriminated unions (Rules 16, 17)

```ts
export const auditEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("login"),   userId: UserId,  at: z.string().datetime({ offset: true }) }),
  z.object({ kind: z.literal("logout"),  userId: UserId,  at: z.string().datetime({ offset: true }) }),
  z.object({ kind: z.literal("failure"), reason: z.string().max(200), at: z.string().datetime({ offset: true }) }),
]);

type AuditEvent = z.infer<typeof auditEvent>;

function handle(e: AuditEvent) {
  switch (e.kind) {
    case "login":   /* e.userId is UserId */ break;
    case "logout":  /* e.userId is UserId */ break;
    case "failure": /* e.reason is string */ break;
  }
}
```

Why discriminated over `z.union`: O(1) branch selection, error messages point at the right object, exhaustiveness checks work in the consumer switch.

## Refinements (Rule 18)

```ts
// Cross-field
const dateRange = z.object({
  start: z.string().datetime({ offset: true }),
  end:   z.string().datetime({ offset: true }),
}).refine(d => d.start < d.end, {
  message: "end must be after start",
  path: ["end"],            // surfaces on the `end` form field
});

// Async (DB lookups, etc.) — use safeParseAsync at the boundary
const uniqueEmail = z.string().email().refine(async (e) => !(await userRepo.exists(e)), {
  message: "email already registered",
});
const result = await uniqueEmail.safeParseAsync(input);

// superRefine for multi-error reports
const passwordPolicy = z.string().superRefine((val, ctx) => {
  if (val.length < 12)       ctx.addIssue({ code: "custom", message: "min 12 chars" });
  if (!/[A-Z]/.test(val))    ctx.addIssue({ code: "custom", message: "needs uppercase" });
  if (!/[0-9]/.test(val))    ctx.addIssue({ code: "custom", message: "needs digit" });
});
```

## Transforms (Rules 19, 20)

```ts
// Safe normalization (same logical value)
const email = z.string().email().trim().toLowerCase();

// Numeric coercion from a query-string parameter
const limit = z.coerce.number().int().min(1).max(100).default(20);

// Pipeline: validate string, then transform to Date
const isoToDate = z.string().datetime({ offset: true }).pipe(z.coerce.date());

// When you need both shapes:
type EmailInput  = z.input<typeof email>;   // string before transform
type EmailOutput = z.output<typeof email>;  // string after trim/lowercase — same here
```

Transforms break the schema's symmetry between input and output. The UI binds to the INPUT type; the server consumes the OUTPUT type. Use `z.input` and `z.output` explicitly when they diverge.

## Coercion

```ts
z.coerce.string()    // String(x)
z.coerce.number()    // Number(x)
z.coerce.boolean()   // Boolean(x) — DANGEROUS: "false" → true. Prefer a literal enum or transform.
z.coerce.date()      // new Date(x)
z.coerce.bigint()    // BigInt(x)
```

Use coercion only for trusted shapes (query-string parameters, URL params). Never coerce a JSON request body — JSON already has typed primitives.

## Recursive types

```ts
// Lazy + manual TS type for the recursive shape
interface Comment {
  id: string;
  body: string;
  replies: Comment[];
}

const comment: z.ZodType<Comment> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    body: z.string().min(1),
    replies: z.array(comment),
  })
);
```

## Parsing

```ts
schema.parse(x)              // returns T or throws ZodError — tests and trusted code only (Rule 6)
schema.safeParse(x)          // { success, data?, error? } — boundaries (Rule 5)
await schema.parseAsync(x)
await schema.safeParseAsync(x)

// Error inspection
if (!result.success) {
  const flat = result.error.flatten();        // { formErrors: [], fieldErrors: { … } }
  const tree = result.error.format();         // nested { _errors, field: { _errors } }
  const issues = result.error.issues;          // raw issue[] array
}
```

## Inference

```ts
z.infer<typeof schema>     // ≡ z.output<typeof schema>
z.input<typeof schema>     // type accepted by .parse()
z.output<typeof schema>    // type returned by .parse()
```

When no `.transform()` is involved, input and output are identical and `z.infer` is sufficient.
