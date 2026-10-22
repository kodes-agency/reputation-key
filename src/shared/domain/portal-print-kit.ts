// The print kit's vocabulary: which pieces it has, what they say, and how a sheet
// is laid out.
//
// Pure and shared, because the Share tab's preview (a React tree) and the PDF
// the server makes (round 4, slice 45) must agree on every word and every
// measure: neither asks the other, both read this file.
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

export const PRINT_KIT_CALLS_TO_ACTION = Object.freeze(['rate', 'tell'] as const)
export type PrintKitCallToAction = (typeof PRINT_KIT_CALLS_TO_ACTION)[number]

/**
 * The two looks a print can take. Paper is ink on the customer's own paper, for
 * any printer; Immersive is the guest page's dark field, for a print shop.
 */
export const PRINT_KIT_STYLES = Object.freeze(['paper', 'immersive'] as const)
export type PrintKitStyle = (typeof PRINT_KIT_STYLES)[number]

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

/** The redesigned print a download asks for: its look and the paper it prints on. */
export type PrintKitFormat = Readonly<{ style: PrintKitStyle; paper: PrintKitPaper }>

/** One or two languages on a print: more would crowd an A6 face. */
export const PRINT_KIT_MAX_LANGUAGES = 2

/** The extra paper past the trim that a cutter may shave: 3 mm is the common ask. */
export const PRINT_KIT_BLEED_MM = 3

/** The light margin round a printed code, in modules: what a phone needs to find it. */
export const PRINT_KIT_QR_QUIET_ZONE_MODULES = 4

/** An A6 panel, in millimetres. */
export const A6_WIDTH_MM = 105
export const A6_HEIGHT_MM = 148

export type PrintKitPieceFacts = Readonly<{
  label: string
  /** What the manager is told about its size and shape. */
  sizeLabel: string
  /** The short name used in captions and file names. */
  noun: string
}>

export const PRINT_KIT_PIECE_FACTS: Readonly<Record<PrintKitPiece, PrintKitPieceFacts>> =
  Object.freeze({
    table_tent: { label: 'Table tent', sizeLabel: 'A6, folded', noun: 'table tent' },
    counter_card: { label: 'Counter card', sizeLabel: 'A6', noun: 'counter card' },
  })

export type PrintKitCopy = Readonly<{ headline: string; subline: string }>

export const PRINT_KIT_CALL_TO_ACTION_LABELS: Readonly<
  Record<PrintKitCallToAction, string>
> = Object.freeze({
  rate: 'Rate your visit — private, about 30 seconds',
  tell: 'How was your visit? Tell us privately',
})

/** What each call to action says on the print, per language. */
export const PRINT_KIT_COPY: Readonly<
  Record<GuestLocale, Readonly<Record<PrintKitCallToAction, PrintKitCopy>>>
> = Object.freeze({
  en: {
    rate: { headline: 'Rate your visit', subline: 'Private, about 30 seconds' },
    tell: { headline: 'How was your visit?', subline: 'Tell us privately' },
  },
  bg: {
    rate: {
      headline: 'Оценете посещението си',
      subline: 'Поверително, около 30 секунди',
    },
    tell: { headline: 'Как мина посещението ви?', subline: 'Кажете ни поверително' },
  },
  es: {
    rate: { headline: 'Valore su visita', subline: 'En privado, unos 30 segundos' },
    tell: { headline: '¿Qué tal su visita?', subline: 'Cuéntenoslo en privado' },
  },
  it: {
    rate: { headline: 'Valuti la sua visita', subline: 'In privato, circa 30 secondi' },
    tell: { headline: 'Com’è andata la sua visita?', subline: 'Ce lo dica in privato' },
  },
  fr: {
    rate: { headline: 'Évaluez votre visite', subline: 'En privé, environ 30 secondes' },
    tell: {
      headline: 'Comment s’est passée votre visite ?',
      subline: 'Dites-le-nous en privé',
    },
  },
  de: {
    rate: { headline: 'Bewerten Sie Ihren Besuch', subline: 'Privat, etwa 30 Sekunden' },
    tell: { headline: 'Wie war Ihr Besuch?', subline: 'Sagen Sie es uns privat' },
  },
})

/**
 * The cue in the bar under the code, per language: what the phone is for.
 * Drafts that no native speaker has checked yet, as the closed beta allows (the
 * es, it, fr and de copy above is the same). The French line is the longest.
 */
export const PRINT_KIT_SCAN_CUE: Readonly<Record<GuestLocale, string>> = Object.freeze({
  en: 'Scan with your camera',
  es: 'Escanee con la cámara',
  bg: 'Сканирайте с камерата',
  it: 'Inquadri con la fotocamera',
  fr: 'Scannez avec l’appareil photo',
  de: 'Mit der Kamera scannen',
})

