// ---------------------------------------------------------------------------
// Clock abstraction — allows service-layer code to accept a DI-injectable
// Clock so tests can substitute a fake without monkey-patching Date.
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export const defaultClock: Clock = {
  now: () => new Date(),
};
