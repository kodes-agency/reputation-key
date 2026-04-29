// Clock port — injectable time source for testable time-dependent code.
// Infrastructure provides the real implementation; tests provide a fixed clock.

// fallow-ignore-next-line unused-type
export type Clock = Readonly<{
  now: () => Date
}>

/** Real clock using system time. */
const systemClock: Clock = {
  now: () => new Date(),
}

/** Test clock with a fixed time. */
function fixedClock(fixedDate: Date): Clock {
  return {
    now: () => fixedDate,
  }
}

/** Test clock that advances by `incrementMs` on each call. */
function advancingClock(startDate: Date, incrementMs: number): Clock {
  let current = startDate.getTime()
  return {
    now: () => {
      const date = new Date(current)
      current += incrementMs
      return date
    },
  }
}
