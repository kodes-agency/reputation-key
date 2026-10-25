// What a final face paints its words, marks and code in (final design spec §3,
// §5.2, §5.4 and §6.3), whichever look it is: Paper's ink, soft text and accent
// ink with the tile's outline; Immersive's white, off-white and kicker tint,
// with no outline. The PDF and the Share tab's preview draw from these.

import type { PrintFinalTone } from './portal-print-final-words'
import {
  PRINT_FINAL_IMMERSIVE_TYPE,
  type PrintFinalImmersivePalette,
} from './portal-print-final-immersive'
import type { PaperPrintKitPalette } from './portal-print-kit-palette'

export type PrintFinalColours = Readonly<{
  /** The headlines and the wordmark. */
  ink: string
  /** The sub-lines and the second-language line. */
  soft: string
  /** The kicker and the rule between two languages. */
  accent: string
  /** The tile's outline; null where there is none (Immersive). */
  outline: string | null
  barFill: string
  barText: string
}>

export function printFinalPaperColours(palette: PaperPrintKitPalette): PrintFinalColours {
  return {
    ink: palette.ink,
    soft: palette.soft,
    accent: palette.accentInk,
    outline: palette.accentInk,
    barFill: palette.barFill,
    barText: palette.barText,
  }
}

export function printFinalImmersiveColours(
  palette: PrintFinalImmersivePalette,
): PrintFinalColours {
  return {
    ink: PRINT_FINAL_IMMERSIVE_TYPE.headline,
    soft: PRINT_FINAL_IMMERSIVE_TYPE.soft,
    accent: palette.kicker,
    outline: null,
    barFill: palette.barFill,
    barText: palette.barText,
  }
}

/** A word's colour, by its tone. */
export const printFinalToneColour = (
  colours: PrintFinalColours,
  tone: PrintFinalTone,
): string => ({ ink: colours.ink, soft: colours.soft, accent: colours.accent })[tone]
