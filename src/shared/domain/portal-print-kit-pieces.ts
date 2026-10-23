// What the Share tab calls each style and piece, and how each is printed (spec
// 7.2): the radio cards' words and the "How to print" steps, per style, piece and
// paper. Copy only, in one place, so each line is tested as written and the
// preview's captions and the file name read the same nouns.
//
// Measures are in inches first on Letter and in millimetres on A4, as the pieces
// are cut (spec 4.1 and 5.1). A measure and its unit never part at a line end:
// `tight` joins them with a no-break space, as the boards do.

import {
  PRINT_KIT_PIECE_NOUNS,
  type PrintKitPaper,
  type PrintKitPiece,
  type PrintKitStyle,
} from './portal-print-kit'

const NO_BREAK_SPACE = ' '

/** Keeps `4 × 6 in`, `2 in` and `160 g/m²` whole: no break inside a measure. */
export function tight(text: string): string {
  return text
    .replace(/ × /gu, `${NO_BREAK_SPACE}×${NO_BREAK_SPACE}`)
    .replace(/(\d) (in|cm|mm|lb|g\/m²)(?=[\s.,;:)]|$)/gu, `$1${NO_BREAK_SPACE}$2`)
}

export type PrintKitStyleFacts = Readonly<{
  label: string
  /** What the style is for, under its name on its card. */
  detail: string
}>

export const PRINT_KIT_STYLE_FACTS: Readonly<Record<PrintKitStyle, PrintKitStyleFacts>> =
  Object.freeze({
    paper: { label: 'Paper', detail: 'Prints on any printer. Letter or A4, no bleed.' },
    immersive: {
      label: 'Immersive',
      detail: 'Dark, with your photo. Best from a print shop.',
    },
  })

/** One line of "How to print". */
export type PrintKitHowToStep = Readonly<{
  text: string
  /** A phrase of `text` to set in bold. */
  strong?: string
  /** Only a print with a second language needs it: the card then has a back. */
  withSecondLanguage?: true
}>

export type PrintKitPieceFacts = Readonly<{
  label: string
  /** The short name used in captions and file names. */
  noun: string
  /** Under the piece's name on its card: its size, and how many fit a sheet. */
  detail: string
  howToPrint: readonly PrintKitHowToStep[]
}>

const step = (text: string, rest: Omit<PrintKitHowToStep, 'text'> = {}) => ({
  text: tight(text),
  ...rest,
})

const ACTUAL_SIZE = step('Print at Actual size (100%). Never “Fit to page”.', {
  strong: 'Actual size (100%)',
})
const CHECK_SIZE = step(
  'Check the size: the coloured bar under each code measures 2 in (5.1 cm).',
)
const DUPLEX = step('Two languages print double-sided: flip on the long edge.', {
  withSecondLanguage: true,
})

/** The paper step: card stock if the printer takes it, else plain paper in a holder. */
const STOCK: Readonly<Record<PrintKitPaper, (holder: string) => string>> = {
  letter: (holder) =>
    `Use 65–110 lb cover card stock if your printer takes it, or plain paper in ${holder}.`,
  a4: (holder) =>
    `Use 160–200 g/m² matte card if your printer takes it, or 120 g/m² paper in ${holder}.`,
}

const CARD_HOLDER: Readonly<Record<PrintKitPaper, string>> = {
  letter: 'a 4 × 6 in sign holder',
  a4: 'an A6 stand',
}
const TENT_HOLDER: Readonly<Record<PrintKitPaper, string>> = {
  letter: 'an 8.5 × 5.5 in holder',
  a4: 'an A5-landscape holder',
}
const CARD_CUTS: Readonly<Record<PrintKitPaper, string>> = {
  letter: 'Cut down on the three grey ticks, then across 6 in from the top edge.',
  a4: 'Cut once across and once down, on the grey ticks.',
}

const PAPER_DETAIL = {
  counter_card: {
    letter: '4 × 6 in · 2 on a Letter sheet',
    a4: 'A6 · 4 on an A4 sheet',
  },
  table_tent: { letter: 'Letter, folded in half', a4: 'A4, folded in half' },
} as const

const IMMERSIVE_DETAIL = {
  counter_card: { letter: '4 × 6 in · print shop', a4: 'A6 · print shop' },
  table_tent: {
    letter: '4 × 6 in, folded · print shop',
    a4: 'A6, folded · print shop',
  },
} as const

