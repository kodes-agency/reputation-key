// The print kit's vocabulary: its styles, papers and pieces, what a print says,
// and the choice a download asks for. How the sheets are laid out is
// `portal-print-kit-sheets.ts`; what each piece is called and how to print it is
// `portal-print-kit-pieces.ts`.
//
// Pure and shared, because the Share tab's preview (a React tree) and the PDF
// the server makes (round 4, slice 45) must agree on every word and every
// measure: neither asks the other, both read these files.
//
// The copy is industry-neutral on purpose ("visit", never "stay"): a barber, a
// restaurant and a hotel pool all print the same card. es, it, fr and de are
// drafted without a native-speaker check, as the closed beta allows (owner
// decision 5, 2026-09-30).

import { fileNameSlug } from './file-name-slug'
import type { GuestLocale } from './guest-locale'

export const PRINT_KIT_PIECES = Object.freeze(['table_tent', 'counter_card'] as const)
export type PrintKitPiece = (typeof PRINT_KIT_PIECES)[number]

/** The short name of each piece, in captions and in file names. */
export const PRINT_KIT_PIECE_NOUNS: Readonly<Record<PrintKitPiece, string>> =
  Object.freeze({ table_tent: 'table tent', counter_card: 'counter card' })
/**
 * The two looks a print can take. Paper is ink on the customer's own paper, for
 * any printer; Immersive is the guest page's dark field, for a print shop.
 */
export const PRINT_KIT_STYLES = Object.freeze(['paper', 'immersive'] as const)
export type PrintKitStyle = (typeof PRINT_KIT_STYLES)[number]

/**
 * Who prints an Immersive card: a print shop, from one card per page with bleed
 * and crop marks, or the customer's own printer, from an office sheet whose
 * cards bleed for a cutter (2 Large or 4 Table cards to a sheet). Paper is
 * always printed on an office printer, and the old tent has one output in each
 * style.
 */
export const PRINT_KIT_OUTPUTS = Object.freeze(['print_shop', 'office'] as const)
export type PrintKitOutput = (typeof PRINT_KIT_OUTPUTS)[number]

/** The output a style prints to unless the manager chooses otherwise: Immersive to a print shop, as it always has. */
export const defaultPrintKitOutput = (style: PrintKitStyle): PrintKitOutput =>
  style === 'immersive' ? 'print_shop' : 'office'

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

/**
 * The sizes a piece comes in (round 3). Large is the 4 × 6 in or A6 card the kit
 * has always made; Table (3.5 × 5 in or 90 × 130 mm) is for tables, nightstands
 * and bars; Mini (2 × 3.5 in or 55 × 85 mm) is for key-card sleeves. The small
 * table tent is the `table_tent` piece at size Table, and today's Letter-half
 * tent is the same piece at size Large. The trims, the code tile and every
 * measure per size are in `portal-print-kit-sizes.ts` and `-code-tile.ts`.
 */
export const PRINT_KIT_SIZES = Object.freeze(['large', 'table', 'mini'] as const)
export type PrintKitSize = (typeof PRINT_KIT_SIZES)[number]
/**
 * The print a download asks for: its look and the paper it prints on, and,
 * from round 3, its size and output (Large, and the style's own output, unless
 * named).
 */
export type PrintKitFormat = Readonly<{
  style: PrintKitStyle
  paper: PrintKitPaper
  size?: PrintKitSize
  output?: PrintKitOutput
}>

/** A piece's name at a size: the smaller cards are named for their size, the Large card and the old tent as before. */
export function printKitPieceNoun(piece: PrintKitPiece, size: PrintKitSize): string {
  if (piece !== 'counter_card' || size === 'large') return PRINT_KIT_PIECE_NOUNS[piece]
  return `${size} card`
}

/**
 * How many pieces an office sheet holds, for its file name: Table 4, Mini 10,
 * the Immersive Large office sheet 2 and the small tent 2; null for a print-shop
 * file and for the Large Paper sheets and the Letter-half tent, whose names stay
 * as they shipped.
 */
export function printKitCardsPerSheet(
  piece: PrintKitPiece,
  format: PrintKitFormat,
): number | null {
  const size = format.size ?? 'large'
  const output = format.output ?? defaultPrintKitOutput(format.style)
  if (output !== 'office') return null
  if (piece === 'table_tent') return size === 'table' ? 2 : null
  if (size === 'table') return 4
  if (size === 'mini') return 10
  return format.style === 'immersive' ? 2 : null
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

/**
 * `pool-terrace-table-tent-en-bg.pdf`: the portal's name made safe for a file
 * system, the piece and the languages on it, in the order they print. Two
 * downloads of one portal that differ in language (English and Bulgarian, or
 * English alone) must not share a name: the browser would call the second one
 * "(1)" and the print shop would have to guess which is which.
 *
 * A print ends with its paper, `…-en-es-letter.pdf`, and Immersive names itself
 * before it, `…-en-es-immersive-letter.pdf` (spec 7.2): Paper is the default
 * style, so it goes unnamed. A smaller card is named for its size, and an office
 * sheet says how many cards it holds before the paper (round-3 S7, round-2 R6):
 * `…-table-card-en-immersive-4up-letter.pdf`.
 */
export function printKitFileName(
  portalName: string,
  piece: PrintKitPiece,
  languages: readonly GuestLocale[],
  format: PrintKitFormat,
): string {
  const noun = printKitPieceNoun(piece, format.size ?? 'large').replace(/\s+/gu, '-')
  const count = printKitCardsPerSheet(piece, format)
  const look = [
    ...(format.style === 'immersive' ? ['immersive'] : []),
    ...(count === null ? [] : [`${count}up`]),
    format.paper,
  ]
  return (
    [fileNameSlug(portalName) || 'portal', noun, ...languages, ...look].join('-') + '.pdf'
  )
}
