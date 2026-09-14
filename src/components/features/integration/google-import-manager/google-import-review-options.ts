import { timezonesForCountry } from '#/shared/domain/country-timezones'
import { VALID_TIMEZONES } from '#/shared/domain/timezones'
import { IMPORT_COUNTRY_CODES } from './google-import-review-model'

const regionDisplayNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null

export function importCountryLabel(code: string): string {
  const normalized = code.trim().toUpperCase()
  if (normalized.length !== 2) return normalized
  try {
    return regionDisplayNames?.of(normalized) ?? normalized
  } catch {
    return normalized
  }
}

export const IMPORT_COUNTRY_OPTIONS = IMPORT_COUNTRY_CODES.map((code) => ({
  code,
  label: importCountryLabel(code),
}))

export const IMPORT_TIMEZONE_OPTIONS = VALID_TIMEZONES

export type ImportTimezoneGroups = Readonly<{
  /** Zones inside the row's country, offered first. */
  inCountry: readonly string[]
  /** Every other valid zone, without repeating the in-country ones. */
  others: readonly string[]
}>

export function importTimezoneGroups(countryCode: string): ImportTimezoneGroups {
  const inCountry = timezonesForCountry(countryCode)
  if (inCountry.length === 0) return { inCountry, others: IMPORT_TIMEZONE_OPTIONS }
  const suggested = new Set(inCountry)
  return {
    inCountry,
    others: IMPORT_TIMEZONE_OPTIONS.filter((timezone) => !suggested.has(timezone)),
  }
}
