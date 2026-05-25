import type { ErrorCode } from '@medbridge/contracts';

/**
 * Typed error thrown by the API client for all non-2xx HTTP responses.
 * Carries the structured error envelope from the server.
 */
export class ApiError extends Error {
  readonly code: ErrorCode | 'INTERNAL';
  readonly status: number;
  readonly details?: unknown;

  constructor({
    code,
    message,
    status,
    details,
  }: {
    code: ErrorCode | 'INTERNAL';
    message: string;
    status: number;
    details?: unknown;
  }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
