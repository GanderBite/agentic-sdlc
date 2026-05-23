import type { ErrorCode } from '@medbridge/contracts';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) {
      this.details = details;
    }
    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    const code: ErrorCode = 'VALIDATION';
    super(code, message, 422, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    const code: ErrorCode = 'NOT_FOUND';
    super(code, message, 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    const code: ErrorCode = 'UNAUTHORIZED';
    super(code, message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    const code: ErrorCode = 'FORBIDDEN';
    super(code, message, 403);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    const code: ErrorCode = 'CONFLICT';
    super(code, message, 409);
    this.name = 'ConflictError';
  }
}

export class UnsupportedMediaError extends AppError {
  constructor(message = 'Unsupported media type') {
    const code: ErrorCode = 'UNSUPPORTED_MEDIA';
    super(code, message, 415);
    this.name = 'UnsupportedMediaError';
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large') {
    const code: ErrorCode = 'PAYLOAD_TOO_LARGE';
    super(code, message, 413);
    this.name = 'PayloadTooLargeError';
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    const code: ErrorCode = 'TOO_MANY_REQUESTS';
    super(code, message, 429);
    this.name = 'TooManyRequestsError';
  }
}
