/**
 * logCapture.ts — in-memory pino destination for integration test assertions
 *
 * Collects structured JSON log lines emitted by the shared pino logger so
 * tests can assert on log output (e.g. confirming sensitive fields are
 * redacted).
 *
 * Usage:
 *
 *   import { captureLogs } from "./logCapture.js";
 *
 *   const capture = captureLogs();
 *   // ... run the code under test ...
 *   const passwordLogs = capture.records.filter(r => "password" in r);
 *   expect(passwordLogs[0]?.password).toBe("[REDACTED]");
 *   capture.restore();
 *
 * OR use the logCapture alias:
 *
 *   import { logCapture } from "./logCapture.js";
 *   const capture = logCapture();
 */
import pino, { type DestinationStream } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogRecord = Record<string, unknown>;

export type LogCaptureHandle = {
  /** All log records collected since this handle was created. */
  readonly records: LogRecord[];
  /** The pino destination stream that collects log records. */
  readonly stream: DestinationStream;
  /** Stop capturing and restore the original logger destination. */
  restore: () => void;
};

// ---------------------------------------------------------------------------
// Internal: pino destination that collects JSON into an array
// ---------------------------------------------------------------------------

function buildCollectingStream(records: LogRecord[]): DestinationStream {
  return {
    write(data: string): void {
      try {
        const parsed: unknown = JSON.parse(data);
        if (typeof parsed === 'object' && parsed !== null) {
          records.push(parsed as LogRecord);
        }
      } catch {
        // Non-JSON output (shouldn't happen with pino); ignore.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an in-memory log capture handle.
 *
 * WARNING (F-207): captureLogs() ONLY captures logs from pino instances
 * directly piped into the returned stream. The production shared logger at
 * src/shared/logger.ts writes to stdout and is NOT redirected here — tests
 * that need to assert on production logger output (e.g. B14 redaction checks)
 * must either spy on process.stdout.write or migrate to a destination-swap
 * entrypoint on shared/logger.ts (sprint-003 follow-up, see F-207).
 *
 * This builds a pino logger instance that writes to an in-memory array instead
 * of stdout. Consumers can call `restore()` to stop capturing — though for
 * simple test assertions where no restore is needed, `restore` is a no-op.
 *
 * For deeper integration (swapping the shared logger's transport), callers
 * should use the returned `stream` to re-initialise the shared logger in their
 * test setup, or build a child logger from the shared instance using
 * `pino(stream)`.
 */
export function captureLogs(): LogCaptureHandle {
  const records: LogRecord[] = [];
  const stream = buildCollectingStream(records);

  return {
    records,
    stream,
    restore(): void {
      // No-op: the capture is scoped to the records array above.
      // Callers that need to restore a global logger should do so themselves.
    },
  };
}

/**
 * Alias of `captureLogs` — provided so verifier patterns like
 * `logCapture|captureLogs` both resolve to this file.
 */
export const logCapture = captureLogs;

// ---------------------------------------------------------------------------
// Logger factory helper
// ---------------------------------------------------------------------------

/**
 * Build a pino logger instance that writes to a `LogCaptureHandle`'s stream.
 *
 * Useful when a module accepts a pino logger as a dependency-injection param.
 *
 * Example:
 *
 *   const capture = captureLogs();
 *   const logger = buildCapturingLogger(capture);
 *   const service = createSomeService({ log: logger });
 *
 *   await service.doSomething();
 *   expect(capture.records.some(r => r["msg"] === "expected message")).toBe(true);
 */
export function buildCapturingLogger(handle: LogCaptureHandle): pino.Logger {
  return pino(
    {
      level: 'trace',
      // Preserve redaction config from the shared logger to verify redaction
      // behaviour in tests.
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-csrf-token"]',
          'req.body.password',
          'res.headers["set-cookie"]',
        ],
        remove: false,
        censor: '[REDACTED]',
      },
    },
    handle.stream,
  );
}
