// Shared timezone list — used by both domain validation (rules.ts)
// and UI components (TimezoneSelect). Lives in shared/domain/ so
// components can import it without violating dependency rules
// (components can only import from shared/ and application/dto/).

const IANA_TIMEZONE_SET: ReadonlySet<string> = new Set([
  ...Intl.supportedValuesOf('timeZone'),
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
