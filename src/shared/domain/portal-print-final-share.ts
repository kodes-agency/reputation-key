// What the Share tab's Print cards section says about each choice of the final
// print kit (final design spec §11, the boards share-desktop-light,
// share-desktop-dark and share-phone): each piece's card, the line of physics
// beside the orientation control, the facts under each look, the stock line,
// and how many sheets a quantity takes. Copy only, in one place, so each line is
// tested as written; the steps of "How to print" and the preview's captions are
// `portal-print-final-how-to.ts`.
//
// The words of the final kit: pieces are Table tents, Counter cards and Small
// cards, each upright or wide; never "Piece", "Output", "bleed" or the old size
// names.

import type { PrintKitPaper } from './portal-print-kit'
import {
  printFinalRegionOf,
  type PrintFinalLook,
  type PrintFinalOrientation,
  type PrintFinalPiece,
  type PrintFinalPrinter,
  type PrintFinalRegion,
} from './portal-print-final'
import { PRINT_FINAL_MEASURES } from './portal-print-final-measures'
import { PRINT_FINAL_PER_SHEET } from './portal-print-final-offer'
import { printFinalSheet } from './portal-print-final-immersive-sheets'
import { printFinalSheetCuts } from './portal-print-final-sheets'

export type PrintFinalPieceFacts = Readonly<{
  /** The radio card's title: "Table tents". */
  title: string
  /** Where the piece goes. */
  where: string
  /** What the manager counts: "tents", "cards". */
  noun: string
  /** One of them: "tent", "card". */
  one: string
  /** How the preview names one face: "Each face", "Counter card". */
  faceName: string
}>

export const PRINT_FINAL_PIECE_FACTS: Readonly<
  Record<PrintFinalPiece, PrintFinalPieceFacts>
> = Object.freeze({
  tent: {
    title: 'Table tents',
    where: 'Tables and nightstands',
    noun: 'tents',
    one: 'tent',
    faceName: 'Each face',
  },
  counter: {
    title: 'Counter cards',
    where: 'Reception or the bar, in a holder',
    noun: 'cards',
    one: 'card',
    faceName: 'Counter card',
  },
  small: {
    title: 'Small cards',
    where: 'Key-card sleeves, check folders',
    noun: 'cards',
    one: 'card',
    faceName: 'Small card',
  },
})

/** The order Share offers the pieces in, as the boards draw them. */
export const PRINT_FINAL_SHARE_PIECES: readonly PrintFinalPiece[] = Object.freeze([
  'tent',
  'counter',
  'small',
])

export const PRINT_FINAL_PAPER_NAMES: Readonly<Record<PrintKitPaper, string>> =
  Object.freeze({ letter: 'Letter', a4: 'A4' })

const trimmed = (value: number): number => Number(value.toFixed(2))

/** A size in the region's unit: "4 × 6 in", "105 × 148 mm". */
export function printFinalSizeLabel(
  widthPt: number,
  heightPt: number,
  region: PrintFinalRegion,
): string {
  if (region === 'us') return `${trimmed(widthPt / 72)} × ${trimmed(heightPt / 72)} in`
  return `${trimmed((widthPt / 72) * 25.4)} × ${trimmed((heightPt / 72) * 25.4)} mm`
}

/** A face's size in its orientation: "4 × 6 in", "6 × 4 in", "105 × 74.25 mm". */
export function printFinalTrimLabel(
  piece: PrintFinalPiece,
  orientation: PrintFinalOrientation,
  region: PrintFinalRegion,
): string {
  const { shortPt, longPt } = PRINT_FINAL_MEASURES[region][piece]
  return orientation === 'upright'
    ? printFinalSizeLabel(shortPt, longPt, region)
    : printFinalSizeLabel(longPt, shortPt, region)
}

