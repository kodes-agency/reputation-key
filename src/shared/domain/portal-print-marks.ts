// The print's small marks (design spec §5.4): the short rule between
// two languages, placed by its box like the words are placed by their ink. Pure
// and shared, so the PDF and the Share tab's preview draw the same mark in the
// same place. There are no stars: fixed rule NS (2026-10-25) removed the five
// outline stars the Counter card carried above its kicker.

import type { PrintPiece } from './portal-print'
import { PRINT_DISTANCES, PRINT_RULE_LENGTH_PT } from './portal-print-measures'

/** The rule between two languages: its box, which is its ink. */
export function printRule(piece: PrintPiece) {
  return {
    widthPt: PRINT_RULE_LENGTH_PT[piece],
    heightPt: PRINT_DISTANCES.ruleThicknessPt,
  }
}