const IMMERSIVE_STOCK: Readonly<Record<PrintKitPaper, string>> = {
  letter:
    'Cards 100–130 lb cover, matte or uncoated; tents 80–100 lb cover, scored, grain along the fold; no gloss.',
  a4: 'Cards 350 g/m², matte or uncoated; tents 300–350 g/m², scored, grain along the fold; no gloss.',
}

/** What a print shop is told: the file is theirs to print as it is (spec 5.4). */
const SHOP_LINE =
  'Convert to CMYK with your profile. Field as a warm rich black, at most 280% total ink. Code modules as 100K.'

const LABELS: Readonly<Record<PrintKitPiece, string>> = {
  counter_card: 'Counter card',
  table_tent: 'Table tent',
}

function paperFacts(piece: PrintKitPiece, paper: PrintKitPaper): PrintKitPieceFacts {
  const card = piece === 'counter_card'
  return {
    label: LABELS[piece],
    noun: PRINT_KIT_PIECE_NOUNS[piece],
    detail: tight(PAPER_DETAIL[piece][paper]),
    howToPrint: card
      ? [
          ACTUAL_SIZE,
          CHECK_SIZE,
          DUPLEX,
          step(STOCK[paper](CARD_HOLDER[paper])),
          step(CARD_CUTS[paper]),
        ]
      : [
          ACTUAL_SIZE,
          CHECK_SIZE,
          step(STOCK[paper](TENT_HOLDER[paper])),
          step('Fold on the grey ticks; the fold line stays blank.'),
        ],
  }
}

function immersiveFacts(piece: PrintKitPiece, paper: PrintKitPaper): PrintKitPieceFacts {
  return {
    label: LABELS[piece],
    noun: PRINT_KIT_PIECE_NOUNS[piece],
    detail: tight(IMMERSIVE_DETAIL[piece][paper]),
    howToPrint: [
      step('Made for a print shop. Send the PDF as it is.'),
      step(IMMERSIVE_STOCK[paper]),
      step(SHOP_LINE),
    ],
  }
}

const factsOf = (
  style: PrintKitStyle,
  piece: PrintKitPiece,
  paper: PrintKitPaper,
): PrintKitPieceFacts =>
  style === 'paper' ? paperFacts(piece, paper) : immersiveFacts(piece, paper)

const piecesOf = (style: PrintKitStyle) => ({
  counter_card: {
    letter: factsOf(style, 'counter_card', 'letter'),
    a4: factsOf(style, 'counter_card', 'a4'),
  },
  table_tent: {
    letter: factsOf(style, 'table_tent', 'letter'),
    a4: factsOf(style, 'table_tent', 'a4'),
  },
})

/** The facts of every style, piece and paper: `PRINT_KIT_PIECE_FACTS[style][piece][paper]`. */
export const PRINT_KIT_PIECE_FACTS: Readonly<
  Record<
    PrintKitStyle,
    Readonly<Record<PrintKitPiece, Readonly<Record<PrintKitPaper, PrintKitPieceFacts>>>>
  >
> = Object.freeze({ paper: piecesOf('paper'), immersive: piecesOf('immersive') })

/** The steps a choice needs: a card with one language has no back to print. */
export function printKitHowToPrint(
  style: PrintKitStyle,
  piece: PrintKitPiece,
  paper: PrintKitPaper,
  languageCount: number,
): readonly PrintKitHowToStep[] {
  return PRINT_KIT_PIECE_FACTS[style][piece][paper].howToPrint.filter(
    (entry) => languageCount > 1 || entry.withSecondLanguage !== true,
  )
}

const PAPER_NOTES = {
  paper: {
    counter_card: 'Letter prints two 4 × 6 in cards per sheet. A4 prints four A6 cards.',
    table_tent: 'Letter folds into two 8.5 × 5.5 in faces. A4 folds into two A5 faces.',
  },
  // For a print shop the paper names the size family, not a sheet (spec 7.1).
  immersive: {
    counter_card: 'Letter makes 4 × 6 in pieces. A4 makes A6 pieces.',
    table_tent: 'Letter makes 4 × 6 in pieces. A4 makes A6 pieces.',
  },
} as const

/** The line under the paper-size control: what each paper makes of the piece. */
export function printKitPaperNote(style: PrintKitStyle, piece: PrintKitPiece): string {
  return tight(PAPER_NOTES[style][piece])
}

export const PRINT_KIT_PAPER_LABELS: Readonly<Record<PrintKitPaper, string>> =
  Object.freeze({ letter: 'Letter', a4: 'A4' })
