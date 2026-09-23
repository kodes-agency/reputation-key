// Shared timezone list — used by both domain validation (rules.ts)
// and UI components (TimezoneSelect). Lives in shared/domain/ so
// components can import it without violating dependency rules
// (components can only import from shared/ and application/dto/).

const REGION_AREAS: ReadonlySet<string> = new Set([
  'Africa',
  'America',
  'Antarctica',
  'Arctic',
  'Asia',
  'Atlantic',
  'Australia',
  'Europe',
  'Indian',
  'Pacific',
])
const PLACE = /^[A-Z][\w+-]*$/

/**
 * A name inside one of IANA's geographic areas, each part capitalised as IANA
 * spells it. Outside them are fixed offsets (`Etc/GMT-3`), abbreviations
 * (`EST`) and old links (`US/Eastern`), which no picker should offer.
 */
function isRegionName(timezone: string): boolean {
  const [area = '', ...places] = timezone.split('/')
  return (
    REGION_AREAS.has(area) &&
    places.length > 0 &&
    places.every((place) => PLACE.test(place))
  )
}

// Safari's runtime also lists every `Etc/GMT±N` offset; Node's and Chrome's
// list none, so the server never accepted one.
const IANA_TIMEZONE_SET: ReadonlySet<string> = new Set([
  ...Intl.supportedValuesOf('timeZone').filter(isRegionName),
  'UTC',
])

/**
 * Canonical timezone catalogue shared by UI, request, domain, and persistence
 * validation. Keeping one runtime-derived set prevents a confirmed import from
 * passing the request boundary and failing later in the Property context.
 */
export const VALID_TIMEZONES: ReadonlyArray<string> = Object.freeze(
  [...IANA_TIMEZONE_SET].sort(),
)

export function isValidIanaTimezone(timezone: string): boolean {
  return IANA_TIMEZONE_SET.has(timezone)
}

/**
 * UTC or a region zone this runtime can resolve, whether or not it is spelled
 * the way this runtime lists it. Runtimes disagree: Safari and Firefox list
 * `Asia/Kolkata` and `Europe/Kyiv`, while Node and Chrome list `Asia/Calcutta`
 * and `Europe/Kiev` and still resolve the newer names. For a value picked in
 * one runtime and checked again in another, such as a browser pick the server
 * validates.
 */
export function isRegionTimezone(timezone: string): boolean {
  if (IANA_TIMEZONE_SET.has(timezone)) return true
  if (!isRegionName(timezone)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}