/** A radio card's line: where it goes, its size in its current orientation, how many fit a sheet. */
export function printFinalPieceCardDetail(
  input: Readonly<{
    piece: PrintFinalPiece
    orientation: PrintFinalOrientation
    look: PrintFinalLook
    paper: PrintKitPaper
    printer: PrintFinalPrinter
  }>,
): string {
  const { piece, orientation, look, paper, printer } = input
  const facts = PRINT_FINAL_PIECE_FACTS[piece]
  const size = printFinalTrimLabel(piece, orientation, printFinalRegionOf(paper))
  const faces = piece === 'tent' ? ' faces' : ''
  if (printer === 'print_shop') {
    if (piece === 'tent') return `${facts.where} · from your own printer only`
    return `${facts.where} · ${size} · one per page`
  }
  const perSheet = PRINT_FINAL_PER_SHEET[piece][look][paper]
  return `${facts.where} · ${size}${faces} · ${perSheet} per sheet`
}

/** The line of physics beside the orientation control, per piece and orientation (US words, then Europe's). */
const ORIENTATION_NOTES: Readonly<
  Record<
    PrintFinalRegion,
    Readonly<Record<PrintFinalPiece, Readonly<Record<PrintFinalOrientation, string>>>>
  >
> = Object.freeze({
  us: {
    tent: {
      wide: 'Wide tents stand about 2.5 in tall. Upright ones stand 3.9 in and fold from a strip.',
      upright:
        'Upright tents stand about 3.9 in tall. A second language prints as one small line.',
    },
    counter: {
      upright:
        'Upright fits the 4 × 6 in holders most counters use. Wide needs a wide holder.',
      wide: 'Wide needs a 6 × 4 in holder.',
    },
    small: {
      wide: 'Wide fits card sleeves and stands. Upright stands loose or lies flat.',
      upright: 'No stock sleeve takes an upright Small card.',
    },
  },
  eu: {
    tent: {
      wide: 'Wide tents stand about 7 cm tall. Upright ones stand 10 cm and fold from a strip.',
      upright:
        'Upright tents stand about 10 cm tall. A second language prints as one small line.',
    },
    counter: {
      upright: 'Upright fits the A6 holders most counters use. Wide needs a wide holder.',
      wide: 'Wide needs a landscape A6 holder.',
    },
    small: {
      wide: 'Wide fits card sleeves and stands. Upright stands loose or lies flat.',
      upright: 'No stock sleeve takes an upright Small card.',
    },
  },
})

export const printFinalOrientationNote = (
  piece: PrintFinalPiece,
  orientation: PrintFinalOrientation,
  paper: PrintKitPaper,
): string => ORIENTATION_NOTES[printFinalRegionOf(paper)][piece][orientation]

/** The cuts a full office sheet takes: every line between pieces that is not the sheet's own edge. */
export function printFinalSheetCutCount(
  key: Readonly<{
    piece: PrintFinalPiece
    orientation: PrintFinalOrientation
    look: PrintFinalLook
    paper: PrintKitPaper
  }>,
): number {
  const sheet = printFinalSheet(key)
  const cuts = printFinalSheetCuts(sheet, sheet.cells)
  return cuts.xsPt.length + cuts.ysPt.length
}

/**
 * What each look says under its name. The chosen look gives the whole sheet
 * (how many, and how a Paper tent sheet is cut, or how many cuts an Immersive
 * sheet takes); the other look says only how many it fits and what it costs.
 */
export function printFinalLookFacts(
  look: PrintFinalLook,
  chosen: Readonly<{
    piece: PrintFinalPiece
    orientation: PrintFinalOrientation
    look: PrintFinalLook
    paper: PrintKitPaper
  }>,
): string {
  const { piece, orientation, paper } = chosen
  const { noun } = PRINT_FINAL_PIECE_FACTS[piece]
  const perSheet = PRINT_FINAL_PER_SHEET[piece][look][paper]
  const isChosen = look === chosen.look
  if (look === 'paper') {
    if (!isChosen || piece !== 'tent')
      return `White, little ink. ${perSheet} ${noun} a sheet.`
    const cut = orientation === 'upright' ? 'cut into strips' : 'cut in half each way'
    return `White, little ink. ${perSheet} ${noun} a sheet, ${cut}.`
  }
  if (!isChosen)
    return `Your photo, like your guest page. ${perSheet} ${noun} a sheet, more toner.`
  const cuts = printFinalSheetCutCount({ piece, orientation, look, paper })
  return `Your photo, like your guest page. ${perSheet} ${noun} a sheet, ${cuts} cuts, more toner.`
}

