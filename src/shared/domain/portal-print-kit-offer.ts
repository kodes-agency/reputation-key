// What the Share tab offers a manager once a print has a size (round-3
// spec-delta S7, plan slice 14): which sizes, which pieces at a size, which
// outputs a style and piece may take, and the words that name each. Pure and
// shared, so the Share tab's controls, the preview's captions and the server's
// refusals read one answer; `printKitFormatProblem` stays the only judge of what
// the kit makes, and the offers here are what it does not refuse.
//
// The Letter-half tent (the `table_tent` at size Large) stays offered beside the
// Large card until the small sizes are switched on (plan OD3); the small tent is
// the `table_tent` at size Table, and Mini is a card only.

import {
  PRINT_KIT_OUTPUTS,
  PRINT_KIT_PAPERS,
  defaultPrintKitOutput,
  printKitCardsPerSheet,
  type PrintKitOutput,
  type PrintKitPaper,
  type PrintKitPiece,
  type PrintKitSize,
  type PrintKitStyle,
} from './portal-print-kit'
import { printKitFormatProblem } from './portal-print-kit-formats'
import { CODE_TILE } from './portal-print-kit-code-tile'
import { ptToIn, ptToMm } from './portal-print-kit-measures'
import { SIZE_TRIM_PT, TENT_SMALL_FACE } from './portal-print-kit-sizes'
import { PRINT_KIT_PIECE_FACTS, tight } from './portal-print-kit-pieces'
import type { GuestLocale } from './guest-locale'

export type PrintKitSizeFacts = Readonly<{
  label: string
  /** Where a piece of this size goes, under its name on its card. */
  where: string
}>

/** The three sizes, as the Share board names them. The trims are `SIZE_TRIM_PT`'s. */
export const PRINT_KIT_SIZE_FACTS: Readonly<Record<PrintKitSize, PrintKitSizeFacts>> =
  Object.freeze({
    large: { label: 'Large', where: 'Reception and counters, in a holder' },
    table: { label: 'Table', where: 'Tables, nightstands and bars' },
    mini: { label: 'Mini', where: 'Key-card sleeves, check presenters' },
  })

/** A length as the print is cut: inches without trailing zeros on Letter, whole millimetres on A4. */
function lengthText(pt: number, paper: PrintKitPaper): string {
  return paper === 'letter'
    ? `${Number(ptToIn(pt).toFixed(2))}`
    : `${Math.round(ptToMm(pt))}`
}

/** A face of the small tent as it is cut: "5 × 3.5 in" on Letter, "130 × 90 mm" in Europe. */
function tentFaceText(paper: PrintKitPaper): string {
  const { widthPt, heightPt } = TENT_SMALL_FACE.trimPt[paper]
  const unit = paper === 'letter' ? 'in' : 'mm'
  return tight(`${lengthText(widthPt, paper)} × ${lengthText(heightPt, paper)} ${unit}`)
}

/** A size's trim as it is cut: "4 × 6 in" on Letter, "90 × 130 mm" in Europe (Large is A6). */
export function printKitTrimText(size: PrintKitSize, paper: PrintKitPaper): string {
  if (size === 'large' && paper === 'a4') return 'A6'
  const { widthPt, heightPt } = SIZE_TRIM_PT[size][paper]
  const unit = paper === 'letter' ? 'in' : 'mm'
  return tight(`${lengthText(widthPt, paper)} × ${lengthText(heightPt, paper)} ${unit}`)
}

/** A card's title on the Size row: "Large · 4 × 6 in". */
export const printKitSizeTitle = (size: PrintKitSize, paper: PrintKitPaper): string =>
  `${PRINT_KIT_SIZE_FACTS[size].label} · ${printKitTrimText(size, paper)}`

/** The code tile's width on a size and paper: "1.75 in" on Letter, "44 mm" in Europe. */
export function printKitTileText(size: PrintKitSize, paper: PrintKitPaper): string {
  const unit = paper === 'letter' ? 'in' : 'mm'
  return tight(`${lengthText(CODE_TILE[size][paper].tilePt, paper)} ${unit}`)
}

/** The line under the Size row: the code is what sets a piece's size, and it shrinks with it. */
export function printKitSizeNote(paper: PrintKitPaper): string {
  const tiles = (['large', 'table', 'mini'] as const).map(
    (size) => `${printKitTileText(size, paper)} on ${PRINT_KIT_SIZE_FACTS[size].label}`,
  )
  return `The code shrinks with the size: ${tiles.join(', ')}.`
}

/** The size a print starts on: Table once it is offered (the new default), else the first offered. */
export function defaultPrintKitSize(offered: readonly PrintKitSize[]): PrintKitSize {
  return offered.includes('table') ? 'table' : (offered[0] ?? 'large')
}

/** The pieces a size comes in: a card, and a tent at Large (today's) and Table (the small one); Mini is a card only. */
export const printKitPiecesOf = (size: PrintKitSize): readonly PrintKitPiece[] =>
  size === 'mini' ? ['counter_card'] : ['counter_card', 'table_tent']

