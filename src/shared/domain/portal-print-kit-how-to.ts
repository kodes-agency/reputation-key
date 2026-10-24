// "How to print" for every print the kit makes (round-3 spec-delta S7, round-2
// R6): the steps a manager follows for the style, piece, size and output they
// chose, and the title that says which. The Large card and the Letter-half tent
// keep the steps `portal-print-kit-pieces.ts` has always had; this adds the
// smaller sizes' and the Immersive office sheets', each naming the bar that
// checks the print was not scaled (`bar`: the tile's width, "1.4 in (3.6 cm)").
//
// Copy only, in one place, so each line is tested as written.

import {
  PRINT_KIT_PIECE_NOUNS,
  type PrintKitOutput,
  type PrintKitPaper,
  type PrintKitPiece,
  type PrintKitSize,
  type PrintKitStyle,
} from './portal-print-kit'
import {
  ACTUAL_SIZE,
  DUPLEX,
  IMMERSIVE_STOCK,
  PRINT_KIT_STYLE_FACTS,
  SHOP_LINE,
  STOCK,
  checkSize,
  printKitHowToPrint,
  step,
  type PrintKitHowToStep,
} from './portal-print-kit-pieces'
import { PRINT_KIT_SIZE_FACTS } from './portal-print-kit-offer'

export type PrintKitHowToQuery = Readonly<{
  style: PrintKitStyle
  piece: PrintKitPiece
  size: PrintKitSize
  output: PrintKitOutput
  paper: PrintKitPaper
  languageCount: number
  /** The bar under each code as the tile makes it, with its width in both units. */
  bar: string
}>

const BLEED: Readonly<Record<PrintKitPaper, string>> = { letter: '1/8 in', a4: '3 mm' }

/** The holder a Table card stands in, and the stock a Mini cuts from. */
const TABLE_HOLDER: Readonly<Record<PrintKitPaper, string>> = {
  letter: 'a 3.5 × 5 in holder',
  a4: 'a 90 × 130 mm holder',
}
const MINI_STOCK: Readonly<Record<PrintKitPaper, string>> = {
  letter:
    'Use 65–110 lb cover card stock if your printer takes it, or 3.5 × 2 in business-card stock.',
  a4: 'Use 160–200 g/m² matte card if your printer takes it, or 85 × 55 mm business-card stock.',
}
const TENT_STOCK: Readonly<Record<PrintKitPaper, string>> = {
  letter: 'Use 80–100 lb cover card stock.',
  a4: 'Use 220–270 g/m² card.',
}
const TENT_STANDS: Readonly<Record<PrintKitPaper, string>> = {
  letter: 'Each tent stands about 3.4 in tall.',
  a4: 'Each tent stands about 8.7 cm tall.',
}
const OFFICE_COVER: Readonly<Record<PrintKitPaper, string>> = {
  letter: 'Use 100–110 lb cover on the manual feed if your printer takes it.',
  a4: 'Use 270–300 g/m² cover on the manual feed if your printer takes it.',
}
const DARK_COLOUR = 'Dark colour prints deepest from a print shop.'

const shopSteps = (paper: PrintKitPaper): readonly PrintKitHowToStep[] => [
  step('Made for a print shop. Send the PDF as it is.'),
  step(IMMERSIVE_STOCK[paper]),
  step(SHOP_LINE),
]

/** Paper, on the customer's own printer, at the sizes that are not Large. */
function paperSteps(query: PrintKitHowToQuery): readonly PrintKitHowToStep[] {
  const { piece, size, paper, bar } = query
  if (piece === 'table_tent') {
    return [
      ACTUAL_SIZE,
      checkSize(bar),
      step(TENT_STOCK[paper]),
      step(
        `Cut on the grey ticks, then score and fold on the dashed line. ${TENT_STANDS[paper]}`,
      ),
    ]
  }
  if (size === 'mini') {
    return [
      ACTUAL_SIZE,
      checkSize(bar),
      step(MINI_STOCK[paper]),
      step('Cut on the grey ticks: 3 cuts down, 6 across.'),
    ]
  }
  return [
    ACTUAL_SIZE,
    checkSize(bar),
    DUPLEX,
    step(STOCK[paper](TABLE_HOLDER[paper])),
    step('Cut on the grey ticks: 3 cuts down, 3 across.'),
  ]
}

/** An Immersive card on an office sheet: its cards bleed for a cutter. */
function officeSteps(query: PrintKitHowToQuery): readonly PrintKitHowToStep[] {
  const { size, paper, bar } = query
  const bleed = BLEED[paper]
  const cut =
    size === 'table'
      ? `Cut on the crop marks: 3 cuts down, 3 across. The colour runs ${bleed} past the outer edge.`
      : `Cut on the crop marks: the colour runs ${bleed} past them, so no white edge shows.`
  return [
    ACTUAL_SIZE,
    checkSize(bar),
    step(`${OFFICE_COVER[paper]} ${DARK_COLOUR}`),
    step(cut),
  ]
}

/** The steps a choice needs: a card with one language has no back to print. */
export function printKitHowToSteps(
  query: PrintKitHowToQuery,
): readonly PrintKitHowToStep[] {
  const { style, piece, size, output, paper, languageCount, bar } = query
  const forLarge = size === 'large' && !(style === 'immersive' && output === 'office')
  if (forLarge) return printKitHowToPrint(style, piece, paper, languageCount, bar)
  const steps =
    style === 'immersive' && output === 'print_shop'
      ? shopSteps(paper)
      : style === 'immersive'
        ? officeSteps(query)
        : paperSteps(query)
  return steps.filter((entry) => languageCount > 1 || entry.withSecondLanguage !== true)
}

/**
 * What the steps are for: "Paper counter card", "Immersive Table card · my
 * printer". An Immersive card names its output, because it has two.
 */
export function printKitHowToTitle(
  query: Pick<PrintKitHowToQuery, 'style' | 'piece' | 'size' | 'output'>,
): string {
  const { style, piece, size, output } = query
  const noun =
    piece === 'table_tent' || size === 'large'
      ? PRINT_KIT_PIECE_NOUNS[piece]
      : `${PRINT_KIT_SIZE_FACTS[size].label} card`
  const where =
    style === 'immersive' && piece === 'counter_card'
      ? ` · ${output === 'office' ? 'my printer' : 'print shop'}`
      : ''
  return `${PRINT_KIT_STYLE_FACTS[style].label} ${noun}${where}`
}
