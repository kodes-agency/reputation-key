// What the manager has chosen in the Print cards section (design spec
// §11), and the print it makes. The choice holds only what the manager picked:
// the orientation per piece (each piece remembers its own, starting on its
// default), the quantity as typed, and the paper and languages until they pick
// them (the country's paper, and the portal's first pair, before then). The
// print is what that choice resolves to against the portal's languages and the
// property's country, and what the download sends.

import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintLastSettings } from '#/shared/domain/portal-print-last'
import {
  defaultPrintKitPaper,
  isPrintKitLanguageChoice,
  type PrintKitPaper,
} from '#/shared/domain/portal-print-kit'
import {
  PRINT_COPY,
  PRINT_DEFAULT_CALL_TO_ACTION,
  type PrintCallToAction,
} from '#/shared/domain/portal-print-copy'
import {
  printOwnWordsToSend,
  type PrintCustomWords,
  type PrintWordsChoice,
} from '#/shared/domain/portal-print-custom'
import { printSameOwnWords } from '#/shared/domain/portal-print-wording'
import {
  PRINT_DEFAULT_ORIENTATION,
  printRegionOf,
  type PrintLook,
  type PrintOrientation,
  type PrintPiece,
  type PrintPrinter,
} from '#/shared/domain/portal-print'
import type { PrintTile } from '#/shared/domain/portal-print-code'
import {
  PRINT_SCAN_CUE,
  printCueLines,
  printCuesFit,
} from '#/shared/domain/portal-print-cue'
import { printHasBack } from '#/shared/domain/portal-print-back'
import { printLanguageChoices } from '#/shared/domain/portal-print-languages'
import { PRINT_MEASURES } from '#/shared/domain/portal-print-measures'
import {
  PRINT_MAX_QUANTITY,
  PRINT_PER_SHEET,
  printChoiceTile,
  printPieceCount,
  printSheetCount,
  type PrintCodeFacts,
  type PrintRefusal,
} from '#/shared/domain/portal-print-offer'
import { previewMeasurer } from './print-face-layout'

export type PrintShareChoice = Readonly<{
  piece: PrintPiece
  /** Each piece's own orientation, remembered while the manager looks at another. */
  orientations: Readonly<Record<PrintPiece, PrintOrientation>>
  /** Null until the manager picks: Paper the first time, after that the look of the Portal's last print (§11.2). */
  look: PrintLook | null
  printer: PrintPrinter
  /** Null until the manager picks one: the paper the property's country prints on. */
  paper: PrintKitPaper | null
  /** The quantity as typed, so a field being edited may be empty. */
  quantityText: string
  fillSpares: boolean
  /** Null: every cell of the sheet. */
  perSheet: number | null
  /** The optional back page (More options): off until asked for, and only a card has one. */
  backPage: boolean
  /** A print shop's crop marks (More options): off until asked for; from the manager's own printer they mean nothing. */
  cropMarks: boolean
  /** Null until the manager picks: the portal's first choice (its primary and the next language). */
  languages: readonly GuestLocale[] | null
  /** The wording picked, or the one the manager's own words started from. */
  callToAction: PrintCallToAction
  /**
   * The manager's own words as typed, per language ("Write your own…"); null
   * while a wording is picked. A language without its own entry yet starts from
   * the wording's copy, so adding a language prefills its fields.
   */
  customWords: PrintCustomWords | null
}>

/** The board's starting point: a wide table tent, Paper, from the manager's printer, ten of them. */
export const INITIAL_PRINT_CHOICE: PrintShareChoice = Object.freeze({
  piece: 'tent',
  orientations: PRINT_DEFAULT_ORIENTATION,
  look: null,
  printer: 'my_printer',
  paper: null,
  quantityText: '10',
  fillSpares: false,
  perSheet: null,
  backPage: false,
  cropMarks: false,
  languages: null,
  callToAction: PRINT_DEFAULT_CALL_TO_ACTION,
  customWords: null,
})

/** The print a choice makes, as the preview draws it and the download asks for it. */
export type PrintSharePrint = Readonly<{
  piece: PrintPiece
  orientation: PrintOrientation
  look: PrintLook
  printer: PrintPrinter
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
  /** The back page is printed: asked for, on a card (a tent prints its front on both faces). */
  backPage: boolean
  /** The file's page has crop marks: asked for, and a print shop's (the manager's own printer has none). */
  cropMarks: boolean
  languages: readonly GuestLocale[]
  callToAction: PrintCallToAction
  /** What the print says: the wording, and the own words of every language on it (prefilled) while "Write your own…" is on. */
  words: PrintWordsChoice
}>

/** The words a choice prints in `languages`: own words for each language, prefilled from the wording, or the wording alone. */
function wordsOf(
  choice: Pick<PrintShareChoice, 'callToAction' | 'customWords'>,
  languages: readonly GuestLocale[],
): PrintWordsChoice {
  const preset = choice.callToAction
  const own = choice.customWords
  if (own === null) return { preset, custom: null }
  return {
    preset,
    custom: Object.fromEntries(
      languages.map((locale) => [locale, own[locale] ?? PRINT_COPY[locale][preset]]),
    ),
  }
}

/** A whole number from 1 to 1000, or null. */
export function parsePrintQuantity(text: string): number | null {
  if (!/^\d{1,4}$/u.test(text.trim())) return null
  const quantity = Number(text.trim())
  return quantity >= 1 && quantity <= PRINT_MAX_QUANTITY ? quantity : null
}

