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
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
/**
 * Create an in-memory log capture harness.
 *
 * Returns a LogCapture whose `destination` can be passed to pino as the
 * writable destination, and whose `notContainsAny` method provides the
 * log-scrub assertion used by security smoke tests.
 */
export function createLogCapture() {
    const recorded = [];
    const destination = {
        write(line) {
            recorded.push(line);
        },
    };
    const notContainsAny = (secrets) => {
        for (const line of recorded) {
            for (const secret of secrets) {
                if (line.includes(secret)) {
                    throw new Error(`Log-scrub assertion failed: log line contains secret "${secret}".\nLine: ${line.trim()}`);
                }
            }
        }
    };
    const clear = () => {
        recorded.splice(0, recorded.length);
    };
    return {
        destination,
        // Expose a readonly view so tests cannot accidentally mutate.
        get lines() {
            return recorded;
        },
        notContainsAny,
        clear,
    };
}
// ---------------------------------------------------------------------------
// Helper: build a pino logger that writes to a LogCapture
// ---------------------------------------------------------------------------
/**
 * Convenience factory: create a pino logger that records to the supplied
 * LogCapture destination and applies the production redact config.
 *
 * Tests that want to verify the production logger's redact rules should use
 * this helper rather than importing the production logger directly.
 */
export function createCapturedLogger(capture) {
    return pino({
        level: 'trace',
        redact: {
            paths: [
                'req.headers.cookie',
                'req.headers["x-csrf-token"]',
                'req.body.password',
                '*.password',
                '*.token',
                '*.refreshToken',
                '*.csrfToken',
                '*.jwt',
            ],
            censor: '[REDACTED]',
        },
    }, capture.destination);
}
//# sourceMappingURL=logCapture.js.map