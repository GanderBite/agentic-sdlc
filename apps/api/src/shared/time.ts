/**
 * Returns the current wall-clock time as a Date.
 * Exported as a function (not a constant) so fake-timer libraries
 * (e.g. Vitest's `vi.useFakeTimers`) and test stubs can replace it
 * without patching the `Date` global directly.
 */
export const now = (): Date => new Date();
