// The final print kit's vocabulary (final design spec, 2026-10-25, §1, §8 and
// §12 "Vocabulary"): three pieces, each upright or wide, in two looks, printed
// on the manager's own printer or by a print shop.
//
// This lives beside today's kit (`portal-print-kit.ts`) and replaces none of it
// yet: the Share tab shows the final kit only where PRINT_KIT_FINAL_ENABLED is
// on, and today's Large card and Letter-half tent keep printing unchanged until
// the release slice retires them. Pure and shared, like today's kit: the PDF and
// the Share tab's preview read the same words and the same measures.

import type { PrintKitPaper } from './portal-print-kit'

/**
 * The pieces: the Counter card (4 × 6 in, A6), the table tent's face
 * (2.75 × 4.25 in, A7) and the Small card (2 × 3.5 in, 85 × 54 mm).
 */
export const PRINT_FINAL_PIECES = Object.freeze(['counter', 'tent', 'small'] as const)
export type PrintFinalPiece = (typeof PRINT_FINAL_PIECES)[number]

/** Every piece comes both ways: upright (taller than wide) and wide (the upright trim turned a quarter). */
export const PRINT_FINAL_ORIENTATIONS = Object.freeze(['upright', 'wide'] as const)
export type PrintFinalOrientation = (typeof PRINT_FINAL_ORIENTATIONS)[number]

/**
 * The orientation Share selects first, per piece: the Counter card upright (it
 * fits the 4 × 6 in holders most counters use), the tent and the Small card wide.
 * The other orientation is one click away.
 */
export const PRINT_FINAL_DEFAULT_ORIENTATION: Readonly<
  Record<PrintFinalPiece, PrintFinalOrientation>
> = Object.freeze({ counter: 'upright', tent: 'wide', small: 'wide' })

/** The two looks: Paper is plain white with the accent on a few marks; Immersive is the guest page's photo fade. */
export const PRINT_FINAL_LOOKS = Object.freeze(['paper', 'immersive'] as const)
export type PrintFinalLook = (typeof PRINT_FINAL_LOOKS)[number]

/**
 * Who prints: the manager's own printer, from office sheets with several pieces
 * each (the default), or a print shop, from one piece per page.
 */
export const PRINT_FINAL_PRINTERS = Object.freeze(['my_printer', 'print_shop'] as const)
export type PrintFinalPrinter = (typeof PRINT_FINAL_PRINTERS)[number]

/**
 * The two measure sets. US pieces are drawn in inches for Letter; European
 * pieces in millimetres for A4 (A6, A7 and 85 × 54 mm).
 */
export type PrintFinalRegion = 'us' | 'eu'

/** The paper decides the region: Letter prints the US pieces, A4 the European ones. */
export const printFinalRegionOf = (paper: PrintKitPaper): PrintFinalRegion =>
  paper === 'letter' ? 'us' : 'eu'

/** The region's paper: the US pieces print on Letter, the European ones on A4. */
export const printFinalPaperOf = (region: PrintFinalRegion): PrintKitPaper =>
  region === 'us' ? 'letter' : 'a4'

/** One face as it is drawn: which piece, which way up, which look, which measure set. */
export type PrintFinalFace = Readonly<{
  piece: PrintFinalPiece
  orientation: PrintFinalOrientation
  look: PrintFinalLook
  region: PrintFinalRegion
}>

/**
 * How a face carries its languages (§8):
 *   - `one`: one language;
 *   - `stack`: both in full, the second under a short rule, its headline smaller;
 *   - `line`: the second headline as one small italic line under the first
 *     sub-line, and no second sub-line. The upright tent and the upright Small
 *     card take this, because both languages in full push their group gaps
 *     under 4u.
 */
export type PrintFinalLanguageMode = 'one' | 'stack' | 'line'

export function printFinalLanguageMode(
  face: Pick<PrintFinalFace, 'piece' | 'orientation'>,
  languageCount: number,
): PrintFinalLanguageMode {
  if (languageCount < 2) return 'one'
  return face.orientation === 'upright' && face.piece !== 'counter' ? 'line' : 'stack'
}

/**
 * The address a code carries (§9): `short` is a print address
 * (`HTTPS://AP.UP.RAILWAY.APP/p/<20>`, a version 3 symbol, or version 4 in the
 * lower-case fallback), `long` is today's 159-character address (version 9).
 * The symbol's own size decides the tile; the shape decides only what a
 * refusal tells the manager to do.
 */
export type PrintFinalAddress = 'short' | 'long'
