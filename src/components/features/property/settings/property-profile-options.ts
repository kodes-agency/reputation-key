import { ISO_3166_ALPHA2_CODES } from '#/shared/domain/iso-country-codes'
import { VALID_TIMEZONES } from '#/shared/domain/timezones'

const regionNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null

export const PROPERTY_COUNTRY_OPTIONS = Object.freeze(
  ISO_3166_ALPHA2_CODES.map((code) => ({
    code,
    label: regionNames?.of(code) ?? code,
  })).sort((left, right) => left.label.localeCompare(right.label, 'en')),
)

export const PROPERTY_TIMEZONE_OPTIONS = VALID_TIMEZONES
