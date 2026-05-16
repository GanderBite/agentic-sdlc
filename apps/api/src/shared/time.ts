// ---------------------------------------------------------------------------
// Clock — injectable time abstraction for DI in tests
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export const defaultClock: Clock = {
  now(): Date {
    return new Date();
  },
};
