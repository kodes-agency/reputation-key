/**
 * Shared IANA-calendar primitives for Property-owned business time.
 *
 * Arithmetic operates on local wall-clock fields and resolves the result back
 * to an instant. A fixed millisecond subtraction is wrong across DST changes.
 */
export type PropertyWallClock = Readonly<{
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
}>

export function propertyWallClockAt(date: Date, timezone: string): PropertyWallClock {
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid calendar instant')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour') % 24,
    minute: value('minute'),
    second: value('second'),
    millisecond: value('fractionalSecond'),
  }
}

export function daysInGregorianMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function sameWallClock(left: PropertyWallClock, right: PropertyWallClock): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second &&
    left.millisecond === right.millisecond
  )
}

function exactInstantsForWallClock(target: PropertyWallClock, timezone: string): Date[] {
  const localEpoch = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
    target.millisecond,
  )
  const offsets = new Set<number>()
  for (const delta of [-36, 0, 36]) {
    const sample = new Date(localEpoch + delta * 3_600_000)
    const local = propertyWallClockAt(sample, timezone)
    offsets.add(
      Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
        local.millisecond,
      ) - sample.getTime(),
    )
  }

  return [...offsets]
    .map((offset) => new Date(localEpoch - offset))
    .filter((candidate) =>
      sameWallClock(propertyWallClockAt(candidate, timezone), target),
    )
    .sort((left, right) => left.getTime() - right.getTime())
}

export function propertyWallClockToInstant(
  target: PropertyWallClock,
  timezone: string,
): Date {
  const exact = exactInstantsForWallClock(target, timezone)
  if (exact[0]) return exact[0] // deterministic fold policy: earlier occurrence

  const localEpoch = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
    target.millisecond,
  )
  // Deterministic gap policy: advance to the first representable local minute.
  for (let minute = 1; minute <= 180; minute++) {
    const shifted = new Date(localEpoch + minute * 60_000)
    const candidate: PropertyWallClock = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
      millisecond: shifted.getUTCMilliseconds(),
    }
    const instants = exactInstantsForWallClock(candidate, timezone)
    if (instants[0]) return instants[0]
  }
  throw new RangeError(`Unable to resolve wall clock in timezone ${timezone}`)
}

export function shiftPropertyLocalDays(date: Date, days: number, timezone: string): Date {
  if (!Number.isInteger(days)) throw new RangeError('Calendar days must be an integer')
  const current = propertyWallClockAt(date, timezone)
  const shifted = new Date(
    Date.UTC(
      current.year,
      current.month - 1,
      current.day + days,
      current.hour,
      current.minute,
      current.second,
      current.millisecond,
    ),
  )
  return propertyWallClockToInstant(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
      millisecond: shifted.getUTCMilliseconds(),
    },
    timezone,
  )
}
