# validation

Zod 4 + `@hono/zod-validator` patterns for MedBridge routes.

## Why a wrapper

`zValidator(target, schema)` without a hook will respond with Zod's default 400 shape, which violates the error contract (Rule 17). The hook converts failures into `AppError`.

## Canonical wrapper

```ts
// src/middleware/validate.ts
import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';
import { AppError } from '../errors';

type Target = 'json' | 'query' | 'param' | 'form' | 'header' | 'cookie';

export const validate = <S extends ZodType>(target: Target, schema: S) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      throw AppError.fromZod(result.error, { target });
    }
  });
```

Usage:

```ts
import { validate } from '../../middleware/validate';
import { CreateResource, ResourceQuery } from '@medbridge/contracts/resource';

resource.get('/', validate('query', ResourceQuery), async (c) => {
  const { page, pageSize } = c.req.valid('query');
  // ...
});

resource.post('/', csrf, validate('json', CreateResource), async (c) => {
  const input = c.req.valid('json');
  // ...
});
```

## `AppError.fromZod`

```ts
// src/errors.ts (excerpt)
import type { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly httpStatus: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  static fromZod(err: ZodError, ctx?: { target: string }): AppError {
    return new AppError(
      'VALIDATION_ERROR',
      'Request payload failed validation',
      400,
      {
        target: ctx?.target,
        issues: err.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      },
    );
  }
}
```

## Schemas live in `packages/contracts`

Route files import from `@medbridge/contracts/<resource>`. Never:

- Define schemas inside route files.
- Re-export `zod` itself from `packages/contracts`. Import `zod` directly where needed (e.g., in the contracts package itself), and import the *schemas* in the API.

## Path params

Path params are strings; coerce in the schema:

```ts
// packages/contracts/resource.ts
export const ResourceIdParam = z.object({
  id: z.string().uuid(),
});
```

```ts
resource.get('/:id', validate('param', ResourceIdParam), async (c) => {
  const { id } = c.req.valid('param');
  // ...
});
```

## Multiple validators on one route

Apply one validator per target. Order does not matter between targets, but all run before the handler:

```ts
resource.patch(
  '/:id',
  csrf,
  validate('param', ResourceIdParam),
  validate('json', UpdateResource),
  async (c) => {
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    // ...
  },
);
```
