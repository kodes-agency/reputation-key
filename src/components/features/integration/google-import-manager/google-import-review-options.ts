import { VALID_TIMEZONES } from '#/shared/domain/timezones'
import { IMPORT_COUNTRY_CODES } from './google-import-review-model'

const regionDisplayNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null

export const IMPORT_COUNTRY_OPTIONS = IMPORT_COUNTRY_CODES.map((code) => ({
  code,
  label: regionDisplayNames?.of(code) ?? code,
}))

export const IMPORT_TIMEZONE_OPTIONS = VALID_TIMEZONES