/** "the United States": the countries English names with "the". */
const WITH_THE = new Set(['US', 'GB', 'NL', 'PH', 'AE', 'DO', 'BS', 'CZ', 'GM', 'MV'])

/** The country in English, as a sentence names it: "the United States", "Bulgaria". */
export function printFinalCountryName(countryCode: string): string | null {
  const code = countryCode.toUpperCase()
  if (!/^[A-Z]{2}$/u.test(code) || code === 'ZZ') return null
  let name: string | undefined
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(code)
  } catch {
    return null
  }
  if (name === undefined || name === code) return null
  return WITH_THE.has(code) ? `the ${name}` : name
}

/** What a print puts on its pages: "one side", or "both sides" with a back page. */
export const printFinalSides = (backPage: boolean | undefined): string =>
  backPage === true ? 'both sides' : 'one side'

const STOCK: Readonly<Record<PrintFinalRegion, string>> = {
  us: 'Card stock, 65–80 lb cover (176–216 g/m²)',
  eu: 'Card, 160–220 g/m²',
}

const SHOP_TENTS: Readonly<Record<PrintFinalRegion, string>> = {
  us: 'Print shops sell tents from 4 × 6 in, so for a shop choose Counter cards.',
  eu: 'Print shops sell tents from A6, so for a shop choose Counter cards.',
}

/**
 * Why the paper is this one, as a sentence with its leading space: "Letter
 * because your property is in the United States." Empty for a paper the manager
 * chose against the country's, or for a country English has no name for.
 */
export function printFinalPaperReason(
  input: Readonly<{
    paper: PrintKitPaper
    countryPaper: PrintKitPaper
    countryCode: string | null
  }>,
): string {
  const country =
    input.countryCode === null ? null : printFinalCountryName(input.countryCode)
  return country !== null && input.paper === input.countryPaper
    ? ` ${PRINT_FINAL_PAPER_NAMES[input.paper]} because your property is in ${country}.`
    : ''
}

/**
 * The one stock line under "Who prints it?": the card to use (matte for
 * Immersive), why the paper is this one, and what a print shop gets. A paper the
 * manager chose against the country's is not explained.
 */
export function printFinalStockLine(
  input: Readonly<{
    piece: PrintFinalPiece
    look: PrintFinalLook
    paper: PrintKitPaper
    /** The paper the property's country prints on. */
    countryPaper: PrintKitPaper
    countryCode: string | null
    /** The optional back page: both sides are printed. */
    backPage?: boolean
  }>,
): string {
  const { piece, look, paper } = input
  const region = printFinalRegionOf(paper)
  const sides = printFinalSides(input.backPage)
  const stock = `${STOCK[region]}${look === 'immersive' ? ', matte' : ''}, ${sides}, through the manual slot.`
  const because = printFinalPaperReason(input)
  const shop =
    piece === 'tent'
      ? SHOP_TENTS[region]
      : 'A print shop gets one card per page, with print margins added.'
  return `${stock}${because} ${shop}`
}

const plural = (count: number, one: string, many = `${one}s`) =>
  count === 1 ? one : many

/** "3 sheets": the sheets a quantity takes at this many a sheet. */
export const printFinalSheetsLabel = (sheets: number): string =>
  `${sheets} ${plural(sheets, 'sheet')}`

/**
 * Under "Fill the last sheet with spares", or in its place when the quantity
 * fills its sheets: what the last sheet holds and what spares would make it.
 */
export function printFinalSparesNote(
  quantity: number,
  perSheet: number,
): Readonly<{ spares: number; note: string }> {
  const sheets = Math.ceil(quantity / perSheet)
  const last = quantity - (sheets - 1) * perSheet
  const spares = perSheet - last
  if (spares === 0) {
    return { spares, note: `Fills ${printFinalSheetsLabel(sheets)} exactly.` }
  }
  const spaces = plural(spares, 'space')
  const print = spares === 1 ? 'prints' : 'print'
  return {
    spares,
    note: `The last sheet has ${last}; without spares its other ${spares} ${spaces} ${print} nothing. Spares make it ${quantity + spares}.`,
  }
}
