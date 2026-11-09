import { countryLabel } from '#/components/features/shared/country-label'
import { IMPORT_COUNTRY_CODES } from './google-import-review-model'

export const IMPORT_COUNTRY_OPTIONS = IMPORT_COUNTRY_CODES.map((code) => ({
  code,
  label: countryLabel(code),
}))