export function resolvePrintChoice(
  choice: PrintShareChoice,
  locales: readonly GuestLocale[],
  countryCode: string | null,
  /** The look of the Portal's last print, which the print opens on until a look is picked; null when never printed. */
  lastLook: PrintLook | null = null,
): PrintSharePrint {
  const countryPaper = defaultPrintKitPaper(countryCode)
  const paper = choice.paper ?? countryPaper
  const look = choice.look ?? lastLook ?? 'paper'
  // A print shop takes no tents (Round 4, O1): Share offers Counter cards instead.
  const piece =
    choice.printer === 'print_shop' && choice.piece === 'tent' ? 'counter' : choice.piece
  const fits = PRINT_PER_SHEET[piece][look][paper]
  const chosenPerSheet =
    choice.perSheet !== null && choice.perSheet < fits ? choice.perSheet : undefined
  const languages =
    choice.languages !== null && isPrintKitLanguageChoice(locales, choice.languages)
      ? choice.languages
      : (printLanguageChoices(locales)[0] ?? [])
  return {
    piece,
    orientation: choice.orientations[piece],
    look,
    printer: choice.printer,
    paper,
    countryPaper,
    quantity: parsePrintQuantity(choice.quantityText),
    fillSpares: choice.fillSpares,
    perSheet: chosenPerSheet ?? fits,
    chosenPerSheet,
    backPage: choice.backPage && printHasBack(piece),
    cropMarks: choice.cropMarks && choice.printer === 'print_shop',
    languages,
    callToAction: choice.callToAction,
    words: wordsOf(choice, languages),
  }
}

/** The choice that sets a Portal's last print again: every choice it took, each piece keeping the orientation it was not printed in. */
export function choiceOfLastPrint(
  choice: PrintShareChoice,
  last: PrintLastSettings,
): PrintShareChoice {
  return {
    ...choice,
    piece: last.piece,
    orientations: { ...choice.orientations, [last.piece]: last.orientation },
    look: last.look,
    printer: last.printer,
    paper: last.paper,
    quantityText: String(last.quantity),
    fillSpares: last.fillSpares,
    perSheet: last.perSheet,
    backPage: last.backPage,
    cropMarks: last.cropMarks,
    languages: last.languages,
    callToAction: last.callToAction,
    // The own words come back in "Write your own…"; a print that said the wording leaves it picked.
    customWords: last.customWords,
  }
}

/** The look the print opens on until the manager picks one: the last print's, when there was one. */
export function printLastLook(
  lastPrint: Readonly<{ settings: Pick<PrintLastSettings, 'look'> }> | null,
): PrintLook | null {
  return lastPrint?.settings.look ?? null
}

/** Whether a print is the Portal's last print: every choice it took, as it took it. */
export function printMatchesLast(
  print: PrintSharePrint,
  last: PrintLastSettings,
): boolean {
  return (
    print.piece === last.piece &&
    print.orientation === last.orientation &&
    print.look === last.look &&
    print.printer === last.printer &&
    print.paper === last.paper &&
    print.quantity === last.quantity &&
    print.fillSpares === last.fillSpares &&
    (print.chosenPerSheet ?? null) === last.perSheet &&
    print.backPage === last.backPage &&
    print.cropMarks === last.cropMarks &&
    print.callToAction === last.callToAction &&
    printSameOwnWords(
      printOwnWordsToSend(print.words, print.languages),
      last.customWords,
    ) &&
    print.languages.length === last.languages.length &&
    print.languages.every((locale, index) => locale === last.languages[index])
  )
}

/** Whether the choices on show are already the last print's: false before the read, and for a Portal never printed. */
export function printIsLastSet(
  print: PrintSharePrint | null,
  lastPrint: Readonly<{ settings: PrintLastSettings }> | null,
): boolean {
  return (
    print !== null && lastPrint !== null && printMatchesLast(print, lastPrint.settings)
  )
}

/** The sheets and pieces a print makes; a print shop's file is one page. */
export function printShareCount(
  print: PrintSharePrint,
): Readonly<{ sheets: number; pieces: number }> {
  const quantity = print.quantity ?? 1
  if (print.printer === 'print_shop') return { sheets: 1, pieces: 1 }
  return {
    sheets: printSheetCount(quantity, print.perSheet),
    pieces: printPieceCount(quantity, print.perSheet, print.fillSpares),
  }
}

/** The cue lines a print's bar carries: one per language, a lone long cue wrapped. */
function cueLinesOf(print: PrintSharePrint, tilePt: number): readonly string[] {
  const { cuePt } = PRINT_MEASURES[printRegionOf(print.paper)][print.piece]
  return printCueLines(
    print.languages.map((locale) => PRINT_SCAN_CUE[locale]),
    tilePt,
    cuePt,
    previewMeasurer,
  )
}

/** The tile the preview draws the code on, and why the server would refuse the print, if it would. */
export type PrintShareCheck = Readonly<{
  /** Null when the code cannot print on this piece at all. */
  tile: PrintTile | null
  refusal: PrintRefusal['code'] | null
}>

/**
 * The tile the file would print the code on, and why the server would refuse
 * the print: the offer's own rules and the code's, whether the cues fit the bar,
 * and the quantity. A refusal that is not the code's still leaves a tile, so the
 * preview keeps drawing the piece while the manager fixes the choice.
 */
export function printShareCheck(
  print: PrintSharePrint,
  code: PrintCodeFacts,
): PrintShareCheck {
  const tile = printChoiceTile(
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
  const { cuePt } = PRINT_MEASURES[printRegionOf(print.paper)][print.piece]
  if (!printCuesFit(cueLinesOf(print, tilePt), tilePt, cuePt, previewMeasurer)) {
    return { tile: tile.value, refusal: 'cue_does_not_fit' }
  }
  const quantityMissing = print.quantity === null && print.printer === 'my_printer'
  return { tile: tile.value, refusal: quantityMissing ? 'quantity_out_of_range' : null }
}
