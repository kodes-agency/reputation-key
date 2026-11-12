// "How to print" and the summaries of a print (design spec §11.6 to
// §11.8, the boards share-desktop-light, share-desktop-dark and share-phone):
// the cutting step each sheet takes, the numbered steps, the summary beside the
// download and in the phone's pinned bar, the preview's captions, the
// soft-photo notice, and the file's name. Copy only, in one place, so each line
// is tested as written.

import { fileNameSlug } from './file-name-slug'
import { GUEST_LOCALE_METADATA, type GuestLocale } from './guest-locale'
import type { PrintKitPaper } from './portal-print-kit'
import {
  printLanguageMode,
  printRegionOf,
  type PrintLook,
  type PrintOrientation,
  type PrintPiece,
  type PrintPrinter,
} from './portal-print'
import {
  PRINT_BACK_SHEET_CAPTION,
  PRINT_BACK_SHEET_STEP,
  PRINT_BACK_SHOP_PAGES,
} from './portal-print-back-copy'
import type { PrintPhotoPixels } from './portal-print-photo'
import {
  PRINT_PAPER_NAMES,
  PRINT_PIECE_FACTS,
  printSheetCutCount,
  printSheetsLabel,
  printSides,
  printTrimLabel,
} from './portal-print-share'
import { printSheet } from './portal-print-immersive-sheets'
import { printTileLabel } from './portal-print-sheet-notes'

/** A print as Share describes it. */
export type PrintDescribed = Readonly<{
  piece: PrintPiece
  orientation: PrintOrientation
  look: PrintLook
  paper: PrintKitPaper
  printer: PrintPrinter
  languages: readonly GuestLocale[]
  /** The optional back page (cards only); off when absent. */
  backPage?: boolean
  /** A print shop's crop marks (More options); off when absent, and ignored from the manager's own printer. */
  cropMarks?: boolean
}>

type SheetKey = Pick<PrintDescribed, 'piece' | 'orientation' | 'look' | 'paper'>

/** One step of "How to print", with the phrase it sets in bold. */
export type PrintHowToStep = Readonly<{ text: string; strong?: string }>

/** How a sheet is cut (and a tent folded), from its layout. */
export function printCutStep(key: SheetKey): string {
  const { piece, orientation, look } = key
  if (look === 'immersive') {
    const cuts = printSheetCutCount(key)
    const fold = piece === 'tent' ? ', score, then fold on the dashed marks' : ''
    return `Cut on the crop marks (${cuts} cuts a sheet)${fold}.`
  }
  if (piece === 'tent') {
    return orientation === 'upright'
      ? 'Cut the sheet in half, then each half in half: four strips. Fold each across its middle on the dashed marks.'
      : 'Cut the sheet in half each way, then fold each quarter on the dashed marks.'
  }
  // An A4 sheet of four Counter cards is quarters: its cuts are the sheet's halves, with no ticks.
  return printSheet(key).kind === 'quarters'
    ? 'Cut the sheet in half each way.'
    : 'Cut on the grey ticks.'
}

const ACTUAL_SIZE = 'Actual size (100%)'

/**
 * The cream square to measure: "1.4 in (3.6 cm)" on Letter, "36 mm" on A4. A
 * print shop's check is on its proof, and a small square asks the shop to print again.
 */
const tileStep = (
  tilePt: number,
  paper: PrintKitPaper,
  shop: boolean,
): PrintHowToStep => {
  const tile = printTileLabel(tilePt, printRegionOf(paper))
  return shop
    ? {
        text: `Check the proof: one code’s cream square should measure ${tile}. Smaller means scaling was on; ask the shop to print again.`,
        strong: tile,
      }
    : {
        text: `Check one code: its cream square should measure ${tile}. Smaller means scaling was on; print again.`,
        strong: tile,
      }
}

/**
 * The numbered steps. From the manager's own printer: print at Actual size, check
 * one code, then the cutting step; on a phone the first step says why to use a
 * computer. A print shop gets the file and a check on its proof.
 */
export function printHowToSteps(
  print: PrintDescribed,
  tilePt: number,
  phone = false,
): readonly PrintHowToStep[] {
  const back = print.backPage === true
  if (print.printer === 'print_shop') {
    const pages = back ? `, ${PRINT_BACK_SHOP_PAGES}` : ''
    return [
      {
        text: `Send the PDF to a print shop and ask for it at ${ACTUAL_SIZE}, one ${PRINT_PIECE_FACTS[print.piece].one} per page${pages}.`,
        strong: ACTUAL_SIZE,
      },
      tileStep(tilePt, print.paper, true),
    ]
  }
  const phoneNote = phone ? ' Phone print screens often cannot turn scaling off.' : ''
  return [
    {
      text: `Print from a computer at ${ACTUAL_SIZE}, on card stock through the manual slot.${phoneNote}`,
      strong: ACTUAL_SIZE,
    },
    ...(back ? [{ text: PRINT_BACK_SHEET_STEP }] : []),
    tileStep(tilePt, print.paper, false),
    { text: printCutStep(print) },
  ]
}

/** "English + Español": the languages in their own words, in print order. */
export const printLanguageNames = (languages: readonly GuestLocale[]): string =>
  languages.map((locale) => GUEST_LOCALE_METADATA[locale].nativeName).join(' + ')

/** The quantity the summary counts: "10 tents". */
export type PrintCount = Readonly<{ sheets: number; pieces: number }>

/**
 * The summary beside the download: "3 sheets · 10 tents · wide · Letter · one
 * side · English + Español"; the first part is set in bold. A card with a back
 * page says "both sides". A print shop's file is one page (two with a back).
 * `phone` gives the pinned bar's shorter line.
 */
