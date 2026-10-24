// What a download may ask for once it names a size and an output, and the pages
// it prints on (round-3 spec-delta S1, S4 and S6; round-2 R4; plan OD3, OD4).
// Pure and shared: the server refuses what is not offered here before it reveals
// an address, and the PDF prints the pages this file picks.
//
//   - The old Letter-half tent is the `table_tent` at size Large and is unchanged
//     (OD3): Paper on an office printer, Immersive for a print shop. The small
//     tent (the `table_tent` at size Table) prints the same two ways: Paper two
//     to a landscape sheet, Immersive one to a page for a print shop; an
//     Immersive tent office sheet is not drawn (OD4). There is no Mini tent.
//   - A Mini card carries one language (S4).
//   - Paper prints on the customer's own printer, never as a print-shop file.
//   - Immersive Mini prints only for a print shop, one card per page with bleed:
//     an Immersive Mini office sheet is not drawn (OD4).

import type {
  PrintKitOutput,
  PrintKitPaper,
  PrintKitPiece,
  PrintKitSize,
  PrintKitStyle,
} from './portal-print-kit'
import {
  immersiveLargeOfficePages,
  immersiveTableOfficePages,
} from './portal-print-kit-office-sheets'
import { paperMiniPages, paperTablePages } from './portal-print-kit-size-sheets'
import {
  paperSmallTentPage,
  printShopSmallTentPage,
} from './portal-print-kit-tent-sheets'
import {
  printKitPages,
  printShopCardPages,
  type PrintKitPage,
} from './portal-print-kit-sheets'

export type PrintKitFormatChoice = Readonly<{
  piece: PrintKitPiece
  size: PrintKitSize
  style: PrintKitStyle
  output: PrintKitOutput
  languageCount: number
}>

/**
 * Why a choice cannot be printed, in words a manager can act on; null when it
 * can. Whether the size may be chosen at all is the caller's to check.
 */
export function printKitFormatProblem(choice: PrintKitFormatChoice): string | null {
  const { piece, size, style, output } = choice
  if (piece === 'table_tent') {
    if (size === 'mini') return 'There is no Mini table tent. Choose a card.'
    return output === (style === 'immersive' ? 'print_shop' : 'office')
      ? null
      : 'The table tent prints on your own printer in Paper, and at a print shop in Immersive.'
  }
  if (style === 'paper' && output !== 'office') {
    return 'Paper prints on your own printer. Choose Immersive for a print shop.'
  }
  if (size === 'mini' && choice.languageCount > 1) {
    return 'A Mini card prints one language. Choose one.'
  }
  if (size === 'mini' && style === 'immersive' && output === 'office') {
    return 'Immersive Mini cards print at a print shop, one card per page.'
  }
  return null
}

export type PrintKitSheetQuery = PrintKitFormatChoice &
  Readonly<{
    paper: PrintKitPaper
    /** How many faces the piece has (`printKitFaces`). */
    faceCount: number
    /** The code tile's width, which the office sheets' notes name. */
    tilePt: number
  }>

const cardPages: Readonly<
  Record<
    PrintKitSize,
    Readonly<
      Record<PrintKitStyle, (query: PrintKitSheetQuery) => readonly PrintKitPage[]>
    >
  >
> = {
  large: {
    paper: (query) =>
      printKitPages('counter_card', query.faceCount, 'paper', query.paper),
    immersive: (query) =>
      query.output === 'office'
        ? immersiveLargeOfficePages(query.faceCount, query.paper, query.tilePt)
        : printShopCardPages('large', query.faceCount, query.paper),
  },
  table: {
    paper: (query) => paperTablePages(query.faceCount, query.paper, query.tilePt),
    immersive: (query) =>
      query.output === 'office'
        ? immersiveTableOfficePages(query.faceCount, query.paper, query.tilePt)
        : printShopCardPages('table', query.faceCount, query.paper),
  },
  mini: {
    paper: (query) => paperMiniPages(query.faceCount, query.paper, query.tilePt),
    immersive: (query) => printShopCardPages('mini', query.faceCount, query.paper),
  },
}

/**
 * The pages a choice prints on. A choice `printKitFormatProblem` refuses has no
 * pages: asking for them is a bug, not a manager's mistake.
 */
export function printKitSheetPages(query: PrintKitSheetQuery): readonly PrintKitPage[] {
  const problem = printKitFormatProblem(query)
  if (problem !== null) throw new Error(`Not a printable choice: ${problem}`)
  if (query.piece === 'table_tent' && query.size === 'table') {
    return query.style === 'paper'
      ? [paperSmallTentPage(query.paper, query.tilePt)]
      : [printShopSmallTentPage(query.paper)]
  }
  if (query.piece === 'table_tent') {
    return printKitPages('table_tent', query.faceCount, query.style, query.paper)
  }
  return cardPages[query.size][query.style](query)
}
