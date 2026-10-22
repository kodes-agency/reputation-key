// Every branch behind the Print kit section lives here, so the components stay
// flat descriptions of what is on screen: what the section starts with, what a
// caption says, and when the download is on.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { isServerFunctionError } from '#/shared/auth/server-function-error'
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
import {
  stripUnsupportedCharacters,
  unsupportedCharacters,
} from '#/shared/domain/portal-print-kit-font-ranges'
import { printPageMm } from '#/shared/domain/portal-print-kit-layout'
import type { PortalPublicationState } from '../shared/types'

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

/**
 * The face as the file draws it: without the characters no guest font carries,
 * which the PDF drops and the browser's own fallback fonts would show. (The
 * title above the call to action is set in capitals, so it is cleaned there.)
 */
export function printableFace(face: PrintFace): PrintFace {
  return {
    ...face,
    blocks: face.blocks.map((block) => ({
      ...block,
      headline: stripUnsupportedCharacters(block.headline),
      subline: stripUnsupportedCharacters(block.subline),
    })),
  }
}

/**
 * The characters of the print's words that no guest font carries, so will not
 * print: each once, in the order they appear. The brand counts only while it is
 * drawn as words (a logo stands in for it), in capitals as the file sets it.
 */
export function unprintableCharacters(
  look: Pick<PortalPrintKitView['look'], 'wordmark' | 'logoUrl'>,
  faces: readonly PrintFace[],
): readonly string[] {
  const words = faces.flatMap((face) =>
    face.blocks.flatMap((block) => [
      block.kicker.toUpperCase(),
      block.headline,
      block.subline,
    ]),
  )
  const brand = look.logoUrl === null ? [look.wordmark.toUpperCase()] : []
  return unsupportedCharacters([...brand, ...words].join('\n'))
}

/** How many characters the line names before it counts the rest. */
const UNPRINTABLE_NAMED = 6

/** A character a person can see; a variation selector or a mark has nothing to name. */
const VISIBLE_CHARACTER = /[\p{L}\p{N}\p{P}\p{S}]/u

/**
 * The one line that names what will not print, or null when everything will.
 * Characters with nothing to show (a variation selector on an emoji) are not
 * named: they would be a blank in the sentence.
 */
export function describeUnprintable(characters: readonly string[]): string | null {
  const visible = characters.filter((character) => VISIBLE_CHARACTER.test(character))
  if (visible.length === 0) return null
  const named = visible.slice(0, UNPRINTABLE_NAMED).join(' ')
  const rest = visible.length - UNPRINTABLE_NAMED
  const list = rest > 0 ? `${named} and ${rest} more` : named
  return `These characters will not print, because the print kit’s fonts don’t have them: ${list}.`
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
 * Whether the portal has a live version to print from. A print carries the live
 * page's code, and the live version closes when a portal leaves "published": a
 * draft never had one, and turning it off or archiving it ends it. So the state
 * answers it. A tab that was not told the state reads as live and lets the read
 * decide (see `isNothingLiveRefusal`).
 */
export function printKitHasLiveVersion(
  state: PortalPublicationState | undefined,
): boolean {
  return state === undefined || state === 'published'
}

/** What the server calls a read or a download for a portal with nothing live. */
const NOTHING_LIVE_CODE = 'publication_snapshot_unavailable'

/** The read was refused because nothing is live: asking again cannot change that. */
export function isNothingLiveRefusal(error: unknown): boolean {
  return isServerFunctionError(error) && error.code === NOTHING_LIVE_CODE
}

export type PrintKitNotLiveNotice = Readonly<{
  body: string
  /** Where "Review & publish" goes; null when it is not offered. */
  review: Readonly<{ propertyId: string; portalId: string }> | null
}>

const PRINT_CARRIES_LIVE_CODE = 'A print carries the code of the live page.'

/**
 * What the Print kit section says in place of itself while nothing is live: what
 * to do first, and why. An archived portal is restored from the Portals list
 * before it can be published, so it is not sent to the review. A portal the
 * state calls live but the server says has nothing live gets the draft's words.
 * The review link needs the portal's property: without it the tab offers none.
 */
export function describePrintKitNotLive(
  state: PortalPublicationState | undefined,
  portal: Readonly<{ portalId: string; propertyId?: string }>,
): PrintKitNotLiveNotice {
  const review =
    portal.propertyId === undefined
      ? null
      : { propertyId: portal.propertyId, portalId: portal.portalId }
  switch (state) {
    case 'disabled':
      return {
        body: `Publish this portal again to make a print kit. ${PRINT_CARRIES_LIVE_CODE}`,
        review,
      }
    case 'archived':
      return {
        body: `Restore this portal from the Portals list and publish it to make a print kit. ${PRINT_CARRIES_LIVE_CODE}`,
        review: null,
      }
    default:
      return {
        body: `Publish this portal to make a print kit. ${PRINT_CARRIES_LIVE_CODE}`,
        review,
      }
  }
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

const CMYK_ADVICE = 'Ask your print shop to convert to CMYK if they need it.'

/**
 * How to print the piece. A table tent's sheet (two A6 panels with bleed and
 * crop marks) is taller than A4 and Letter, so it goes to a print shop; a
 * counter card's page prints on either. Shrunk to fit, a card is no longer A6
 * and loses its marks, so both say to print at actual size. The file's colours
 * are RGB, which a shop that prints in CMYK converts: they are asked to, if they
 * need it, rather than the manager being left to know.
 */
export function printKitPrintAdvice(piece: PrintKitPiece): string {
  const { noun } = PRINT_KIT_PIECE_FACTS[piece]
  const how = fitsOfficePaper(piece)
    ? `Print the ${noun} on A4 or Letter at 100% (actual size), not “fit to page”, then cut on the crop marks.`
    : `The ${noun} needs a print shop: its sheet is larger than A4 or Letter. Ask them to print it at 100% (actual size) and cut it on the crop marks.`
  return `${how} ${CMYK_ADVICE}`
}
