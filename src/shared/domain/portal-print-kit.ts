// The print kit's vocabulary: which pieces it has, what they say, how a sheet is
// laid out, and how a printed address reads.
//
// Pure and shared, because the Share tab's preview (a React tree) and the PDF
// the server makes (round 4, slice 45) must agree on every word and every
// measure: neither asks the other, both read this file.
//
// The copy is industry-neutral on purpose ("visit", never "stay"): a barber, a
// restaurant and a hotel pool all print the same card. es, it, fr and de are
// drafted without a native-speaker check, as the closed beta allows (owner
// decision 5, 2026-09-30).

import type { GuestLocale } from './guest-locale'

export const PRINT_KIT_PIECES = Object.freeze(['table_tent', 'counter_card'] as const)
export type PrintKitPiece = (typeof PRINT_KIT_PIECES)[number]

export const PRINT_KIT_CALLS_TO_ACTION = Object.freeze(['rate', 'tell'] as const)
export type PrintKitCallToAction = (typeof PRINT_KIT_CALLS_TO_ACTION)[number]

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

export type PrintKitChoice = Readonly<{
  piece: PrintKitPiece
  /** One or two of the portal's languages; the first is the larger. */
  languages: readonly GuestLocale[]
  callToAction: PrintKitCallToAction
}>

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
  choice: PrintKitChoice,
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
 * The address as printed under the code: the host only. The path is the code's
 * own secret (the token) and the query holds the marker that counts a scan, so
 * neither is printed in words. Nobody types them; the code and the NFC tag
 * carry them.
 */
export function shortPrintAddress(address: string): string {
  try {
    return new URL(address).host
  } catch {
    return address
  }
}

const FILE_NAME_SLUG_MAX = 60

/**
 * `pool-terrace-table-tent.pdf`: the portal's name made safe for a file system.
 * Letters and digits of any script stay (a Cyrillic name is common here), so a
 * name is never lost to `portal`; everything else becomes one hyphen.
 */
export function printKitFileName(portalName: string, piece: PrintKitPiece): string {
  const slug = portalName
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, FILE_NAME_SLUG_MAX)
    .replace(/-$/gu, '')
  const noun = PRINT_KIT_PIECE_FACTS[piece].noun.replace(/\s+/gu, '-')
  return `${slug === '' ? 'portal' : slug}-${noun}.pdf`
}
