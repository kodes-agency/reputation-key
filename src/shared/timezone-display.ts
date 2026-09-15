// How a timezone reads to people. IANA ids are for machines: "America/New_York"
// shows an underscore and hides the one fact people choose by, the offset. The
// display splits the id into a city and a region and adds the current UTC
// offset, so a list reads "New York (UTC−4)" under "America".

/** A true minus sign, so an offset never reads as a hyphen. */
const MINUS = '\u2212'
const TWO_DIGITS = /^\d{2}$/

export type TimezoneDisplay = Readonly<{
  id: string
  /** "New York"; the id itself for a zone without a region, such as "UTC". */
  city: string
  /** "America", "America / Argentina"; null for a zone without a region. */
  region: string | null
  /** "UTC−4", "UTC+5:30", "UTC+0"; null when the runtime cannot resolve the zone. */
  offset: string | null
  /** "New York (UTC−4)". */
  label: string
}>

function humanize(segment: string): string {
  return segment.replaceAll('_', ' ')
}

/** The zone's offset from UTC at `at`, e.g. "UTC+3" or "UTC−3:30". */
export function timezoneUtcOffset(
  timezone: string,
  at: Date = new Date(),
): string | null {
  let name: string | undefined
  try {
    name = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value
  } catch {
    return null
  }
  // "GMT+03:00", "GMT-02:30", or a bare "GMT" at zero in some runtimes.
  if (name === 'GMT') return 'UTC+0'
  const sign = name?.[3]
  const hours = name?.slice(4, 6) ?? ''
  const minutes = name?.slice(7, 9) ?? ''
  if (
    name?.length !== 9 ||
    !name.startsWith('GMT') ||
    (sign !== '+' && sign !== '-') ||
    name[6] !== ':' ||
    !TWO_DIGITS.test(hours) ||
    !TWO_DIGITS.test(minutes)
  ) {
    return null
  }
  if (hours === '00' && minutes === '00') return 'UTC+0'
  const hourText = String(Number(hours))
  return `UTC${sign === '-' ? MINUS : '+'}${hourText}${minutes === '00' ? '' : `:${minutes}`}`
}

export function describeTimezone(
  timezone: string,
  at: Date = new Date(),
): TimezoneDisplay {
  const segments = timezone.split('/')
  const offset = timezoneUtcOffset(timezone, at)
  const city = humanize(segments.at(-1) ?? timezone)
  const region =
    segments.length > 1 ? segments.slice(0, -1).map(humanize).join(' / ') : null
  const withOffset =
    offset && !(region === null && city === 'UTC') ? `${city} (${offset})` : city
  return { id: timezone, city, region, offset, label: withOffset }
}

/**
 * Words a search should match besides the label: the raw id, and the offset as
 * people type it ("UTC-4", "GMT-4", "-4").
 */
export function timezoneSearchTerms(display: TimezoneDisplay): readonly string[] {
  const terms = [display.id, display.city]
  if (display.region) terms.push(display.region)
  if (display.offset) {
    const ascii = display.offset.replace(MINUS, '-')
    terms.push(ascii, ascii.replace('UTC', 'GMT'), ascii.replace('UTC', ''))
  }
  return terms
}
