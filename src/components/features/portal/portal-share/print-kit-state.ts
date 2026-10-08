// Every branch behind the Print kit section lives here, so the components stay
// flat descriptions of what is on screen: what the section starts with, what a
// caption says, and when the download is on.

import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import {
  A6_HEIGHT_MM,
  A6_WIDTH_MM,
  PRINT_KIT_BLEED_MM,
  PRINT_KIT_PIECE_FACTS,
  PRINT_KIT_QR_QUIET_ZONE_MODULES,
  isPrintKitLanguageChoice,
  printKitLanguageChoices,
  printKitSheets,
  type PrintFace,
  type PrintFaceSide,
  type PrintKitChoice,
  type PrintKitPiece,
} from '#/shared/domain/portal-print-kit'
import { printPageMm } from '#/shared/domain/portal-print-kit-layout'

/** A table tent in the first language choice the portal offers, asking for a rating. */
export function initialPrintKitChoice(locales: readonly GuestLocale[]): PrintKitChoice {
  const [first] = printKitLanguageChoices(locales)
  return { piece: 'table_tent', languages: first ?? [], callToAction: 'rate' }
}

/**
 * The manager's choice, or a fresh one when it names a language the portal no
 * longer offers (the Languages section can change while this tab is open). The
 * piece and the call to action are kept: only the languages were invalidated.
 */
export function reconcilePrintKitChoice(
  choice: PrintKitChoice | null,
  locales: readonly GuestLocale[],
): PrintKitChoice {
  const initial = initialPrintKitChoice(locales)
  if (choice === null) return initial
  return isPrintKitLanguageChoice(locales, choice.languages)
    ? choice
    : { ...choice, languages: initial.languages }
}

/** `English + Български`: each language in its own words. */
export function languageChoiceLabel(languages: readonly GuestLocale[]): string {
  return languages.map((locale) => GUEST_LOCALE_METADATA[locale].nativeName).join(' + ')
}

export function printKitCaptions(piece: PrintKitPiece, side: PrintFaceSide) {
  const facts = PRINT_KIT_PIECE_FACTS[piece]
  const top = `${facts.label} A6 · ${side} · ${A6_WIDTH_MM} × ${A6_HEIGHT_MM} mm · QR with a ${PRINT_KIT_QR_QUIET_ZONE_MODULES}-module quiet zone`
  const bleed = `${PRINT_KIT_BLEED_MM} mm bleed and crop marks`
  const bottom =
    piece === 'table_tent'
      ? `PDF: one folded sheet with a fold mark, ${bleed}`
      : `PDF: one A6 page per side, with ${bleed}`
  return { top, bottom }
}

const WORDS: Readonly<Record<GuestLocale, string>> = Object.fromEntries(
  Object.values(GUEST_LOCALE_METADATA).map((meta) => [meta.code, meta.englishName]),
) as Record<GuestLocale, string>

function joinWords(words: readonly string[]): string {
  return words.join(' and ')
}

export function printKitPreviewLabel(piece: PrintKitPiece, face: PrintFace): string {
  const languages = joinWords(face.blocks.map((block) => WORDS[block.locale]))
  const headline = face.blocks[0]?.headline ?? ''
  return `Print preview: ${PRINT_KIT_PIECE_FACTS[piece].noun}, ${face.side}, ${languages}, "${headline}", the QR code on a light plate and the address as text`
}

/**
 * The download needs the code's address, which only a sealed code can hand
 * over again (ADR 0064). A code made without one says how to get one.
 */
export function printKitAvailability(
  input: Readonly<{ canDownloadAgain: boolean }>,
): Readonly<{ ready: boolean; reason: string | null }> {
  return input.canDownloadAgain
    ? { ready: true, reason: null }
    : {
        ready: false,
        reason:
          'The print kit needs the code’s address, and this code did not keep it. Replace the code to make one that can be downloaded again.',
      }
}

/** A4 and US Letter, in millimetres: the paper an office printer holds. */
const OFFICE_PAPERS_MM = [
  { widthMm: 210, heightMm: 297 },
  { widthMm: 215.9, heightMm: 279.4 },
] as const

/** The PDF's page fits every office paper at full size, either way round. */
function fitsOfficePaper(piece: PrintKitPiece): boolean {
  const [sheet] = printKitSheets(piece, 1)
  if (sheet === undefined) return false
  const page = printPageMm(sheet.trimWidthMm, sheet.trimHeightMm)
  const [short, long] = [page.widthMm, page.heightMm].sort((a, b) => a - b)
  return OFFICE_PAPERS_MM.every(
    (paper) =>
      short !== undefined &&
      long !== undefined &&
      short <= Math.min(paper.widthMm, paper.heightMm) &&
      long <= Math.max(paper.widthMm, paper.heightMm),
  )
}

/**
 * How to print the piece. A table tent's sheet (two A6 panels with bleed and
 * crop marks) is taller than A4 and Letter, so it goes to a print shop; a
 * counter card's page prints on either. Shrunk to fit, a card is no longer A6
 * and loses its marks, so both say to print at actual size.
 */
export function printKitPrintAdvice(piece: PrintKitPiece): string {
  const { noun } = PRINT_KIT_PIECE_FACTS[piece]
  return fitsOfficePaper(piece)
    ? `Print the ${noun} on A4 or Letter at 100% (actual size), not “fit to page”, then cut on the crop marks.`
    : `The ${noun} needs a print shop: its sheet is larger than A4 or Letter. Ask for it at 100% (actual size), then cut on the crop marks.`
}
