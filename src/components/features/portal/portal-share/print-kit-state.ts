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
  type PrintFace,
  type PrintFaceSide,
  type PrintKitChoice,
  type PrintKitPiece,
} from '#/shared/domain/portal-print-kit'

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
