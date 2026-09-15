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
