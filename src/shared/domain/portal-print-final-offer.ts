// What the final print kit offers and refuses (final design spec §1, §9, §10.1
// and §12 "Choices and refusals"): a choice is piece × orientation × look ×
// paper × printer × quantity, in one or two languages. Pure and shared, so the
// Share tab offers exactly what the server prints.
//
// The refusals:
//   - on today's long address, everything but the Counter card (on its 2.1 in
//     tile): `needs_short_code`;
//   - on the lower-case short address (version 4), the Small card, whose module
//     would print at 0.77 mm: `address_host_too_long`;
//   - on the step-up ladder, the wide Small card: `tile_does_not_fit`;
//   - with a print shop, tents, which stay office-only (Share offers Counter
//     cards instead): `tents_office_only`;
//   - a back page on a tent, which prints its front on both faces:
//     `no_back_for_tents` (Share offers the back page for cards only).

import { err, ok, type Result } from './result'
import { PRINT_KIT_MAX_LANGUAGES, type PrintKitPaper } from './portal-print-kit'
import {
  PRINT_FINAL_PIECES,
  printFinalRegionOf,
  type PrintFinalAddress,
  type PrintFinalLook,
  type PrintFinalOrientation,
  type PrintFinalPiece,
  type PrintFinalPrinter,
} from './portal-print-final'
import {
  choosePrintFinalTile,
  type PrintFinalCodeRefusal,
  type PrintFinalTile,
} from './portal-print-final-code'
import type { PrintFinalTileRung } from './portal-print-final-measures'

/** The most pieces one download makes: a quantity is a count a manager types. */
export const PRINT_FINAL_MAX_QUANTITY = 1000

export type PrintFinalChoice = Readonly<{
  piece: PrintFinalPiece
  orientation: PrintFinalOrientation
  look: PrintFinalLook
  paper: PrintKitPaper
  printer: PrintFinalPrinter
  /** How many pieces the manager needs. */
  quantity: number
  /** How many pieces go on each office sheet, when the manager asks for fewer than fit (More options); absent: all that fit. */
  perSheet?: number
  languageCount: number
  /** The optional back page (More options), off unless asked for; cards only. */
  backPage?: boolean
}>

/** The code a choice prints: the address's shape and its symbol's modules, the quiet zone not included. */
export type PrintFinalCodeFacts = Readonly<{
  address: PrintFinalAddress
  symbolModules: number
  rung?: PrintFinalTileRung
}>

export type PrintFinalRefusal =
  | PrintFinalCodeRefusal
  | Readonly<{
      code:
        | 'tents_office_only'
        | 'no_back_for_tents'
        | 'quantity_out_of_range'
        | 'per_sheet_out_of_range'
        | 'languages_out_of_range'
        | 'wording_not_available'
        | 'shorten_to_fit'
        | 'remove_offer'
    }>

/**
 * How many pieces fit one office sheet (fixed rule Y): Paper 3 / 4 / 10 and
 * Immersive 2 / 2 / 8 on Letter; Paper 4 / 4 / 10 and Immersive 2 / 2 / 9 on
 * A4. The same in both orientations: the grid turns with the piece.
 */
export const PRINT_FINAL_PER_SHEET: Readonly<
  Record<
    PrintFinalPiece,
    Readonly<Record<PrintFinalLook, Readonly<Record<PrintKitPaper, number>>>>
  >
> = Object.freeze({
  counter: { paper: { letter: 3, a4: 4 }, immersive: { letter: 2, a4: 2 } },
  tent: { paper: { letter: 4, a4: 4 }, immersive: { letter: 2, a4: 2 } },
  small: { paper: { letter: 10, a4: 10 }, immersive: { letter: 8, a4: 9 } },
})

/** The office sheets a quantity takes: the quantity decides; the last sheet's spare cells print nothing unless filled. */
export function printFinalSheetCount(quantity: number, perSheet: number): number {
  return Math.ceil(quantity / perSheet)
}

/** How many pieces a download prints: the quantity, or every cell of the last sheet when "Fill the last sheet with spares" is ticked. */
export function printFinalPieceCount(
  quantity: number,
  perSheet: number,
  fillSpares: boolean,
): number {
  return fillSpares ? printFinalSheetCount(quantity, perSheet) * perSheet : quantity
}

const isCountIn = (value: number, max: number): boolean =>
  Number.isInteger(value) && value >= 1 && value <= max

/** The pieces one office sheet carries: the manager's own count (More options), or every cell. */
export const printFinalPerSheetOf = (
  choice: Pick<PrintFinalChoice, 'piece' | 'look' | 'paper' | 'perSheet'>,
): number =>
  choice.perSheet ?? PRINT_FINAL_PER_SHEET[choice.piece][choice.look][choice.paper]

/**
 * What is wrong with a choice before its code is known: a quantity or a count
 * per sheet out of range, a number of languages a print cannot carry, a tent
 * for a print shop, or a back page on a tent. The server asks this before it
 * reveals an address.
 */
export function printFinalChoiceProblem(
  choice: PrintFinalChoice,
): PrintFinalRefusal | null {
  const { quantity, languageCount } = choice
  if (!isCountIn(quantity, PRINT_FINAL_MAX_QUANTITY)) {
    return { code: 'quantity_out_of_range' }
  }
  const fits = PRINT_FINAL_PER_SHEET[choice.piece][choice.look][choice.paper]
  if (choice.perSheet !== undefined && !isCountIn(choice.perSheet, fits)) {
    return { code: 'per_sheet_out_of_range' }
  }
  if (!isCountIn(languageCount, PRINT_KIT_MAX_LANGUAGES)) {
    return { code: 'languages_out_of_range' }
  }
  if (choice.piece === 'tent' && choice.printer === 'print_shop') {
    return { code: 'tents_office_only' }
  }
  if (choice.piece === 'tent' && choice.backPage === true) {
    return { code: 'no_back_for_tents' }
  }
  return null
}

/**
 * Whether a choice prints, and on which tile: the choice's own problems first,
 * then the code's (`choosePrintFinalTile`). The server refuses what this
 * refuses before it reveals an address; the Share tab never offers it.
 */
export function printFinalChoiceTile(
  choice: PrintFinalChoice,
  code: PrintFinalCodeFacts,
): Result<PrintFinalTile, PrintFinalRefusal> {
  const problem = printFinalChoiceProblem(choice)
  if (problem !== null) return err(problem)
  const tile = choosePrintFinalTile({
    piece: choice.piece,
    orientation: choice.orientation,
    region: printFinalRegionOf(choice.paper),
    address: code.address,
    symbolModules: code.symbolModules,
    rung: code.rung,
  })
  return tile.isOk() ? ok(tile.value) : err(tile.error)
}

export type PrintFinalPieceOffer = Readonly<{
  piece: PrintFinalPiece
  /** Null when the piece prints in this choice; else why not. */
  refusal: PrintFinalRefusal | null
}>

/** Each piece as Share offers it under the rest of a choice: the three radio cards and why any is held. */
export function printFinalPieceOffers(
  choice: Omit<PrintFinalChoice, 'piece'>,
  code: PrintFinalCodeFacts,
): readonly PrintFinalPieceOffer[] {
  return PRINT_FINAL_PIECES.map((piece) => {
    const tile = printFinalChoiceTile({ ...choice, piece }, code)
    return { piece, refusal: tile.isOk() ? null : tile.error }
  })
}
