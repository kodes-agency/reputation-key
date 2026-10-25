// What the manager has chosen in the final Print cards section (final design spec
// §11), and the print it makes. The choice holds only what the manager picked:
// the orientation per piece (each piece remembers its own, starting on its
// default), the quantity as typed, and the paper and languages until they pick
// them (the country's paper, and the portal's first pair, before then). The
// print is what that choice resolves to against the portal's languages and the
// property's country, and what the download sends.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  PRINT_KIT_SCAN_CUE,
  defaultPrintKitPaper,
  isPrintKitLanguageChoice,
  type PrintKitCallToAction,
  type PrintKitPaper,
} from '#/shared/domain/portal-print-kit'
import {
  PRINT_FINAL_DEFAULT_ORIENTATION,
  printFinalRegionOf,
  type PrintFinalLook,
  type PrintFinalOrientation,
  type PrintFinalPiece,
  type PrintFinalPrinter,
} from '#/shared/domain/portal-print-final'
import type { PrintFinalTile } from '#/shared/domain/portal-print-final-code'
import {
  printFinalCueLines,
  printFinalCuesFit,
} from '#/shared/domain/portal-print-final-code'
import { printFinalLanguageChoices } from '#/shared/domain/portal-print-final-languages'
import { PRINT_FINAL_MEASURES } from '#/shared/domain/portal-print-final-measures'
import {
  PRINT_FINAL_MAX_QUANTITY,
  PRINT_FINAL_PER_SHEET,
  printFinalChoiceTile,
  printFinalPieceCount,
  printFinalSheetCount,
  type PrintFinalCodeFacts,
  type PrintFinalRefusal,
} from '#/shared/domain/portal-print-final-offer'

export type PrintFinalShareChoice = Readonly<{
  piece: PrintFinalPiece
  /** Each piece's own orientation, remembered while the manager looks at another. */
  orientations: Readonly<Record<PrintFinalPiece, PrintFinalOrientation>>
  look: PrintFinalLook
  printer: PrintFinalPrinter
  /** Null until the manager picks one: the paper the property's country prints on. */
  paper: PrintKitPaper | null
  /** The quantity as typed, so a field being edited may be empty. */
  quantityText: string
  fillSpares: boolean
  /** Null: every cell of the sheet. */
  perSheet: number | null
  /** Null until the manager picks: the portal's first choice (its primary and the next language). */
  languages: readonly GuestLocale[] | null
  callToAction: PrintKitCallToAction
}>

/** The board's starting point: a wide table tent, Paper, from the manager's printer, ten of them. */
export const INITIAL_PRINT_FINAL_CHOICE: PrintFinalShareChoice = Object.freeze({
  piece: 'tent',
  orientations: PRINT_FINAL_DEFAULT_ORIENTATION,
  look: 'paper',
  printer: 'my_printer',
  paper: null,
  quantityText: '10',
  fillSpares: false,
  perSheet: null,
  languages: null,
  callToAction: 'rate',
})

/** The print a choice makes, as the preview draws it and the download asks for it. */
export type PrintFinalSharePrint = Readonly<{
  piece: PrintFinalPiece
  orientation: PrintFinalOrientation
  look: PrintFinalLook
  printer: PrintFinalPrinter
  paper: PrintKitPaper
  /** The paper the property's country prints on. */
  countryPaper: PrintKitPaper
  /** Null while the field does not hold a whole number from 1 to 1000. */
  quantity: number | null
  fillSpares: boolean
  /** How many go on a sheet: the manager's count while it fits, else every cell. */
  perSheet: number
  /** The manager's own count, sent with the download; absent for every cell. */
  chosenPerSheet: number | undefined
  languages: readonly GuestLocale[]
  callToAction: PrintKitCallToAction
}>

/** A whole number from 1 to 1000, or null. */
export function parsePrintFinalQuantity(text: string): number | null {
  if (!/^\d{1,4}$/u.test(text.trim())) return null
  const quantity = Number(text.trim())
  return quantity >= 1 && quantity <= PRINT_FINAL_MAX_QUANTITY ? quantity : null
}

