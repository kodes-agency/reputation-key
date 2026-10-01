// The measures the preview needs that the PDF finds by measuring: the address
// and where the plate under the code ends up. The PDF measures its fonts; the
// preview cannot, so it estimates from the average width of a character, which
// is close enough to place a plate and a line.

import {
  BOTTOM_MARGIN_MM,
  PANEL_HEIGHT_MM,
  PANEL_WIDTH_MM,
  PLATE_ABOVE_ADDRESS_MM,
  PLATE_MM,
  SIDE_MARGIN_MM,
  TYPE_PT,
} from '#/shared/domain/portal-print-kit-layout'

/** Points in a millimetre, and the average advance of Ysabeau Office as a share of its size. */
const POINTS_PER_MM = 72 / 25.4
const AVERAGE_ADVANCE_EM = 0.47
const LINE_HEIGHT = 1.3
const SIZE_STEP_PT = 0.25

export type PreviewAddress = Readonly<{
  lines: readonly string[]
  sizePt: number
  heightMm: number
}>

const widthMm = (text: string, sizePt: number) =>
  (text.length * sizePt * AVERAGE_ADVANCE_EM) / POINTS_PER_MM

const lineWidthMm = PANEL_WIDTH_MM - 2 * SIDE_MARGIN_MM

function fitted(lines: readonly string[]): PreviewAddress {
  let sizePt: number = TYPE_PT.address
  const widest = () => Math.max(...lines.map((line) => widthMm(line, sizePt)))
  while (sizePt > TYPE_PT.addressMin && widest() > lineWidthMm) sizePt -= SIZE_STEP_PT
  const size = Math.max(sizePt, TYPE_PT.addressMin)
  return {
    lines,
    sizePt: size,
    heightMm: (lines.length * size * LINE_HEIGHT) / POINTS_PER_MM,
  }
}

/** The address on one line when it fits at a legible size, else on two, as the PDF does. */
export function previewAddress(address: string): PreviewAddress {
  const single = fitted([address])
  if (widthMm(address, single.sizePt) <= lineWidthMm) return single
  const cut = address.lastIndexOf('/') + 1
  return cut > 0 && cut < address.length
    ? fitted([address.slice(0, cut), address.slice(cut)])
    : single
}

/** Where the plate under the code starts, in millimetres from the top of the trim. */
export function previewPlateTopMm(address: PreviewAddress): number {
  return (
    PANEL_HEIGHT_MM -
    BOTTOM_MARGIN_MM -
    address.heightMm -
    PLATE_ABOVE_ADDRESS_MM -
    PLATE_MM
  )
}

/** Millimetres on a page of `pageWidthMm` as a share of the preview's width, in `cqw`. */
export function mmToContainerWidth(millimetres: number, pageWidthMm: number): string {
  return `${Number(((millimetres * 100) / pageWidthMm).toFixed(4))}cqw`
}
