// "How to print" and the summaries of a final print (final design spec §11.6 to
// §11.8, the boards share-desktop-light, share-desktop-dark and share-phone):
// the cutting step each sheet takes, the numbered steps, the summary beside the
// download and in the phone's pinned bar, the preview's captions, the
// soft-photo notice, and the file's name. Copy only, in one place, so each line
// is tested as written.

import { fileNameSlug } from './file-name-slug'
import { GUEST_LOCALE_METADATA, type GuestLocale } from './guest-locale'
import type { PrintKitPaper } from './portal-print-kit'
import {
  printFinalLanguageMode,
  printFinalRegionOf,
  type PrintFinalLook,
  type PrintFinalOrientation,
  type PrintFinalPiece,
  type PrintFinalPrinter,
} from './portal-print-final'
import type { PrintFinalPhotoPixels } from './portal-print-final-photo'
import {
  PRINT_FINAL_PAPER_NAMES,
  PRINT_FINAL_PIECE_FACTS,
  printFinalSheetCutCount,
  printFinalSheetsLabel,
  printFinalTrimLabel,
} from './portal-print-final-share'
import { printFinalSheet } from './portal-print-final-immersive-sheets'
import { printFinalTileLabel } from './portal-print-final-sheet-notes'

/** A final print as Share describes it. */
export type PrintFinalDescribed = Readonly<{
  piece: PrintFinalPiece
  orientation: PrintFinalOrientation
  look: PrintFinalLook
  paper: PrintKitPaper
  printer: PrintFinalPrinter
  languages: readonly GuestLocale[]
}>

type SheetKey = Pick<PrintFinalDescribed, 'piece' | 'orientation' | 'look' | 'paper'>

/** One step of "How to print", with the phrase it sets in bold. */
export type PrintFinalHowToStep = Readonly<{ text: string; strong?: string }>

/** How a sheet is cut (and a tent folded), from its layout. */
export function printFinalCutStep(key: SheetKey): string {
  const { piece, orientation, look } = key
  if (look === 'immersive') {
    const cuts = printFinalSheetCutCount(key)
    const fold = piece === 'tent' ? ', score, then fold on the dashed marks' : ''
    return `Cut on the crop marks (${cuts} cuts a sheet)${fold}.`
  }
  if (piece === 'tent') {
    return orientation === 'upright'
      ? 'Cut the sheet in half, then each half in half: four strips. Fold each across its middle on the dashed marks.'
      : 'Cut the sheet in half each way, then fold each quarter on the dashed marks.'
  }
  // An A4 sheet of four Counter cards is quarters: its cuts are the sheet's halves, with no ticks.
  return printFinalSheet(key).kind === 'quarters'
    ? 'Cut the sheet in half each way.'
    : 'Cut on the grey ticks.'
}

const ACTUAL_SIZE = 'Actual size (100%)'

/** The cream square to measure: "1.4 in (3.6 cm)" on Letter, "36 mm" on A4. */
const tileStep = (tilePt: number, paper: PrintKitPaper): PrintFinalHowToStep => {
  const tile = printFinalTileLabel(tilePt, printFinalRegionOf(paper))
  return {
    text: `Check one code: its cream square should measure ${tile}. Smaller means scaling was on; print again.`,
    strong: tile,
  }
}

/**
 * The numbered steps. From the manager's own printer: print at Actual size, check
 * one code, then the cutting step; on a phone the first step says why to use a
 * computer. A print shop gets the file and the same check.
 */
export function printFinalHowToSteps(
  print: PrintFinalDescribed,
  tilePt: number,
  phone = false,
): readonly PrintFinalHowToStep[] {
  if (print.printer === 'print_shop') {
    return [
      {
        text: `Send the PDF to a print shop and ask for it at ${ACTUAL_SIZE}, one ${PRINT_FINAL_PIECE_FACTS[print.piece].one} per page.`,
        strong: ACTUAL_SIZE,
      },
      tileStep(tilePt, print.paper),
    ]
  }
  const phoneNote = phone ? ' Phone print screens often cannot turn scaling off.' : ''
  return [
    {
      text: `Print from a computer at ${ACTUAL_SIZE}, on card stock through the manual slot.${phoneNote}`,
      strong: ACTUAL_SIZE,
    },
    tileStep(tilePt, print.paper),
    { text: printFinalCutStep(print) },
  ]
}

/** "English + Español": the languages in their own words, in print order. */
export const printFinalLanguageNames = (languages: readonly GuestLocale[]): string =>
  languages.map((locale) => GUEST_LOCALE_METADATA[locale].nativeName).join(' + ')

/** The quantity the summary counts: "10 tents". */
export type PrintFinalCount = Readonly<{ sheets: number; pieces: number }>

/**
 * The summary beside the download: "3 sheets · 10 tents · wide · Letter · one
 * side · English + Español"; the first part is set in bold. A print shop's file
 * is one page. `phone` gives the pinned bar's shorter line.
 */
