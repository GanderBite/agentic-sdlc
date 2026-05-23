# Upload safety — adversarial input corpus

Three attack classes, three smokes. Each MUST be present per upload endpoint.

## 1. MIME spoofing

Declared `Content-Type` must agree with magic bytes. The server detects via magic bytes; the declared header is metadata only.

### Magic-byte reference (subset used in tests)

| Format | Magic bytes (hex)            |
|--------|------------------------------|
| PNG    | `89 50 4E 47 0D 0A 1A 0A`    |
| JPEG   | `FF D8 FF`                   |
| PDF    | `25 50 44 46 2D` (`%PDF-`)   |
| GIF87a | `47 49 46 38 37 61`          |
| GIF89a | `47 49 46 38 39 61`          |
| ZIP    | `50 4B 03 04`                |

### Test recipe

```ts
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, /* ...rest of a tiny PDF... */]);

const form = new FormData();
form.append("file", new Blob([pdfBytes], { type: "image/png" }), "evil.png");

const res = await app.request("/api/documents/upload", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "x-csrf-token": csrf, cookie: `csrf=${csrf}` },
  body: form,
});
expect(res.status).toBe(415);
await assertAppError(res, "UPLOAD_MIME_MISMATCH");
```

## 2. Path-traversal filenames

The corpus below MUST be exercised. Each row asserts `400 UPLOAD_BAD_FILENAME`.

```ts
const BAD_FILENAMES = [
  "../../etc/passwd",
  "..\\..\\windows\\system32\\config\\sam",
  "..%2F..%2Fetc%2Fpasswd",         // URL-encoded traversal
  "normal\x00.png",                  // embedded NUL
  "with/slash.png",                  // bare path separator
  "with\\backslash.png",
  ".",
  "..",
  "",
  "a".repeat(300) + ".png",          // length > 255
  "evil\nname.png",                  // embedded newline
  "image .png",                       // trailing-dot/space windows quirk (also rejected by our regex)
];
```

### Acceptance regex (server-side)

```
^[A-Za-z0-9._-]{1,255}$
```

Filenames not matching this regex are rejected. The test sends each row in turn, then — for valid uploads — fetches the stored object and asserts the returned filename ALSO matches the regex (output-side sanitization, per skill Rule 18).

## 3. Oversize body

The boundary case is `MAX_UPLOAD_BYTES + 1`, not "huge". Servers commonly mis-count by one.

```ts
const MAX = Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024); // 10 MiB default
const overByOne = new Uint8Array(MAX + 1);

const form = new FormData();
form.append("file", new Blob([overByOne], { type: "image/png" }), "ok.png");

const res = await app.request("/api/documents/upload", { method: "POST", body: form, headers });
expect(res.status).toBe(413);
await assertAppError(res, "UPLOAD_TOO_LARGE");
```

ALSO test `MAX` exactly (must succeed) and `MAX - 1` (must succeed). The three-row boundary protects against off-by-one.

## 4. OPTIONAL — zip-bomb / nested-archive

Out of scope for the smoke matrix unless the brief explicitly enables archive uploads. If it does, add a `references/archive-uploads.md` with decompression-ratio guards and stream-time limits.

## What NOT to test here

- libmagic / `file-type` internals. Trust the library; assert our wrapper's verdict.
- Antivirus integration. Separate contract, separate skill if it ever lands.
- S3/object-store ACLs. Infrastructure concern.
