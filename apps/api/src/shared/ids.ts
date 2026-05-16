import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Brand helper
// ---------------------------------------------------------------------------

declare const brand: unique symbol;

/**
 * Generic branded type for nominal typing of primitive values.
 * Compatible with the `z.string().uuid().brand<B>()` pattern in packages/contracts.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

// ---------------------------------------------------------------------------
// Domain identifier types
// ---------------------------------------------------------------------------

export type UserId = Brand<string, 'UserId'>;
export type RefreshTokenId = Brand<string, 'RefreshTokenId'>;

// ---------------------------------------------------------------------------
// Smart constructors
// ---------------------------------------------------------------------------

export const UserId = (s: string): UserId => s as UserId;
export const RefreshTokenId = (s: string): RefreshTokenId => s as RefreshTokenId;

// ---------------------------------------------------------------------------
// UUID generator
// ---------------------------------------------------------------------------

export function newUuid(): string {
  return randomUUID();
}
