// The print kit's vocabulary: its papers, what a print says, and the choice a
// download asks for. How the sheets are laid out is `portal-print-sheets.ts`;
// what each piece is called and how to print it is `portal-print-how-to.ts`.
//
// Pure and shared, because the Share tab's preview (a React tree) and the PDF
// the server makes (round 4, slice 45) must agree on every word and every
// measure: neither asks the other, both read these files.
//
// The copy is industry-neutral on purpose ("visit", never "stay"): a barber, a
// restaurant and a hotel pool all print the same card. es, it, fr and de are
// drafted without a native-speaker check, as the closed beta allows (owner
// decision 5, 2026-09-30).

import type { GuestLocale } from './guest-locale'

/**
 * The two paper families, Letter first: most customers are in the US. Letter
 * makes 4 × 6 in cards and 8.5 × 5.5 in tent faces; A4 makes A6 cards and A5
 * faces.
 */
export const PRINT_KIT_PAPERS = Object.freeze(['letter', 'a4'] as const)
export type PrintKitPaper = (typeof PRINT_KIT_PAPERS)[number]

/**
 * The countries that print on US Letter: the territories CLDR's supplementalData
 * lists with a US-Letter paper size, as ISO 3166-1 alpha-2 codes. Every other
 * country prints on A4. A constant, not a runtime lookup: the list changes
 * about as often as the countries do.
 */
export const PRINT_KIT_LETTER_COUNTRIES = Object.freeze([
  'BZ',
  'CA',
  'CL',
  'CO',
  'CR',
  'GT',
  'MX',
  'NI',
  'PA',
  'PH',
  'PR',
  'SV',
  'US',
  'VE',
] as const)

const LETTER_COUNTRIES: ReadonlySet<string> = new Set(PRINT_KIT_LETTER_COUNTRIES)

/**
 * The paper a property prints on unless the manager chooses otherwise: Letter
 * for a Letter country and whenever the country is unknown, A4 for the rest.
 * The property's country says where the piece will stand; the browser's locale
 * says only where the manager sits.
 */
export function defaultPrintKitPaper(countryCode: string | null): PrintKitPaper {
  const code = countryCode?.trim().toUpperCase() ?? ''
  return code === '' || LETTER_COUNTRIES.has(code) ? 'letter' : 'a4'
}

/** One or two languages on a print: more would crowd an A6 face. */
export const PRINT_KIT_MAX_LANGUAGES = 2

/** The light margin round a printed code, in modules: what a phone needs to find it. */
export const PRINT_KIT_QR_QUIET_ZONE_MODULES = 4

export type PrintKitCopy = Readonly<{ headline: string; subline: string }>

/**
 * Whether `languages` is one or two distinct languages the portal offers. The
 * order is the manager's (the larger language first), so a pair is accepted in
 * either order.
 */
export function isPrintKitLanguageChoice(
  offered: readonly GuestLocale[],
  languages: readonly GuestLocale[],
): boolean {
  if (languages.length < 1 || languages.length > PRINT_KIT_MAX_LANGUAGES) return false
  if (new Set(languages).size !== languages.length) return false
  return languages.every((language) => offered.includes(language))
}

export type PrintTextBlock = Readonly<{
  locale: GuestLocale
  /** The portal's title in this language, set small above the call to action. */
  kicker: string
  headline: string
  subline: string
}>
