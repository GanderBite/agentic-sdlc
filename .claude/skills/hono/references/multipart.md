# multipart

File upload handling using only Hono's built-in `c.req.parseBody`.

## Allow-list and limits

```ts
// src/upload/policy.ts
export const UPLOAD_POLICY = {
  // PDF, common images, common docs — keep narrow.
  allowedMime: new Set([
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'text/csv',
  ]),
  maxBytes: 25 * 1024 * 1024,           // 25 MiB hard ceiling
  streamThresholdBytes: 1 * 1024 * 1024 // > 1 MiB → must stream
};
```

## Single-file route

```ts
import { Hono } from 'hono';
import { authRequired } from '../middleware/auth';
import { csrf } from '../middleware/csrf';
import { AppError } from '../errors';
import { UPLOAD_POLICY } from '../upload/policy';
import { storeObject } from '../upload/store';

const uploads = new Hono<{ Variables: AppVariables }>();

uploads.use('*', authRequired);

uploads.post('/', csrf, async (c) => {
  const form = await c.req.parseBody({ all: true });
  const file = form['file'];
  if (!(file instanceof File)) throw new AppError('VALIDATION_ERROR', 'missing file', 400);

  if (!UPLOAD_POLICY.allowedMime.has(file.type)) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', `mime ${file.type} not allowed`, 415);
  }
  if (file.size > UPLOAD_POLICY.maxBytes) {
    throw new AppError('FILE_TOO_LARGE', `max ${UPLOAD_POLICY.maxBytes}B`, 413);
  }

  // > 1 MiB → stream to object storage, never buffer.
  if (file.size > UPLOAD_POLICY.streamThresholdBytes) {
    const key = await storeObject.fromStream(file.stream(), {
      contentType: file.type,
      contentLength: file.size,
    });
    return c.json({ key }, 201);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const key = await storeObject.fromBuffer(buf, { contentType: file.type });
  return c.json({ key }, 201);
});

export default uploads;
```

## Multi-file route

```ts
uploads.post('/batch', csrf, async (c) => {
  const form = await c.req.parseBody({ all: true });
  const files = form['files'];
  const list = Array.isArray(files) ? files : [files];

  const out: string[] = [];
  for (const f of list) {
    if (!(f instanceof File)) continue;
    if (!UPLOAD_POLICY.allowedMime.has(f.type)) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', f.type, 415);
    }
    if (f.size > UPLOAD_POLICY.maxBytes) {
      throw new AppError('FILE_TOO_LARGE', `${f.name}`, 413);
    }
    out.push(await storeObject.fromStream(f.stream(), {
      contentType: f.type,
      contentLength: f.size,
    }));
  }
  return c.json({ keys: out }, 201);
});
```

## Form fields alongside files

`parseBody({ all: true })` returns a `Record<string, string | File | (string | File)[]>`. Validate scalar fields against a Zod schema; never trust raw values:

```ts
import { UploadMetadata } from '@medbridge/contracts/upload';

const meta = UploadMetadata.safeParse({
  patientId: form['patientId'],
  note: form['note'],
});
if (!meta.success) throw AppError.fromZod(meta.error, { target: 'form' });
```

For pure JSON-style validation of a multipart-form-data submission, the `zValidator('form', schema)` validator works for *scalar* fields only — files cannot be expressed in Zod the same way.

## Never do

- Call `await file.arrayBuffer()` on files > 1 MiB — buffers the entire upload in heap.
- Save the file to a path derived from `file.name` — sanitize, or always use a generated key.
- Skip MIME validation. Trust the policy allow-list, not the file extension.
