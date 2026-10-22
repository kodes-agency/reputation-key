// What the Paper preview needs that the PDF finds by measuring: the type scale a
// card's words are set in, and the words for the sheet's caption. The PDF tries
// the full scale and steps two languages down once when the words do not fit
// (fit step c, spec 2.5); the preview makes the same choice from widths it
// estimates, since it cannot measure the fonts. The estimates err wide, so the
// preview never sets the words larger than the file prints them.
//
// Every measure is read from the files the PDF reads.

import type {
  PrintFace,
  PrintKitPaper,
  PrintKitPiece,
} from '#/shared/domain/portal-print-kit'
import {
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from '#/shared/domain/portal-print-kit-code-block'
import {
  CARD_GRID,
  CODE_BLOCK,
  FIT,
  MARGIN,
  STACK,
  TYPE_PT,
  WORDMARK,
} from '#/shared/domain/portal-print-kit-measures'
import type { PanelGeometry } from '#/shared/domain/portal-print-kit-sheets'
import { wrapWords } from '#/shared/domain/portal-print-kit-text'

export type PaperScale = 'two' | 'twoTight' | 'one' | 'tent'

/** The average advance of a character, in ems, of the display and body faces, erring wide. */
const ADVANCE_EM = { display: 0.5, body: 0.52 } as const

const linesHeight = (
  text: string,
  sizePt: number,
  leading: number,
  advanceEm: number,
  widthPt: number,
) =>
  wrapWords(text, widthPt, (line) => line.length * sizePt * advanceEm).length *
  sizePt *
  leading

/**
 * The estimated height of a face's words at `scale`, as the PDF stacks them:
 * with one language the rule sits between the place label and the call to
 * action, with two it sits between the two calls to action. `placeToHeadPt` is
 * the place block's gap when a fit step has tightened it.
 */
export function estimatedStackHeight(
  face: PrintFace,
  scale: PaperScale,
  widthPt: number,
  placeToHeadPt?: number,
): number {
  const [lead, second] = face.blocks
  if (lead === undefined) return 0
  const type: Readonly<Record<string, number>> = TYPE_PT[scale]
  const gaps: Readonly<{ rule: number; placeToHead?: number }> = STACK.gapsPt[scale]
  const { leading } = STACK
  const size = (key: string) => type[key] ?? 0
  const rule = 2 * gaps.rule + STACK.rule.weightPt
  const leadHeight =
    linesHeight(lead.kicker, size('place'), leading.place, ADVANCE_EM.display, widthPt) +
    linesHeight(lead.headline, size('head'), leading.head, ADVANCE_EM.display, widthPt) +
    STACK.subAbovePt +
    linesHeight(lead.subline, size('sub'), leading.sub, ADVANCE_EM.body, widthPt)
  if (second === undefined) return leadHeight + rule
  return (
    leadHeight +
    STACK.placeGapPt +
    linesHeight(second.kicker, size('place2'), leading.place2, ADVANCE_EM.body, widthPt) +
    (placeToHeadPt ?? gaps.placeToHead ?? 0) +
    rule +
    linesHeight(
      second.headline,
      size('head2'),
      leading.head2,
      ADVANCE_EM.display,
      widthPt,
    ) +
    STACK.sub2AbovePt +
    linesHeight(second.subline, size('sub2'), leading.sub2, ADVANCE_EM.body, widthPt)
  )
}

/**
 * The type scale of a Paper face's words: the tent's on a tent face, one
 * language's alone, and for two languages on a card the full scale unless the
 * words would not leave the two gaps their minimums.
 */
export function previewPaperScale(face: PrintFace, geometry: PanelGeometry): PaperScale {
  if (geometry !== 'card4x6' && geometry !== 'cardA6') return 'tent'
  if (face.blocks.length < 2) return 'one'
  const grid = CARD_GRID.paper[geometry === 'card4x6' ? 'letter' : 'a4']
  const code = planCodeBlock(
    cueLinesFor(face.blocks.map((block) => block.locale)),
    estimatedCueWidthPt,
  )
  const room =
    grid.heightPt -
    2 * grid.marginPt -
    CODE_BLOCK.outlinePt -
    code.heightPt -
    WORDMARK.pt * WORDMARK.lineBoxEm -
    FIT.paperGapPt.brand -
    FIT.paperGapPt.code +
    MARGIN.optical.wordmarkCapPt
  const width = grid.widthPt - 2 * grid.sidePt
  return estimatedStackHeight(face, 'two', width) <= room ? 'two' : 'twoTight'
}

const COUNTS = ['no', 'one', 'two', 'three', 'four'] as const

/**
 * What a Whole sheet preview shows, for its label: "Letter · two 4 × 6 in
 * counter cards · page 1 of 2, fronts" (spec 7.2).
 */
export function printKitSheetLabel(
  piece: PrintKitPiece,
  paper: PrintKitPaper,
  page: Readonly<{ index: number; count: number; faces: number }>,
): string {
  const sheet = paper === 'letter' ? 'Letter' : 'A4'
  if (piece === 'table_tent') {
    const faces = paper === 'letter' ? '8.5 × 5.5 in' : 'A5'
    return `${sheet} · table tent, folded in half to two ${faces} faces`
  }
  const card = paper === 'letter' ? '4 × 6 in' : 'A6'
  const side = page.index === 0 ? 'fronts' : 'backs'
  return `${sheet} · ${COUNTS[page.faces] ?? page.faces} ${card} counter cards · page ${page.index + 1} of ${page.count}, ${side}`
}

/** Points on a face or sheet `widthPt` wide, as a share of its width, in `cqw`. */
export function ptToContainerWidth(points: number, widthPt: number): string {
  return `${Number(((points * 100) / widthPt).toFixed(4))}cqw`
}
