import { randomBytes } from "node:crypto";

/**
 * Generates a UUIDv7 — a time-ordered UUID whose most-significant 48 bits
 * contain the Unix epoch in milliseconds.  Uses `node:crypto` random bytes
 * for the remaining bits so no external `uuid` package is required.
 *
 * Layout (RFC 9562 §5.7):
 *   0xFFFFFFFFFFFF_0_FFF_B_FFFFFFFFFFFF
 *   [48-bit ms][4-bit ver=7][12-bit rand_a][2-bit var=0b10][62-bit rand_b]
 */
export function uuidv7(): string {
  const ms = BigInt(Date.now());
  const rand = randomBytes(10);

  // rand_a: 12 bits (upper nibble of byte 0 is masked to 0 so we can OR ver=7)
  const randA =
    (BigInt(rand[0] ?? 0) & 0x0fn) << 8n | BigInt(rand[1] ?? 0);

  // rand_b: 62 bits across bytes 2–9 (top 2 bits masked for variant 0b10)
  const b2 = (BigInt(rand[2] ?? 0) & 0x3fn) | 0x80n; // variant bits
  const b3 = BigInt(rand[3] ?? 0);
  const b4 = BigInt(rand[4] ?? 0);
  const b5 = BigInt(rand[5] ?? 0);
  const b6 = BigInt(rand[6] ?? 0);
  const b7 = BigInt(rand[7] ?? 0);
  const b8 = BigInt(rand[8] ?? 0);
  const b9 = BigInt(rand[9] ?? 0);

  const hi = (ms << 16n) | (7n << 12n) | randA;
  const lo = (b2 << 56n) | (b3 << 48n) | (b4 << 40n) | (b5 << 32n) |
             (b6 << 24n) | (b7 << 16n) | (b8 << 8n) | b9;

  const hex = hi.toString(16).padStart(16, "0") + lo.toString(16).padStart(16, "0");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
