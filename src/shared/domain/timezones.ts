// Shared timezone list — used by both domain validation (rules.ts)
// and UI components (TimezoneSelect). Lives in shared/domain/ so
// components can import it without violating dependency rules
// (components can only import from shared/ and application/dto/).

/**
 * Sensible subset of IANA timezones.
 * Not the full list — that's 400+. These cover the main regions.
 * Can be expanded as needed.
 */
export const VALID_TIMEZONES: ReadonlyArray<string> = [
  // Americas
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Lima',
  // Europe
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Vienna',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Helsinki',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Istanbul',
  'Europe/Moscow',
  // Asia-Pacific
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Taipei',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'Pacific/Auckland',
  // Africa & Middle East
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Asia/Riyadh',
  'Asia/Jerusalem',
  // UTC
  'UTC',
]
