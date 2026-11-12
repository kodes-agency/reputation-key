// What the Paper preview's sheets say: the caption of a Whole sheet preview,
// and the unit its lengths are drawn in.

/** Points on a face or sheet `widthPt` wide, as a share of its width, in `cqw`. */
export function ptToContainerWidth(points: number, widthPt: number): string {
  return `${Number(((points * 100) / widthPt).toFixed(4))}cqw`
}