export function resolvePrintFinalChoice(
  choice: PrintFinalShareChoice,
  locales: readonly GuestLocale[],
  countryCode: string | null,
): PrintFinalSharePrint {
  const countryPaper = defaultPrintKitPaper(countryCode)
  const paper = choice.paper ?? countryPaper
  // A print shop takes no tents (Round 4, O1): Share offers Counter cards instead.
  const piece =
    choice.printer === 'print_shop' && choice.piece === 'tent' ? 'counter' : choice.piece
  const fits = PRINT_FINAL_PER_SHEET[piece][choice.look][paper]
  const chosenPerSheet =
    choice.perSheet !== null && choice.perSheet < fits ? choice.perSheet : undefined
  const languages =
    choice.languages !== null && isPrintKitLanguageChoice(locales, choice.languages)
      ? choice.languages
      : (printFinalLanguageChoices(locales)[0] ?? [])
  return {
    piece,
    orientation: choice.orientations[piece],
    look: choice.look,
    printer: choice.printer,
    paper,
    countryPaper,
    quantity: parsePrintFinalQuantity(choice.quantityText),
    fillSpares: choice.fillSpares,
    perSheet: chosenPerSheet ?? fits,
    chosenPerSheet,
    languages,
    callToAction: choice.callToAction,
  }
}

/** The sheets and pieces a print makes; a print shop's file is one page. */
export function printFinalShareCount(
  print: PrintFinalSharePrint,
): Readonly<{ sheets: number; pieces: number }> {
  const quantity = print.quantity ?? 1
  if (print.printer === 'print_shop') return { sheets: 1, pieces: 1 }
  return {
    sheets: printFinalSheetCount(quantity, print.perSheet),
    pieces: printFinalPieceCount(quantity, print.perSheet, print.fillSpares),
  }
}

/** The cue lines a print's bar carries: one per language, a lone long cue wrapped. */
function cueLinesOf(print: PrintFinalSharePrint, tilePt: number): readonly string[] {
  const { cuePt } = PRINT_FINAL_MEASURES[printFinalRegionOf(print.paper)][print.piece]
  return printFinalCueLines(
    print.languages.map((locale) => PRINT_KIT_SCAN_CUE[locale]),
    tilePt,
    cuePt,
  )
}

/** The tile the preview draws the code on, and why the server would refuse the print, if it would. */
export type PrintFinalShareCheck = Readonly<{
  /** Null when the code cannot print on this piece at all. */
  tile: PrintFinalTile | null
  refusal: PrintFinalRefusal['code'] | null
}>

/**
 * The tile the file would print the code on, and why the server would refuse
 * the print: the offer's own rules and the code's, whether the cues fit the bar,
 * and the quantity. A refusal that is not the code's still leaves a tile, so the
 * preview keeps drawing the piece while the manager fixes the choice.
 */
export function printFinalShareCheck(
  print: PrintFinalSharePrint,
  code: PrintFinalCodeFacts,
): PrintFinalShareCheck {
  const tile = printFinalChoiceTile(
    {
      ...print,
      quantity: print.quantity ?? 1,
      perSheet: print.chosenPerSheet,
      languageCount: print.languages.length,
    },
    code,
  )
  if (tile.isErr()) return { tile: null, refusal: tile.error.code }
  const { tilePt } = tile.value
  const { cuePt } = PRINT_FINAL_MEASURES[printFinalRegionOf(print.paper)][print.piece]
  if (!printFinalCuesFit(cueLinesOf(print, tilePt), tilePt, cuePt)) {
    return { tile: tile.value, refusal: 'cue_does_not_fit' }
  }
  const quantityMissing = print.quantity === null && print.printer === 'my_printer'
  return { tile: tile.value, refusal: quantityMissing ? 'quantity_out_of_range' : null }
}
