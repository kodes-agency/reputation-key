// What the preview says about a print that is not one of today's Large pieces
// (round-3 spec-delta S7): the Table and Mini cards, the small tent and the
// Immersive office sheets. A sheet's label (its caption and its picture's name),
// a face's name and the note under the preview, in the board's words. The Large
// card and the Letter-half tent keep the copy in `print-kit-preview-copy.ts`.
//
// A measure and its unit never part at a line end (`tight`).

import { GUEST_LOCALE_METADATA } from '#/shared/domain/guest-locale'
import type {
  PrintFace,
  PrintKitChoice,
  PrintKitPaper,
  PrintKitSize,
} from '#/shared/domain/portal-print-kit'
import { printKitCardsPerSheet } from '#/shared/domain/portal-print-kit'
import {
  PRINT_KIT_SIZE_FACTS,
  printKitTrimText,
} from '#/shared/domain/portal-print-kit-offer'
import { tight } from '#/shared/domain/portal-print-kit-pieces'

export type SizedFormat = Pick<
  PrintKitChoice,
  'style' | 'piece' | 'size' | 'output' | 'paper'
>

/** Where a sheet's page is among the print's. */
export type SizedPosition = Readonly<{ index: number; count: number; faces: number }>

/** Whether today's copy says it: the Large card, and the Letter-half tent, in the outputs they always had. */
export const isLegacyCopy = ({ style, piece, size, output }: SizedFormat): boolean =>
  size === 'large' &&
  !(style === 'immersive' && piece === 'counter_card' && output === 'office')

const COUNTS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const

const word = (count: number): string => COUNTS[count] ?? String(count)

/** A measure with its no-break spaces made plain, for a name that is read and not wrapped. */
const plain = (text: string): string => text.replaceAll('\u00A0', ' ')

const SHEET: Readonly<Record<PrintKitPaper, string>> = { letter: 'Letter', a4: 'A4' }
const BLEED: Readonly<Record<PrintKitPaper, string>> = { letter: '1/8 in', a4: '3 mm' }
const TENT_FACES: Readonly<Record<PrintKitPaper, string>> = {
  letter: '5 × 3.5 in',
  a4: '130 × 90 mm',
}
const TENT_FLAT: Readonly<Record<PrintKitPaper, string>> = {
  letter: '5 × 7 in',
  a4: '130 × 180 mm',
}

/** What a card of a size is called: "counter card", "Table card". */
const cardNoun = (size: PrintKitSize): string =>
  size === 'large' ? 'counter card' : `${PRINT_KIT_SIZE_FACTS[size].label} card`

/** A card's name at a size: "3.5 × 5 in Table card", "A6 counter card". */
const cardName = (size: PrintKitSize, paper: PrintKitPaper): string =>
  `${printKitTrimText(size, paper)} ${cardNoun(size)}`

/** What a face is: "3.5 × 5 in Table card", "5 × 3.5 in table tent face". */
export function sizedFaceName({ piece, size, paper }: SizedFormat): string {
  return tight(
    piece === 'table_tent'
      ? `${TENT_FACES[paper]} table tent face`
      : cardName(size, paper),
  )
}

/** A sheet's page number, said when the print has more than one page. */
function pageSuffix(page: SizedPosition): string {
  if (page.count < 2) return ''
  return ` · page ${page.index + 1} of ${page.count}, ${page.index === 0 ? 'fronts' : 'backs'}`
}

/**
 * The caption of a whole sheet, and its picture's name. Plain spaces, as the
 * Large sheet's label has, because a name is read, not wrapped.
 */
export function sizedSheetCaption(format: SizedFormat, page: SizedPosition): string {
  const { style, piece, size, output, paper } = format
  const sheet = SHEET[paper]
  const cards = word(page.faces)
  if (piece === 'table_tent') {
    return style === 'immersive'
      ? `${TENT_FACES[paper]} table tent for a print shop, ${TENT_FLAT[paper]} flat with bleed, crop marks and fold marks`
      : `${sheet} · two table tents, ${TENT_FACES[paper]} faces, folded on the dashed line`
  }
  const noun = cardNoun(size)
  const trim = plain(printKitTrimText(size, paper))
  if (style === 'immersive' && output === 'print_shop') {
    const side = page.index === 0 ? 'front' : 'back'
    return `${plain(cardName(size, paper))} for a print shop, with bleed and crop marks · page ${page.index + 1} of ${page.count}, ${side}`
  }
  if (style === 'immersive' && size === 'large') {
    return `${sheet} landscape · ${cards} ${trim} cards, each with its own bleed`
  }
  if (style === 'immersive') {
    return `${sheet} · ${cards} ${trim} ${noun}s, one bleed around them`
  }
  return `${sheet} · ${cards} ${trim} ${noun}s${pageSuffix(page)}`
}

const languageName = (face: PrintFace | undefined, index: number): string | null => {
  const block = face?.blocks[index]
  return block === undefined ? null : GUEST_LOCALE_METADATA[block.locale].englishName
}

/** The sentence about a card's second page: only a card with a second language has one. */
const backsSentence = (faces: readonly PrintFace[]): string => {
  const second = languageName(faces[0], 1)
  return second === null ? '' : `Page 2 holds the backs, ${second} first. `
}

const DEEPER_COLOUR = ' For deeper colour, choose “For a print shop”.'

/** The note under the preview: what to do with the sheet. */
export function sizedPreviewNote(
  { style, piece, size, output, paper }: SizedFormat,
  faces: readonly PrintFace[],
): string {
  const second = languageName(faces[0], 1)
  if (piece === 'table_tent') {
    if (style === 'immersive') {
      return tight(
        `For a print shop: ${TENT_FLAT[paper]} flat, folded at the middle, with ${BLEED[paper]} bleed, crop marks and fold marks.`,
      )
    }
    const back = second === null ? 'the same on both faces' : `${second} on the back face`
    return tight(`Cut on the ticks, then fold on the dashed line: two tents, ${back}.`)
  }
  const count = printKitCardsPerSheet(piece, { style, paper, size, output })
  const trim = printKitTrimText(size, paper)
  if (style === 'immersive' && output === 'print_shop') {
    return tight(
      `${backsSentence(faces)}For a print shop: ${BLEED[paper]} bleed and crop marks are in the file.`,
    )
  }
  if (style === 'immersive') {
    const rows =
      second === null
        ? ''
        : size === 'large'
          ? ` The second card is the back, ${second} first.`
          : ' The top row is the front and the bottom row the back.'
    return tight(
      `Cut on the crop marks: ${word(count ?? 0)} ${trim} cards.${rows}${DEEPER_COLOUR}`,
    )
  }
  return tight(
    `${backsSentence(faces)}Cut on the ticks: ${word(count ?? 0)} ${trim} cards.`,
  )
}
