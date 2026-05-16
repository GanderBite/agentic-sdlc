// ---------------------------------------------------------------------------
// ErrorCode — discriminated-union literal type aligned with packages/contracts
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNSUPPORTED_MEDIA'
  | 'PAYLOAD_TOO_LARGE'
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
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (details !== undefined) {
      this.details = details;
    }
    // Restore prototype chain (required when extending built-ins in TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Concrete subclasses
// ---------------------------------------------------------------------------

export class ValidationError extends AppError {
  override readonly code = 'VALIDATION' as const;

  constructor(message = 'Validation failed', details?: unknown) {
    super('VALIDATION', message, 422, details);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthorizedError extends AppError {
  override readonly code = 'UNAUTHORIZED' as const;

  constructor(message = 'Unauthorized', details?: unknown) {
    super('UNAUTHORIZED', message, 401, details);
    this.name = 'UnauthorizedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ForbiddenError extends AppError {
  override readonly code = 'FORBIDDEN' as const;

  constructor(message = 'Forbidden', details?: unknown) {
    super('FORBIDDEN', message, 403, details);
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  override readonly code = 'NOT_FOUND' as const;

  constructor(message = 'Not found', details?: unknown) {
    super('NOT_FOUND', message, 404, details);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConflictError extends AppError {
  override readonly code = 'CONFLICT' as const;

  constructor(message = 'Conflict', details?: unknown) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnsupportedMediaError extends AppError {
  override readonly code = 'UNSUPPORTED_MEDIA' as const;

  constructor(message = 'Unsupported media type', details?: unknown) {
    super('UNSUPPORTED_MEDIA', message, 415, details);
    this.name = 'UnsupportedMediaError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PayloadTooLargeError extends AppError {
  override readonly code = 'PAYLOAD_TOO_LARGE' as const;

  constructor(message = 'Payload too large', details?: unknown) {
    super('PAYLOAD_TOO_LARGE', message, 413, details);
    this.name = 'PayloadTooLargeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
