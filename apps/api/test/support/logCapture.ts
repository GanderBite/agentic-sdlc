// logCapture.ts — pino destination that records emitted lines for assertions.
// Usage: pass `destination` to pino({ }, destination) and inspect `lines` after the call.

export interface LogCapture {
  destination: { write(s: string): void };
  lines: string[];
  notContainsAny(needles: readonly string[]): void;
}

export function createLogCapture(): LogCapture {
  const lines: string[] = [];

  const destination = {
    write(s: string): void {
      // pino emits NDJSON; store each raw line for later inspection.
      lines.push(s.trimEnd());
    },
  };

  function notContainsAny(needles: readonly string[]): void {
    for (const line of lines) {
      for (const needle of needles) {
        if (String(line).includes(needle)) {
          throw new Error(`Log line contains secret needle "${needle}":\n  ${line}`);
        }
      }
    }
  }

  return { destination, lines, notContainsAny };
}
