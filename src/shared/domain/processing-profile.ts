// ProcessingProfile — property-level routing for review processing (PRE17B).
//
// Every property owns one processing profile that determines its country,
// IANA timezone, and processing region. The region is a provider-neutral
// application cell (us, europe, global) — not an Azure/AWS region name.
//
// Region routing flows from the property, never from user IP, org HQ,
// UI language, or worker location. No processing path silently falls back
// to a different cell.
//
// Based on: PRE17B plan §2.2 and Google policy response §4-5.

import type { PropertyId } from './ids'

/** Provider-neutral processing region. */
export type ProcessingRegion = 'us' | 'europe' | 'global'

/** How the processing region was determined. */
export type RegionSource =
  | 'country_default'
  | 'organization_override'
  | 'contract_override'

/** How the country code was determined. */
export type CountrySource =
  | 'google_address'
  | 'manual'
  | 'organization_default'
  | 'admin_correction'

/** How the timezone was determined. */
export type TimezoneSource =
  | 'google_time_zone_api'
  | 'manual'
  | 'organization_default'
  | 'legacy'

export type ProcessingProfile = Readonly<{
  propertyId: PropertyId
  /** Uppercase CLDR/ISO 3166-1 alpha-2 country code (e.g., 'US', 'GB', 'DE'). */
  countryCode: string
  countrySource: CountrySource
  /** Valid IANA timezone identifier (e.g., 'America/New_York'). */
  timeZone: string
  timezoneSource: TimezoneSource
  timezoneResolvedAt: Date
  processingRegion: ProcessingRegion | 'unresolved'
  processingRegionSource: RegionSource
  routingPolicyVersion: number
  processingRegionResolvedAt: Date | null
}>

export type ProcessingAvailability =
  | { available: true; profile: ProcessingProfile }
  | {
      available: false
      reason: 'country_unresolved' | 'timezone_unresolved' | 'region_unsupported'
    }

/**
 * Resolve a processing region from a country code.
 *
 * The initial Europe set must be explicitly reviewed and should cover the
 * EEA plus any separately approved UK/Swiss routing policy. It must not
 * be inferred from a string prefix.
 */
const EUROPEAN_COUNTRIES: ReadonlySet<string> = new Set([
  // EEA member states
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IS',
  'IE',
  'IT',
  'LV',
  'LI',
  'LT',
  'LU',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  // UK (separately approved)
  'GB',
  // Switzerland (separately approved)
  'CH',
])

const US_TERRITORY_CODES: ReadonlySet<string> = new Set([
  'US',
  'PR',
  'GU',
  'VI',
  'MP',
  'AS',
])

export function resolveRegion(countryCode: string): ProcessingRegion | 'unresolved' {
  const code = countryCode.toUpperCase()
  if (US_TERRITORY_CODES.has(code)) return 'us'
  if (EUROPEAN_COUNTRIES_CODES.has(code)) return 'europe'
  return 'global'
}

const EUROPEAN_COUNTRIES_CODES = EUROPEAN_COUNTRIES

/**
 * Check whether a processing profile is available for AI operations.
 *
 * Region-unavailable disables only future AI operations, not review
 * ingestion, inbox, manual replies, or dashboards.
 */
export function checkProcessingAvailability(
  profile: ProcessingProfile,
): ProcessingAvailability {
  if (!profile.countryCode) {
    return { available: false, reason: 'country_unresolved' }
  }
  if (!profile.timeZone || profile.timeZone === 'UTC') {
    return { available: false, reason: 'timezone_unresolved' }
  }
  if (profile.processingRegion === 'unresolved') {
    return { available: false, reason: 'region_unsupported' }
  }
  return { available: true, profile }
}
