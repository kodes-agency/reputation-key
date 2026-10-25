// What the Share tab says about the optional back page (final design spec §10.4
// and §11.5): the option under More options, the sides a print has, the step of
// "How to print" that turns a sheet over, and the preview's words for the back.
// Copy only, in one place, so each line is tested as written; the rest of the
// final print's copy is `portal-print-final-share.ts` and `-how-to.ts`.

import type { PrintKitPaper } from './portal-print-kit'
import {
  printFinalRegionOf,
  type PrintFinalOrientation,
  type PrintFinalPiece,
} from './portal-print-final'
import { PRINT_FINAL_PIECE_FACTS, printFinalTrimLabel } from './portal-print-final-share'

/** The option's label under More options: a checkbox like the spares, a choice for this print and not a saved setting. */
export const PRINT_FINAL_BACK_LABEL = 'Print a back page'

export const PRINT_FINAL_BACK_HELP =
  'The logo and the property name on the back, for a holder guests see from both sides. No code on it.'

/** The side of the card the preview shows. */
export type PrintFinalSide = 'front' | 'back'

/**
 * The step that turns a sheet over, for the manager's own printer: every back
 * is the page after its front. Without a two-sided setting the manager feeds a
 * sheet back in by hand, so a plain-paper try comes first. Printers name the
 * flip by an edge of the paper, and the edge a landscape sheet needs can differ
 * from a portrait one's, so a back that comes out upside down asks for the
 * other edge.
 */
export const PRINT_FINAL_BACK_SHEET_STEP =
  'Print both sides, turning each sheet over like the page of a book; every back is the page after its front. Without a two-sided setting, print page 1, put the sheet back in turned over, then print page 2. Try plain paper first: if a back comes out upside down, flip on the other edge.'

/** What a print shop is asked for: the front on page 1 and the back on page 2. */
export const PRINT_FINAL_BACK_SHOP_PAGES = 'the front on page 1 and the back on page 2'

/** The preview's caption under the back: "Counter card back · 4 × 6 in", then what is on it. */
export function printFinalBackCaption(
  print: Readonly<{
    piece: PrintFinalPiece
    orientation: PrintFinalOrientation
    paper: PrintKitPaper
  }>,
): Readonly<{ lead: string; rest: string }> {
  const size = printFinalTrimLabel(
    print.piece,
    print.orientation,
    printFinalRegionOf(print.paper),
  )
  return {
    lead: `${PRINT_FINAL_PIECE_FACTS[print.piece].faceName} back · ${size}`,
    rest: `, ${print.orientation}, shown smaller. The logo and the property name, with no code.`,
  }
}

/** Under the back sheet: where the backs sit, and that the cuts are made from the front. */
export const PRINT_FINAL_BACK_SHEET_CAPTION =
  'Each back sits behind its front when the sheet is turned over like the page of a book. Cut from the front, on its marks.'
