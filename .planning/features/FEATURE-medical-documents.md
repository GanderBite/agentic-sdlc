---
slug: medical-documents
title: "Medical document upload, listing, soft-delete, and download"
primary_users: ["patient","doctor"]
depends_on: ["api-scaffold-auth","ui-scaffold-login"]
estimated_task_count: 16
---

# Medical document upload, listing, soft-delete, and download

## Summary

Patients upload JPEG/PNG/PDF documents (≤10 MB), list and soft-delete them, and download via a `Content-Disposition: attachment` stream that authorizes the requester against ownership or an active appointment_document_share.

## Scope

- Drizzle medical_document table (original_filename, stored_filename UUID, mime_type, size_bytes, uploaded_at, deleted_at)
- POST /api/documents.upload using Hono's parseBody with MIME whitelist + 10 MB size cap + UUID filename generation
- Atomic on-disk + DB write (orphan-free) backed by fs.unlink rollback on row-insert failure
- POST /api/documents.list and POST /api/documents.delete (soft) routes
- GET /api/documents.download streaming endpoint with role-aware authorization (owner OR active share)
- Patient UI: upload form (drag/drop + file picker), document list with download-only link that opens in a new tab
- Bind-mounted uploads/ volume wired into docker-compose for the api service


## Out of scope

- In-browser PDF/image viewer (download-only per clarification)
- Thumbnail generation
- Versioning of a single document
- Antivirus scanning
- Doctor share UI (lives in appointment-booking)


## Acceptance bullets

- POST /api/documents.upload accepts multipart/form-data, validates Content-Type ∈ {image/jpeg, image/png, application/pdf} and size ≤ 10 MB; on success the file is written to ${UPLOAD_DIR}/<uuid>.<ext>, the medical_document row is inserted with the original filename preserved, and the response includes the document's id and original filename.
- An upload with a disallowed MIME type returns HTTP 415 UNSUPPORTED_MEDIA and writes no file; an upload exceeding 10 MB returns HTTP 413 PAYLOAD_TOO_LARGE and writes no file.
- A simulated DB-insert failure in an integration test leaves no orphaned file in ${UPLOAD_DIR} (fs.unlink rollback verified).
- POST /api/documents.list returns the caller patient's non-soft-deleted documents with id, original filename, mime type, size, and uploaded_at.
- POST /api/documents.delete soft-deletes the row while leaving the file on disk; subsequent list calls omit the row.
- GET /api/documents.download?id=… streams the file with `Content-Disposition: attachment; filename="<original>"`; the patient owner always succeeds; a doctor without an active appointment_document_share returns HTTP 403 FORBIDDEN.
- The on-disk filename is the generated UUID — a unit test asserts the original filename never appears in any persisted filesystem path.
- The Patient Profile UI exposes an upload form and a per-document download link with `target="_blank" rel="noopener"` that triggers the native browser download/viewer.