export type PrintKitChoice = Readonly<{
  /** The look, and the paper family it prints on (Letter or A4). */
  style: PrintKitStyle
  paper: PrintKitPaper
  piece: PrintKitPiece
  /** One or two of the portal's languages; the first is the larger. */
  languages: readonly GuestLocale[]
  callToAction: PrintKitCallToAction
}>

/** What decides what a print says: the piece, its languages and its call to action. */
export type PrintKitWords = Pick<PrintKitChoice, 'piece' | 'languages' | 'callToAction'>

/**
 * The language selections a portal's languages offer: its primary with each
 * other language, then each language alone. The board's "English + Български"
 * is the first of these.
 */
export function printKitLanguageChoices(
  locales: readonly GuestLocale[],
): readonly (readonly GuestLocale[])[] {
  const [primary, ...others] = locales
  if (primary === undefined) return []
  return [
    ...others.map((other): readonly GuestLocale[] => [primary, other]),
    ...locales.map((locale): readonly GuestLocale[] => [locale]),
  ]
}

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

export type PrintFaceSide = 'front' | 'back'

export type PrintFace = Readonly<{
  side: PrintFaceSide
  /** The larger language first; one block, or two. */
  blocks: readonly PrintTextBlock[]
}>

/**
 * What each face of a piece says. With two languages the front leads with the
 * first and the back leads with the second, so a guest on either side meets
 * their own language first. A table tent always has two panels; a counter card
 * has a back only when there is a second language to put on it.
 */
export function printKitFaces(
  choice: PrintKitWords,
  titles: Readonly<Partial<Record<GuestLocale, string>>>,
  fallbackTitle: string,
): readonly PrintFace[] {
  const block = (locale: GuestLocale): PrintTextBlock => ({
    locale,
    kicker: titles[locale] ?? fallbackTitle,
    ...PRINT_KIT_COPY[locale][choice.callToAction],
  })
  const blocks = choice.languages.map(block)
  const front: PrintFace = { side: 'front', blocks }
  if (blocks.length === 2) {
    return [front, { side: 'back', blocks: [...blocks].reverse() }]
  }
  return choice.piece === 'table_tent' ? [front, { side: 'back', blocks }] : [front]
}

export type PrintSheetPanel = Readonly<{
  side: PrintFaceSide
  /** Where the panel starts down the sheet's trim. */
  topMm: number
  /** Printed upside down, so it reads upright after the fold. */
  rotated: boolean
}>

export type PrintSheet = Readonly<{
  trimWidthMm: number
  trimHeightMm: number
  panels: readonly PrintSheetPanel[]
  /** Where the sheet folds, down the trim; null for a flat card. */
  foldAtMm: number | null
}>

/**
 * The pages of the PDF. A table tent is one flat sheet of two A6 panels that
 * folds across the middle (the back panel upside down); a counter card is one
 * flat A6 page per face.
 */
export function printKitSheets(
  piece: PrintKitPiece,
  faceCount: number,
): readonly PrintSheet[] {
  if (piece === 'table_tent') {
    return [
      {
        trimWidthMm: A6_WIDTH_MM,
        trimHeightMm: A6_HEIGHT_MM * 2,
        panels: [
          { side: 'back', topMm: 0, rotated: true },
          { side: 'front', topMm: A6_HEIGHT_MM, rotated: false },
        ],
        foldAtMm: A6_HEIGHT_MM,
      },
    ]
  }
  const sides: readonly PrintFaceSide[] = ['front', 'back']
  return sides.slice(0, faceCount).map((side) => ({
    trimWidthMm: A6_WIDTH_MM,
    trimHeightMm: A6_HEIGHT_MM,
    panels: [{ side, topMm: 0, rotated: false }],
    foldAtMm: null,
  }))
}

/**
 * `pool-terrace-table-tent-en-bg.pdf`: the portal's name made safe for a file
 * system, the piece and the languages on it, in the order they print. Two
 * downloads of one portal that differ in language (English and Bulgarian, or
 * English alone) must not share a name: the browser would call the second one
 * "(1)" and the print shop would have to guess which is which.
 *
 * A redesigned print ends with its paper, `…-en-es-letter.pdf`, and Immersive
 * names itself before it, `…-en-es-immersive-letter.pdf` (spec 7.2): Paper is
 * the default style, so it goes unnamed.
 */
export function printKitFileName(
  portalName: string,
  piece: PrintKitPiece,
  languages: readonly GuestLocale[],
  format?: PrintKitFormat,
): string {
  const noun = PRINT_KIT_PIECE_FACTS[piece].noun.replace(/\s+/gu, '-')
  const look =
    format === undefined
      ? []
      : [...(format.style === 'immersive' ? ['immersive'] : []), format.paper]
  return (
    [fileNameSlug(portalName) || 'portal', noun, ...languages, ...look].join('-') + '.pdf'
  )
}
