import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// UUID generator — thin wrapper so call sites can swap the implementation
// in tests without touching node:crypto directly.
// ---------------------------------------------------------------------------

export const newUuid = (): string => randomUUID();

// ---------------------------------------------------------------------------
// Branded nominal-type helpers — prevent mixing domain identifiers.
// Construction functions are the sole legal creation points.
// ---------------------------------------------------------------------------

export type UserId = string & { readonly __brand: 'UserId' };
export type RefreshTokenId = string & { readonly __brand: 'RefreshTokenId' };

/** Cast a trusted string (e.g. from the DB column) to UserId. */
export const toUserId = (id: string): UserId => id as UserId;

/** Cast a trusted string (e.g. from the DB column) to RefreshTokenId. */
export const toRefreshTokenId = (id: string): RefreshTokenId => id as RefreshTokenId;

/** Generate a fresh UserId. */
export const newUserId = (): UserId => toUserId(newUuid());

/** Generate a fresh RefreshTokenId. */
export const newRefreshTokenId = (): RefreshTokenId => toRefreshTokenId(newUuid());
