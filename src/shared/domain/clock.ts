// Clock port — injectable time source for testable time-dependent code.
// Infrastructure provides the real implementation; tests provide a fixed clock.

export type Clock = Readonly<{
  now: () => Date
}>

/** Real clock using system time. */
export const systemClock: Clock = {
  now: () => new Date(),
}

/** Test clock with a fixed time. */
export function fixedClock(fixedDate: Date): Clock {
  return {
    now: () => fixedDate,
  }
}

/** Test clock that advances by `incrementMs` on each call. */
export function advancingClock(startDate: Date, incrementMs: number): Clock {
  let current = startDate.getTime()
  return {
    now: () => {
      const date = new Date(current)
      current += incrementMs
      return date
    },
  }
}
