// What the preview beside the Print kit section says about what it shows (spec
// 7.2): a caption above it, a label for a face shown on its own, and a note
// under it on what to do with the print. Copy only, so each line is tested as
// written; the sheet's own label (the caption's words for a whole sheet) is the
// art's, read from the same pages the PDF draws.

import { GUEST_LOCALE_METADATA } from '#/shared/domain/guest-locale'
import {
  PRINT_KIT_PIECE_NOUNS,
  type PrintFace,
  type PrintFaceSide,
  type PrintKitChoice,
} from '#/shared/domain/portal-print-kit'
import { tight } from '#/shared/domain/portal-print-kit-pieces'
import { printKitPrintShopLabel } from './print-kit-immersive-art-layout'
import { printKitSheetLabel } from './print-kit-paper-art-layout'
import {
  isLegacyCopy,
  sizedFaceName,
  sizedPreviewNote,
  sizedSheetCaption,
} from './print-kit-sized-copy'

/** Whole sheet, or one face of it. */
export type PrintKitPreviewMode = 'sheet' | 'face'

/** What the copy needs of a choice. Large and the Letter-half tent are read as they always were; every other print is `print-kit-sized-copy.ts`'s. */
type Format = Pick<PrintKitChoice, 'style' | 'piece' | 'paper' | 'size' | 'output'>

/** Where a sheet's page is among the print's: the caption says "page 1 of 2". */
export type PrintKitSheetPosition = Readonly<{
  index: number
  count: number
  /** How many faces the page carries. */
  faces: number
}>

/** The caption of a whole sheet: its paper, what is on it and which page it is. */
export function printKitSheetCaption(
  format: Format,
  page: PrintKitSheetPosition,
): string {
  if (!isLegacyCopy(format)) return sizedSheetCaption(format, page)
  const { style, piece, paper } = format
  return style === 'immersive'
    ? printKitPrintShopLabel(piece, paper, page)
    : printKitSheetLabel(piece, paper, page)
}

const FACE_SIZES = {
  paper: {
    counter_card: { letter: '4 × 6 in', a4: 'A6' },
    table_tent: { letter: '8.5 × 5.5 in', a4: 'A5' },
  },
  immersive: {
    counter_card: { letter: '4 × 6 in', a4: 'A6' },
    table_tent: { letter: '4 × 6 in', a4: 'A6' },
  },
} as const

/** What a face is: "4 × 6 in counter card", "8.5 × 5.5 in table tent face", "A6 table tent panel". */
function faceName(format: Format): string {
  if (!isLegacyCopy(format)) return sizedFaceName(format)
  const { style, piece, paper } = format
  const size = FACE_SIZES[style][piece][paper]
  const noun = PRINT_KIT_PIECE_NOUNS[piece]
  if (piece === 'counter_card') return `${size} ${noun}`
  return `${size} ${noun} ${style === 'paper' ? 'face' : 'panel'}`
}

/** The caption of one face shown on its own: "4 × 6 in counter card · front". */
export function printKitFaceCaption(format: Format, side: PrintFaceSide): string {
  return tight(`${faceName(format)} · ${side}`)
}

const languageName = (face: PrintFace | undefined, index: number): string | null => {
  const block = face?.blocks[index]
  return block === undefined ? null : GUEST_LOCALE_METADATA[block.locale].englishName
}

/** What a screen reader hears for a face shown on its own. */
export function printKitFaceLabel(format: Format, face: PrintFace): string {
  const languages = face.blocks
    .map((block) => GUEST_LOCALE_METADATA[block.locale].englishName)
    .join(' and ')
  const headline = face.blocks[0]?.headline ?? ''
  return `Print preview: ${faceName(format)}, ${face.side}, ${languages}, "${headline}"`
}

const BLEED = { letter: '1/8 in', a4: '3 mm' } as const
const FLAT = { letter: '4 × 12 in', a4: '105 × 296 mm' } as const
const CARDS_PER_SHEET = { letter: 'two 4 × 6 in cards', a4: 'four A6 cards' } as const
const TENT_FACES = { letter: 'two 8.5 × 5.5 in faces', a4: 'two A5 faces' } as const

/** The sentence about a card's second page: only a card with a second language has one. */
const backsSentence = (faces: readonly PrintFace[]): string => {
  const second = languageName(faces[0], 1)
  return second === null ? '' : `Page 2 holds the backs, ${second} first. `
}

/**
 * The note under the preview: what to do with the sheet. Paper is cut or folded
 * on its ticks; Immersive is a print shop's, with its bleed and marks in the file.
 * A two-language Immersive tent has no photo, and says why.
 */
export function printKitPreviewNote(format: Format, faces: readonly PrintFace[]): string {
  if (!isLegacyCopy(format)) return sizedPreviewNote(format, faces)
  const { style, piece, paper } = format
  const second = languageName(faces[0], 1)
  if (style === 'paper' && piece === 'counter_card') {
    return tight(`${backsSentence(faces)}Cut on the ticks: ${CARDS_PER_SHEET[paper]}.`)
  }
  if (style === 'paper') {
    const back = second === null ? '.' : `, the back with ${second} first.`
    return tight(`Fold on the ticks: ${TENT_FACES[paper]}${back}`)
  }
  const shop = `For a print shop: ${BLEED[paper]} bleed and crop marks are in the file.`
  if (piece === 'counter_card') return tight(`${backsSentence(faces)}${shop}`)
  const noPhoto =
    second === null ? '' : ' With two languages the tent has no room for a photo.'
  return tight(
    `For a print shop: ${FLAT[paper]} flat, folded at the middle, with ${BLEED[paper]} bleed, crop marks and fold marks.${noPhoto}`,
  )
}
