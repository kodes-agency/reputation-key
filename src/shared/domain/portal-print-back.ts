// The optional back page of a card (design spec §10.4, slice 11):
// the logo, or the wordmark where there is none, and the property's name 2u
// below it, in the middle of the live area, 44 : 56 between the margins the
// front keeps, with no code. It is for holders a guest sees from both sides, so a
// property turns it on under More options; it is off by default. Counter cards
// and Small cards have one; a tent prints its front on both faces.
//
// Pure and shared, like the front's layout: the PDF measures the guest fonts'
// own outlines, the Share tab's preview estimates them, and both hand their
// measures to `layoutPrintBack`. The brand is the front's (`printBrandPart`),
// so the plate and the optical size agree between the two sides, and the parts
// are placed by their ink, as on the front (§2.3).

import type { PrintFace, PrintPiece } from './portal-print'
import type { PrintBrandBox } from './portal-print-brand'
import { printBrandPart, type PrintBrandInput } from './portal-print-face'
import { printBoxFits, printLiveArea, type PrintBox } from './portal-print-measures'
import { PRINT_SPARE_TOP_SHARE } from './portal-print-planners'
import {
  stackPrintGroup,
  type PrintPart,
  type PrintPlacedPart,
} from './portal-print-parts'
import {
  setPrintText,
  type PrintSetText,
  type PrintTextMeasurer,
} from './portal-print-text'
import { printNameStyle } from './portal-print-words'

/** Only the cards have a back page: a tent prints the front design on both faces. */
export const printHasBack = (piece: PrintPiece): boolean => piece !== 'tent'

/** The name wraps, balanced, no wider than this share of the trim: 80 % upright, 62 % wide (§10.4). */
const NAME_SHARE = Object.freeze({ upright: 0.8, wide: 0.62 })

/** What each part of a back page draws: the front's logo box or wordmark, and the name. */
export type PrintBackContent =
  | Readonly<{ kind: 'wordmark'; set: PrintSetText }>
  | Readonly<{ kind: 'logo'; box: PrintBrandBox }>
  | Readonly<{ kind: 'name'; set: PrintSetText }>

export type PrintBackPlan = Readonly<{
  face: PrintFace
  widthPt: number
  heightPt: number
  unitPt: number
  live: PrintBox
  /** The brand and the name, placed by their ink, from the trim's top-left corner. */
  parts: readonly PrintPlacedPart[]
  /** Where the ink as a whole sits; null when there is nothing to print. */
  block: PrintBox | null
  /** Every ink box fits the live area. */
  fits: boolean
}>

export type PrintBackLayout = Readonly<{
  plan: PrintBackPlan
  /** One per placed part, in the plan's order. */
  contents: readonly PrintBackContent[]
}>

export type PrintBackInput = Readonly<{
  /** The front's face: its piece, orientation, look and measure set decide the back's. */
  face: PrintFace
  /** The front's brand, plate decision included. */
  brand: PrintBrandInput
  propertyName: string
  measurer: PrintTextMeasurer
}>

const squash = (text: string): string => text.trim().replace(/\s+/gu, ' ').toLowerCase()

/**
 * The name line under the brand: the property's name as stored, or none where
 * it only says again what the wordmark has set (a property with no logo and no
 * wordmark of its own is its name).
 */
export function printBackName(
  brand: PrintBrandInput,
  propertyName: string,
): string | null {
  const name = propertyName.trim()
  if (name === '') return null
  if (brand.kind === 'wordmark' && squash(brand.text) === squash(name)) return null
  return name
}

type Built = Readonly<{
  parts: readonly PrintPart[]
  contents: readonly PrintBackContent[]
}>

function buildBack(input: PrintBackInput, liveWidthPt: number, widthPt: number): Built {
  const { face, brand, measurer } = input
  const logoOrWordmark = printBrandPart(brand, face, liveWidthPt, 'centre', measurer)
  const text = printBackName(brand, input.propertyName)
  const column = Math.min(liveWidthPt, NAME_SHARE[face.orientation] * widthPt)
  const name =
    text === null
      ? null
      : setPrintText(
          text,
          printNameStyle(face),
          column,
          'centre',
          measurer,
          'spaces-and-hyphens',
        )
  return {
    parts: [
      ...logoOrWordmark.parts,
      ...(name === null
        ? []
        : [{ key: 'name', widthPt: name.widthPt, heightPt: name.heightPt } as const]),
    ],
    contents: [
      ...logoOrWordmark.contents.flatMap((content) =>
        content.kind === 'logo' || content.kind === 'wordmark' ? [content] : [],
      ),
      ...(name === null ? [] : [{ kind: 'name', set: name } as const]),
    ],
  }
}

/**
 * Places a back page's parts (the brand, then the name), measured by their ink:
 * stacked on the page's centre line, the block placed 44 : 56 between the live
 * area's top and bottom. The planner never sees a font.
 */
export function planPrintBack(
  face: PrintFace,
  parts: readonly PrintPart[],
): PrintBackPlan {
  if (!printHasBack(face.piece)) {
    throw new RangeError('A tent has no back page: it prints its front on both faces')
  }
  const area = printLiveArea(face)
  const { live, unitPt } = area
  const stack = stackPrintGroup(parts, unitPt)
  const liveHeightPt = live.bottomPt - live.topPt
  const top =
    live.topPt + PRINT_SPARE_TOP_SHARE * Math.max(0, liveHeightPt - stack.heightPt)
  const axis = (live.leftPt + live.rightPt) / 2
  const placed = stack.parts.map(({ offsetPt, ...part }) => ({
    ...part,
    xPt: axis - part.widthPt / 2,
    yPt: top + offsetPt,
  }))
  return {
    face,
    widthPt: area.widthPt,
    heightPt: area.heightPt,
    unitPt,
    live,
    parts: placed,
    block:
      parts.length === 0
        ? null
        : {
            leftPt: axis - stack.widthPt / 2,
            topPt: top,
            rightPt: axis + stack.widthPt / 2,
            bottomPt: top + stack.heightPt,
          },
    fits: placed.every((part) =>
      printBoxFits(
        {
          leftPt: part.xPt,
          topPt: part.yPt,
          rightPt: part.xPt + part.widthPt,
          bottomPt: part.yPt + part.heightPt,
        },
        live,
      ),
    ),
  }
}

/** Lays a back page out: the brand and the name measured with the caller's fonts, then placed. */
export function layoutPrintBack(input: PrintBackInput): PrintBackLayout {
  const { face } = input
  const area = printLiveArea(face)
  const liveWidthPt = area.live.rightPt - area.live.leftPt
  const { parts, contents } = buildBack(input, liveWidthPt, area.widthPt)
  return { plan: planPrintBack(face, parts), contents }
}
