// ---------------------------------------------------------------------------
// Error code literal type — mirrors the AuthErrorCode enum in packages/contracts/src/auth.ts
// Keep code literals in sync; do NOT import from contracts here.
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA'
  | 'INTERNAL';

// ---------------------------------------------------------------------------
// Base AppError
// ---------------------------------------------------------------------------

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = code;
    this.code = code;
    this.status = status;
    this.details = details;
    // Restore prototype chain broken by extending built-ins in TypeScript.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Concrete subclasses
// ---------------------------------------------------------------------------

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('VALIDATION', message, 422, details);
    this.name = this.constructor.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super('UNAUTHORIZED', message, 401, details);
    this.name = this.constructor.name;
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super('FORBIDDEN', message, 403, details);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super('NOT_FOUND', message, 404, details);
    this.name = this.constructor.name;
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super('CONFLICT', message, 409, details);
    this.name = this.constructor.name;
  }
}

export class UnsupportedMediaError extends AppError {
  constructor(message = 'Unsupported media type', details?: unknown) {
    super('UNSUPPORTED_MEDIA', message, 415, details);
    this.name = this.constructor.name;
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large', details?: unknown) {
    super('PAYLOAD_TOO_LARGE', message, 413, details);
    this.name = this.constructor.name;
  }
}
