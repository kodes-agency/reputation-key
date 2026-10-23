// What the Paper preview's sheets say: the caption of a Whole sheet preview,
// and the unit its lengths are drawn in. The fit a face's words are set at is
// chosen in `print-kit-preview-fit.ts`.

import type { PrintKitPaper, PrintKitPiece } from '#/shared/domain/portal-print-kit'

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
