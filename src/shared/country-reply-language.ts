// Country → suggested reply language for a new Property.
//
// Decision 2 (docs/plan/property-setup-exploration.md §6): the setup
// questionnaire prefills a Property's reply language from its country when the
// country's language is one of the 24 reply languages, and English otherwise.
// It is a suggestion the merchant confirms, so the table is deliberately
// conservative: a country is listed only when one catalogue language is the
// obvious default for guest replies there. Multilingual countries take the
// language most of their hospitality businesses answer in; anything unlisted
// falls back to English.

import {
  REPLY_TEMPLATE_LANGUAGE_GROUPS,
  type ReplyTemplateLanguageGroup,
} from './reply-language-catalogue'

export const FALLBACK_REPLY_LANGUAGE: ReplyTemplateLanguageGroup = 'en-Latn'

const LANGUAGE_COUNTRIES: Readonly<
  Partial<Record<ReplyTemplateLanguageGroup, readonly string[]>>
> = Object.freeze({
  'ar-Arab': [
    'AE',
    'BH',
    'DZ',
    'EG',
    'IQ',
    'JO',
    'KW',
    'LB',
    'LY',
    'MA',
    'OM',
    'PS',
    'QA',
    'SA',
    'SY',
    'TN',
    'YE',
  ],
  'bg-Cyrl': ['BG'],
  'bn-Beng': ['BD'],
  'de-Latn': ['AT', 'CH', 'DE', 'LI'],
  'es-Latn': [
    'AR',
    'BO',
    'CL',
    'CO',
    'CR',
    'CU',
    'DO',
    'EC',
    'ES',
    'GT',
    'HN',
    'MX',
    'NI',
    'PA',
    'PE',
    'PY',
    'SV',
    'UY',
    'VE',
  ],
  'fr-Latn': ['FR', 'LU', 'MC'],
  'he-Hebr': ['IL'],
  'hi-Deva': ['IN'],
  'id-Latn': ['ID'],
  'it-Latn': ['IT', 'SM', 'VA'],
  'ja-Jpan': ['JP'],
  'ko-Kore': ['KR'],
  'nl-Latn': ['BE', 'NL', 'SR'],
  'pl-Latn': ['PL'],
  'pt-Latn': ['AO', 'BR', 'CV', 'MZ', 'PT'],
  'ru-Cyrl': ['BY', 'RU'],
  'th-Thai': ['TH'],
  'tr-Latn': ['TR'],
  'uk-Cyrl': ['UA'],
  'vi-Latn': ['VN'],
  'zh-Hans': ['CN'],
  'zh-Hant': ['HK', 'MO', 'TW'],
})

const LANGUAGE_BY_COUNTRY: ReadonlyMap<string, ReplyTemplateLanguageGroup> = new Map(
  REPLY_TEMPLATE_LANGUAGE_GROUPS.flatMap((language) =>
    (LANGUAGE_COUNTRIES[language] ?? []).map((country) => [country, language] as const),
  ),
)

/** The reply language a Property in this ISO 3166-1 alpha-2 country starts with. */
export function suggestedReplyLanguageForCountry(
  countryCode: string | null | undefined,
): ReplyTemplateLanguageGroup {
  if (!countryCode) return FALLBACK_REPLY_LANGUAGE
  return (
    LANGUAGE_BY_COUNTRY.get(countryCode.trim().toUpperCase()) ?? FALLBACK_REPLY_LANGUAGE
  )
}

/** Every country the table maps, for tests and documentation. */
export function mappedReplyLanguageCountries(): ReadonlyArray<string> {
  return [...LANGUAGE_BY_COUNTRY.keys()]
}
