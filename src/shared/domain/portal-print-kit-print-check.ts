// The print check on the Letter card sheet (spec 4.3): the block in the strip
// under the two Large cards, which is cut away, whose bar measures the code tile
// when the sheet was printed at Actual size. Pure and shared; the sheets
// (`portal-print-kit-sheets.ts`) say which page carries it.

import { CODE_BLOCK, inToPt, ptToIn, ptToMm } from './portal-print-kit-measures'

/**
 * The print check in the strip under the Letter cards, which is cut away: a
 * question, a bar exactly as wide as the bar under each code, and two lines on
 * what to measure and where to cut (spec 4.3). Its text may be smaller than what
 * a guest reads, because no guest reads it.
 */
export const PRINT_CHECK = {
  /** The top of the block, and the column it is centred in. */
  topPt: inToPt(6.7),
  centreXPt: inToPt(4.25),
  widthPt: inToPt(5.5),
  /** Between the question, the bar and the lines. */
  gapPt: inToPt(0.09),
  title: { text: 'Printed at Actual size?', sizePt: 9, leading: 1.2 },
  bar: { widthPt: CODE_BLOCK.tilePt, heightPt: inToPt(0.14) },
  lines: {
    text: [
      'The bar under each code and this bar both measure 2 in (5.1 cm).',
      'Cut down on the three ticks, then across 6 in from the top edge.',
    ],
    sizePt: 8,
    leading: 1.35,
  },
} as const

/** A tile's width as the print check names it: "2 in (5.1 cm)", "1.75 in (4.4 cm)". */
function tileMeasureText(tilePt: number): string {
  const inches = Number(ptToIn(tilePt).toFixed(2))
  return `${inches} in (${(ptToMm(tilePt) / 10).toFixed(1)} cm)`
}

/**
 * The print check's two lines for a card whose code sits on a tile `tilePt`
 * wide: the bar it draws is that wide, and so is the bar under each code. Today's
 * 2 in tile gives the lines of `PRINT_CHECK`.
 */
export function printCheckLines(tilePt: number): readonly string[] {
  const [, cut = ''] = PRINT_CHECK.lines.text
  return [
    `The bar under each code and this bar both measure ${tileMeasureText(tilePt)}.`,
    cut,
  ]
}