export function printSummary(
  print: PrintDescribed,
  count: PrintCount,
  phone = false,
): Readonly<{ lead: string; rest: string }> {
  const { noun, one } = PRINT_PIECE_FACTS[print.piece]
  const region = printRegionOf(print.paper)
  if (print.printer === 'print_shop') {
    const size = printTrimLabel(print.piece, print.orientation, region)
    const parts = [
      `one ${one} per page`,
      print.orientation,
      size,
      ...(print.cropMarks === true ? ['crop marks'] : []),
    ]
    return {
      lead: print.backPage === true ? '2 pages' : '1 page',
      rest: [
        ...parts,
        ...(phone
          ? []
          : [printSides(print.backPage), printLanguageNames(print.languages)]),
      ].join(' · '),
    }
  }
  const parts = [
    `${count.pieces} ${count.pieces === 1 ? one : noun}`,
    print.orientation,
    PRINT_PAPER_NAMES[print.paper],
  ]
  return {
    lead: printSheetsLabel(count.sheets),
    rest: [
      ...parts,
      ...(phone ? [] : [printSides(print.backPage), printLanguageNames(print.languages)]),
    ].join(' · '),
  }
}

/**
 * The preview's caption under the face: "Each face · 4.25 × 2.75 in" (in bold),
 * then "wide, shown smaller.", that a tent's faces match, that a second language
 * prints as one small line where it does, and the photo's resolution when it
 * prints sharp.
 */
export function printFaceCaption(
  print: PrintDescribed,
  sharpDpi: number | null,
): Readonly<{ lead: string; rest: string }> {
  const facts = PRINT_PIECE_FACTS[print.piece]
  const size = printTrimLabel(print.piece, print.orientation, printRegionOf(print.paper))
  const both = print.piece === 'tent' ? ' Both faces are the same.' : ''
  const [, second] = print.languages
  const line =
    second !== undefined && printLanguageMode(print, print.languages.length) === 'line'
      ? ` ${GUEST_LOCALE_METADATA[second].nativeName} prints as one small line on upright ${print.piece === 'tent' ? 'tents' : 'Small cards'}.`
      : ''
  const sharp =
    sharpDpi === null ? '' : ` Your photo prints at ${sharpDpi} dpi here: sharp.`
  return {
    lead: `${facts.faceName} · ${size}`,
    rest: `, ${print.orientation}, shown smaller.${both}${line}${sharp}`,
  }
}

/** Above the sheet: "Letter landscape · sheet 1 of 3", or "… · back of sheet 1 of 3". */
export function printSheetHeading(key: SheetKey, sheets: number, back = false): string {
  const sheet = printSheet(key)
  const paper = `${PRINT_PAPER_NAMES[key.paper]}${sheet.landscape ? ' landscape' : ''}`
  return `${paper} · ${back ? 'back of ' : ''}sheet 1 of ${sheets}`
}

/**
 * Under the sheet: "4 tents per sheet. Cut the sheet in half each way, …". Under
 * the back of a sheet: where the backs sit, and that the cuts are made from the front.
 */
export function printSheetCaption(key: SheetKey, perSheet: number, back = false): string {
  const { noun, one } = PRINT_PIECE_FACTS[key.piece]
  const count = `${perSheet} ${perSheet === 1 ? one : noun} per sheet.`
  return back ? `${count} ${PRINT_BACK_SHEET_CAPTION}` : `${count} ${printCutStep(key)}`
}

/** The soft-photo notice (§11.7): its title and body; none from 200 dpi up. */
export type PrintPhotoNotice = Readonly<{ title: string; body: string }>

const pixels = (count: number) => count.toLocaleString('en-US')

/**
 * The notice for a photo that prints at `dpi` in its box with bleed: "may look
 * soft" from 150 to 199 dpi, "will look soft" under 150, with the least photo
 * that prints sharp (200 dpi). Never a refusal.
 */
export function printPhotoNotice(
  dpi: number,
  sharpPhoto: PrintPhotoPixels,
): PrintPhotoNotice | null {
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

const FILE_PIECES: Readonly<Record<PrintPiece, string>> = {
  tent: 'table-tents',
  counter: 'counter-cards',
  small: 'small-cards',
}

/**
 * `reception-table-tents-wide-en-es-letter.pdf`: the portal, the piece and its
 * orientation, the languages in print order, then Immersive, a print shop (and
 * its crop marks) and a back page when chosen, and the paper. Two downloads that
 * differ in any choice do not share a name.
 */
export function printFileName(
  portalName: string,
  print: PrintDescribed,
  personalName?: string,
): string {
  if (personalName !== undefined) {
    const name =
      personalName
        .normalize('NFKC')
        .replace(/[<>:"/\\|?*]/g, '')
        .split('')
        .filter((character) => character.charCodeAt(0) >= 32)
        .join('')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 100) || 'Staff'
    return `${name} - ${PRINT_PIECE_FACTS[print.piece].title}.pdf`
  }
  return (
    [
      fileNameSlug(portalName) || 'portal',
      FILE_PIECES[print.piece],
      print.orientation,
      ...print.languages,
      ...(print.look === 'immersive' ? ['immersive'] : []),
      ...(print.printer === 'print_shop'
        ? ['print-shop', ...(print.cropMarks === true ? ['crop-marks'] : [])]
        : []),
      ...(print.backPage === true ? ['back'] : []),
      print.paper,
    ].join('-') + '.pdf'
  )
}

/** The document's title, shown by a PDF viewer: "Reception table tents". */
export const printDocumentTitle = (portalName: string, piece: PrintPiece) =>
  `${portalName} ${PRINT_PIECE_FACTS[piece].title.toLowerCase()}`
