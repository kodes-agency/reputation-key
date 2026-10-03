/**
 * The one place the interface turns a date or a number into text.
 *
 * Every shape pins three things, because each was once left to the runtime and
 * each showed up as a bug or as drift between pages:
 *
 * - the locale is `en-US`, so "Sep 12, 2026" is not "12 Sep 2026" on the next
 *   page and a count never groups with a different separator for the server and
 *   the browser (React #418, a hydration mismatch);
 * - the zone is UTC unless a caller names one: a calendar date that is stored
 *   as a day must not move to the neighbouring day for a viewer in another
 *   zone. A property's own day passes its IANA zone. `'viewer'` is the one
 *   explicit opt-in to the reader's clock, for a live status line;
 * - an instant that is not one (null, an unparsable string, an Invalid Date,
 *   which is what a null timestamp becomes after a server-function round trip)
 *   answers `null` instead of throwing, because `Intl` throws a RangeError and
 *   one bad row must not take its page down.
 *
 * Formatters are built once per shape and zone: `new Intl.DateTimeFormat` costs
 * about 26 µs on V8, and the Inbox rail formats a date on every row.
 *
 * `format-date-time.ts` is the sibling for text that honours a person's own
 * locale and zone preference (notifications); it takes both as arguments.
 */

export type InstantInput = Date | string | number

/** An IANA zone name, or `'viewer'` for the runtime's own zone. */
export type DisplayZone = string

const DEFAULT_ZONE = 'UTC'
const VIEWER_ZONE = 'viewer'
const LOCALE = 'en-US'

/** The real instant a value names, or `null` when it names none. */
export function toInstant(value: InstantInput | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

const DATE_SHAPES = {
  date: { dateStyle: 'medium' },
  monthDay: { month: 'short', day: 'numeric' },
  monthName: { month: 'long' },
  monthYear: { month: 'long', year: 'numeric' },
  longDate: { dateStyle: 'long' },
  time: { hour: 'numeric', minute: '2-digit' },
  clock: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  dayKey: { year: 'numeric', month: '2-digit', day: '2-digit' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>

type DateShape = keyof typeof DATE_SHAPES

const dateFormatters = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(shape: DateShape, zone: DisplayZone): Intl.DateTimeFormat {
  const key = `${shape}|${zone}`
  const cached = dateFormatters.get(key)
  if (cached) return cached
  const created = new Intl.DateTimeFormat(shape === 'dayKey' ? 'en-CA' : LOCALE, {
    ...DATE_SHAPES[shape],
    ...(zone === VIEWER_ZONE ? {} : { timeZone: zone }),
  })
  dateFormatters.set(key, created)
  return created
}

function formatShape(
  shape: DateShape,
  value: InstantInput | null | undefined,
  zone: DisplayZone,
): string | null {
  const instant = toInstant(value)
  if (instant === null) return null
  // Newer ICU builds put U+202F before AM/PM and older ones a plain space; the
  // server and the browser must print the same bytes.
  return dateFormatter(shape, zone).format(instant).replaceAll(' ', ' ')
}

/** "Sep 12, 2026" */
export function formatDate(
  value: InstantInput | null | undefined,
  zone: DisplayZone = DEFAULT_ZONE,
): string | null {
  return formatShape('date', value, zone)
}

/** "Sep 12" */
export function formatMonthDay(
  value: InstantInput | null | undefined,
  zone: DisplayZone = DEFAULT_ZONE,
): string | null {
  return formatShape('monthDay', value, zone)
}

/** "September" */
export function formatMonthName(
  value: InstantInput | null | undefined,
  zone: DisplayZone = DEFAULT_ZONE,
): string | null {
  return formatShape('monthName', value, zone)
}

/** "September 2026" */
export function formatMonthYear(
  value: InstantInput | null | undefined,
  zone: DisplayZone = DEFAULT_ZONE,
): string | null {
  return formatShape('monthYear', value, zone)
}

/**
 * A stored calendar day (`YYYY-MM-DD`, a property-local date) as that day. It is
 * read as midnight UTC and printed in UTC, so no reader's zone can move it.
 */
export function formatLocalDate(
  localDate: string,
  options: Readonly<{ year?: boolean }> = {},
): string | null {
  const instant = toInstant(`${localDate}T00:00:00.000Z`)
  return options.year === false ? formatMonthDay(instant) : formatDate(instant)
}

/** "September 12, 2026" */
export function formatLongDate(
  value: InstantInput | null | undefined,
  zone: DisplayZone = DEFAULT_ZONE,
): string | null {
  return formatShape('longDate', value, zone)
}

/** "3:45 PM" */
export function formatTime(
  value: InstantInput | null | undefined,
  zone: DisplayZone = DEFAULT_ZONE,
): string | null {
  return formatShape('time', value, zone)
}

/**
 * "2026-09-12": the calendar day an instant falls on in a zone, for comparing
 * days ("today", "yesterday") rather than for showing one. The sortable
 * year-month-day order is why this reads `en-CA`.
 */
export function formatDayKey(
  value: InstantInput | null | undefined,
  zone: DisplayZone = DEFAULT_ZONE,
): string | null {
  return formatShape('dayKey', value, zone)
}

/** "3:45:10 PM" */
export function formatClock(
  value: InstantInput | null | undefined,
  zone: DisplayZone = DEFAULT_ZONE,
): string | null {
  return formatShape('clock', value, zone)
}

/**
 * "Sep 12, 2026, 3:45 PM". The date and the time are formatted apart and joined
 * here: engines glue a single date-plus-time format differently (WebKit prints
 * "Sep 12, 2026 at 3:45 PM"), which is the hydration mismatch the glue avoids.
 */
export function formatTimestamp(
  value: InstantInput | null | undefined,
  zone: DisplayZone = DEFAULT_ZONE,
): string | null {
  const date = formatShape('date', value, zone)
  const time = formatShape('time', value, zone)
  return date === null || time === null ? null : `${date}, ${time}`
}

export type NumberStyle = Readonly<{
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  style?: 'decimal' | 'currency'
  currency?: string
}>

const numberFormatters = new Map<string, Intl.NumberFormat>()

/** "1,234,567": grouped with the same separator for every viewer. */
export function formatNumber(value: number, options: NumberStyle = {}): string {
  const key = [
    options.style ?? '',
    options.currency ?? '',
    options.minimumFractionDigits ?? '',
    options.maximumFractionDigits ?? '',
  ].join('|')
  let formatter = numberFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, options)
    numberFormatters.set(key, formatter)
  }
  return formatter.format(value)
}