type Spec = Readonly<{ piece: PrintKitPiece; size: PrintKitSize; style: PrintKitStyle }>

/**
 * The outputs a style and piece may take, a print shop first: whatever
 * `printKitFormatProblem` does not refuse. Immersive cards of Large and Table
 * have both; every other print has one.
 */
export function printKitOutputsOf(spec: Spec): readonly PrintKitOutput[] {
  return PRINT_KIT_OUTPUTS.filter(
    (output) => printKitFormatProblem({ ...spec, output, languageCount: 1 }) === null,
  )
}

/** The output label on the Share board: "For my printer · 4 cards per sheet". */
export function printKitOutputLabel(output: PrintKitOutput, spec: Spec): string {
  const noun = spec.piece === 'table_tent' ? 'tent' : 'card'
  if (output === 'print_shop') return `For a print shop · 1 ${noun} per page with bleed`
  const count = printKitCardsPerSheet(spec.piece, { ...spec, paper: 'letter', output })
  return count === null
    ? 'For my printer'
    : `For my printer · ${count} ${noun}s per sheet`
}

/** The language choices of a size: a Mini card carries one language, so it offers each language alone. */
export function printKitLanguageChoicesOf(
  choices: readonly (readonly GuestLocale[])[],
  size: PrintKitSize,
): readonly (readonly GuestLocale[])[] {
  return size === 'mini' ? choices.filter((languages) => languages.length === 1) : choices
}

/**
 * The piece's size, output and languages as the offers allow them: a size that is
 * not offered becomes the default, a piece the size does not come in a card, an
 * output the print cannot take its style's own, and a Mini's second language is
 * dropped. The same choice, by identity, when nothing needs to change.
 */
export function settlePrintKitFormat<
  C extends Readonly<{
    style: PrintKitStyle
    size: PrintKitSize
    piece: PrintKitPiece
    output: PrintKitOutput
    languages: readonly GuestLocale[]
  }>,
>(choice: C, offered: readonly PrintKitSize[]): C {
  const size = offered.includes(choice.size) ? choice.size : defaultPrintKitSize(offered)
  const piece = printKitPiecesOf(size).includes(choice.piece)
    ? choice.piece
    : 'counter_card'
  const outputs = printKitOutputsOf({ piece, size, style: choice.style })
  const own = defaultPrintKitOutput(choice.style)
  const output = outputs.includes(choice.output)
    ? choice.output
    : outputs.includes(own)
      ? own
      : (outputs[0] ?? own)
  const languages =
    size === 'mini' && choice.languages.length > 1
      ? choice.languages.slice(0, 1)
      : choice.languages
  const unchanged =
    size === choice.size &&
    piece === choice.piece &&
    output === choice.output &&
    languages === choice.languages
  return unchanged ? choice : { ...choice, size, piece, output, languages }
}

/**
 * The line under the paper-size control: what each paper makes of the piece at
 * a size. Large keeps its own notes (`printKitPaperNote`); the smaller sizes
 * name the trim each paper cuts.
 */
export function printKitSizedPaperNote(
  piece: PrintKitPiece,
  size: PrintKitSize,
): string | null {
  if (size === 'large') return null
  if (piece === 'table_tent') {
    return tight('Letter makes 5 × 3.5 in tent faces. A4 makes 130 × 90 mm faces.')
  }
  const noun = size === 'table' ? 'Table cards' : 'Mini cards'
  const [letter, a4] = PRINT_KIT_PAPERS.map((paper) => printKitTrimText(size, paper))
  return tight(`Letter makes ${letter} ${noun}. A4 makes ${a4} cards.`)
}

/** The hint under the switch for the name under the logo (D12): where the name is printed. */
export const PRINT_KIT_NAME_HINT =
  'Large and Table cards. The tent and Mini show the logo alone.'

/**
 * What a piece's card on the Share tab says at a size: Large's are the piece's
 * own (a counter card and the Letter-half tent), the smaller sizes name a card
 * for the holder it stands in and the small tent for its faces (round-3 S7).
 */
export function printKitPieceCardFacts(
  style: PrintKitStyle,
  piece: PrintKitPiece,
  paper: PrintKitPaper,
  size: PrintKitSize,
): Readonly<{ label: string; detail: string }> {
  if (size === 'large') {
    const { label, detail } = PRINT_KIT_PIECE_FACTS[style][piece][paper]
    return { label, detail }
  }
  if (piece === 'table_tent') {
    return {
      label: 'Table tent',
      detail: tight(`Stands on its own, ${tentFaceText(paper)} faces`),
    }
  }
  const trim = printKitTrimText(size, paper)
  const where = size === 'table' ? 'for a holder' : 'for key-card sleeves'
  return { label: 'Card', detail: tight(`${trim}, ${where}`) }
}
