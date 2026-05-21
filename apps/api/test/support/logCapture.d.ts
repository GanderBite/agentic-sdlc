/**
 * Pino log-capture helper for integration and security smoke tests.
 *
 * Creates a pino-compatible writable destination that records every log line
 * as a raw JSON string.  Tests can then assert that secrets and sensitive
 * values are absent from all emitted log lines.
 *
 * Usage:
 *
 *   import { createLogCapture } from '../support/logCapture.js';
 *
 *   const capture = createLogCapture();
 *
 *   // Build a logger that writes to the capture destination:
 *   const log = pino(capture.destination);
 *
 *   log.info({ password: 'secret' }, 'login attempt');
 *
 *   // Assert no secrets leaked:
 *   capture.notContainsAny(['secret', 'supersecret']);
 *
 *   // Reset between tests:
 *   capture.clear();
 */
import pino from 'pino';
/** A pino writable destination that records lines in memory. */
export interface LogDestination {
    /** Called by pino for every log line (raw JSON string including newline). */
    write(line: string): void;
}
export interface LogCapture {
    /** The pino destination to pass to pino(destination) or pino({ ... }, destination). */
    readonly destination: LogDestination;
    /**
     * All log lines recorded since the last clear(), each as a raw JSON string.
     * Tests that need parsed objects can do JSON.parse on individual lines.
     */
    readonly lines: readonly string[];
    /**
     * Assert that none of the recorded log lines contain any of the supplied
     * secret substrings.  Throws if a match is found, printing the offending
     * line and the matched secret.
     */
    notContainsAny(secrets: readonly string[]): void;
    /** Clear all recorded lines. Call in beforeEach between tests. */
    clear(): void;
}
/**
 * Create an in-memory log capture harness.
 *
 * Returns a LogCapture whose `destination` can be passed to pino as the
 * writable destination, and whose `notContainsAny` method provides the
 * log-scrub assertion used by security smoke tests.
 */
export declare function createLogCapture(): LogCapture;
/**
 * Convenience factory: create a pino logger that records to the supplied
 * LogCapture destination and applies the production redact config.
 *
 * Tests that want to verify the production logger's redact rules should use
 * this helper rather than importing the production logger directly.
 */
export declare function createCapturedLogger(capture: LogCapture): pino.Logger;
//# sourceMappingURL=logCapture.d.ts.map