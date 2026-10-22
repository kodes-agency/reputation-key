// "How to print" for the piece the manager has chosen: the few things a print
// shop or an office printer needs told, which the one-sentence advice
// (printKitPrintAdvice) has no room for. Copy only, per piece, so each line is
// tested as written.

import type { PrintKitChoice } from '#/shared/domain/portal-print-kit'

const ACTUAL_SIZE = 'Print at 100% (actual size), never “fit to page”.'

/** A table tent is a print shop's job: its sheet is taller than office paper. */
const TABLE_TENT: readonly string[] = [
  'Take the PDF to a print shop: the sheet is taller than A4 or Letter.',
  'Ask for 300–350 g matte or uncoated card, scored at the fold.',
  'Fold at the dashed marks, with the print on the outside.',
]

/**
 * What the chosen piece needs when it is printed. A counter card with two
 * languages is two pages, one per side, which only double-sided printing keeps
 * on one card; the long edge is the one a portrait card turns on.
 */
export function printKitHowToPrint(
  choice: Pick<PrintKitChoice, 'piece' | 'languages'>,
): readonly string[] {
  if (choice.piece === 'table_tent') return TABLE_TENT
  return [
    ACTUAL_SIZE,
    ...(choice.languages.length > 1
      ? [
          'With two languages the card has two pages: print double-sided, flipping on the long edge.',
        ]
      : []),
    'At a print shop, use 300–350 g matte card. At home, use card of 200 g or more.',
  ]
}
