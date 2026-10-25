// The final print's small marks (final design spec §5.4): the short rule between
// two languages, placed by its box like the words are placed by their ink. Pure
// and shared, so the PDF and the Share tab's preview draw the same mark in the
// same place. There are no stars: fixed rule NS (2026-10-25) removed the five
// outline stars the Counter card carried above its kicker.

import type { PrintFinalPiece } from './portal-print-final'
import {
  PRINT_FINAL_DISTANCES,
  PRINT_FINAL_RULE_LENGTH_PT,
} from './portal-print-final-measures'

/** The rule between two languages: its box, which is its ink. */
export function printFinalRule(piece: PrintFinalPiece) {
  return {
    widthPt: PRINT_FINAL_RULE_LENGTH_PT[piece],
    heightPt: PRINT_FINAL_DISTANCES.ruleThicknessPt,
  }
}