export function printFinalSummary(
  print: PrintFinalDescribed,
  count: PrintFinalCount,
  phone = false,
): Readonly<{ lead: string; rest: string }> {
  const { noun, one } = PRINT_FINAL_PIECE_FACTS[print.piece]
  const region = printFinalRegionOf(print.paper)
  if (print.printer === 'print_shop') {
    const size = printFinalTrimLabel(print.piece, print.orientation, region)
    const parts = [`one ${one} per page`, print.orientation, size]
    return {
      lead: '1 page',
      rest: [
        ...parts,
        ...(phone ? [] : ['one side', printFinalLanguageNames(print.languages)]),
      ].join(' · '),
    }
  }
  const parts = [
    `${count.pieces} ${count.pieces === 1 ? one : noun}`,
    print.orientation,
    PRINT_FINAL_PAPER_NAMES[print.paper],
  ]
  return {
    lead: printFinalSheetsLabel(count.sheets),
    rest: [
      ...parts,
      ...(phone ? [] : ['one side', printFinalLanguageNames(print.languages)]),
    ].join(' · '),
  }
}

/**
 * The preview's caption under the face: "Each face · 4.25 × 2.75 in" (in bold),
 * then "wide, shown smaller.", that a tent's faces match, that a second language
 * prints as one small line where it does, and the photo's resolution when it
 * prints sharp.
 */
export function printFinalFaceCaption(
  print: PrintFinalDescribed,
  sharpDpi: number | null,
): Readonly<{ lead: string; rest: string }> {
  const facts = PRINT_FINAL_PIECE_FACTS[print.piece]
  const size = printFinalTrimLabel(
    print.piece,
    print.orientation,
    printFinalRegionOf(print.paper),
  )
  const both = print.piece === 'tent' ? ' Both faces are the same.' : ''
  const [, second] = print.languages
  const line =
    second !== undefined &&
    printFinalLanguageMode(print, print.languages.length) === 'line'
      ? ` ${GUEST_LOCALE_METADATA[second].nativeName} prints as one small line on upright ${print.piece === 'tent' ? 'tents' : 'Small cards'}.`
      : ''
  const sharp =
    sharpDpi === null ? '' : ` Your photo prints at ${sharpDpi} dpi here: sharp.`
  return {
    lead: `${facts.faceName} · ${size}`,
    rest: `, ${print.orientation}, shown smaller.${both}${line}${sharp}`,
  }
}

/** Above the sheet: "Letter landscape · sheet 1 of 3". */
export function printFinalSheetHeading(key: SheetKey, sheets: number): string {
  const sheet = printFinalSheet(key)
  const paper = `${PRINT_FINAL_PAPER_NAMES[key.paper]}${sheet.landscape ? ' landscape' : ''}`
  return `${paper} · sheet 1 of ${sheets}`
}

/** Under the sheet: "4 tents per sheet. Cut the sheet in half each way, …". */
export function printFinalSheetCaption(key: SheetKey, perSheet: number): string {
  const { noun, one } = PRINT_FINAL_PIECE_FACTS[key.piece]
  return `${perSheet} ${perSheet === 1 ? one : noun} per sheet. ${printFinalCutStep(key)}`
}

/** The soft-photo notice (§11.7): its title and body; none from 200 dpi up. */
export type PrintFinalPhotoNotice = Readonly<{ title: string; body: string }>

const pixels = (count: number) => count.toLocaleString('en-US')

/**
 * The notice for a photo that prints at `dpi` in its box with bleed: "may look
 * soft" from 150 to 199 dpi, "will look soft" under 150, with the least photo
 * that prints sharp (200 dpi). Never a refusal.
 */
export function printFinalPhotoNotice(
  dpi: number,
  sharpPhoto: PrintFinalPhotoPixels,
): PrintFinalPhotoNotice | null {
  if (dpi >= 200) return null
  const will = dpi < 150
  const size = `${pixels(sharpPhoto.widthPx)} × ${pixels(sharpPhoto.heightPx)} px`
  const how = will
    ? 'Expect a blurry photo.'
    : 'Fine at arm’s length, not crisp up close.'
  return {
    title: `Your photo ${will ? 'will' : 'may'} look soft at this size`,
    body: `It prints at ${dpi} dpi here. ${how} A photo of at least ${size} prints sharp.`,
  }
}

const FILE_PIECES: Readonly<Record<PrintFinalPiece, string>> = {
  tent: 'table-tents',
  counter: 'counter-cards',
  small: 'small-cards',
}

/**
 * `reception-table-tents-wide-en-es-letter.pdf`: the portal, the piece and its
 * orientation, the languages in print order, then Immersive and a print shop
 * when chosen, and the paper. Two downloads that differ in any choice do not
 * share a name.
 */
export function printFinalFileName(
  portalName: string,
  print: PrintFinalDescribed,
): string {
  return (
    [
      fileNameSlug(portalName) || 'portal',
      FILE_PIECES[print.piece],
      print.orientation,
      ...print.languages,
      ...(print.look === 'immersive' ? ['immersive'] : []),
      ...(print.printer === 'print_shop' ? ['print-shop'] : []),
      print.paper,
    ].join('-') + '.pdf'
  )
}

/** The document's title, shown by a PDF viewer: "Reception table tents". */
export const printFinalDocumentTitle = (portalName: string, piece: PrintFinalPiece) =>
  `${portalName} ${PRINT_FINAL_PIECE_FACTS[piece].title.toLowerCase()}`
