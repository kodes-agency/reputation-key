// The optional back page of a final card (final design spec §10.4, slice 11):
// the logo, or the wordmark where there is none, and the property's name 2u
// below it, in the middle of the live area, 44 : 56 between the margins the
// front keeps, with no code. It is for holders a guest sees from both sides, so a
// property turns it on under More options; it is off by default. Counter cards
// and Small cards have one; a tent prints its front on both faces.
//
// Pure and shared, like the front's layout: the PDF measures the guest fonts'
// own outlines, the Share tab's preview estimates them, and both hand their
// measures to `layoutPrintFinalBack`. The brand is the front's (`printFinalBrandPart`),
// so the plate and the optical size agree between the two sides, and the parts
// are placed by their ink, as on the front (§2.3).

import type { PrintFinalFace, PrintFinalPiece } from './portal-print-final'
import type { PrintFinalBrandBox } from './portal-print-final-brand'
import { printFinalBrandPart, type PrintFinalBrandInput } from './portal-print-final-face'
import {
  mmPt,
  printFinalLiveArea,
  type PrintFinalBox,
} from './portal-print-final-measures'
import { PRINT_FINAL_SPARE_TOP_SHARE } from './portal-print-final-planners'
import {
  stackPrintFinalGroup,
  type PrintFinalPart,
  type PrintFinalPlacedPart,
} from './portal-print-final-parts'
import {
  setPrintFinalText,
  type PrintFinalSetText,
  type PrintFinalTextMeasurer,
} from './portal-print-final-text'
import { printFinalNameStyle } from './portal-print-final-words'

/** Only the cards have a back page: a tent prints the front design on both faces. */
export const printFinalHasBack = (piece: PrintFinalPiece): boolean => piece !== 'tent'

/** The name wraps, balanced, no wider than this share of the trim: 80 % upright, 62 % wide (§10.4). */
const NAME_SHARE = Object.freeze({ upright: 0.8, wide: 0.62 })

/** What each part of a back page draws: the front's logo box or wordmark, and the name. */
export type PrintFinalBackContent =
  | Readonly<{ kind: 'wordmark'; set: PrintFinalSetText }>
  | Readonly<{ kind: 'logo'; box: PrintFinalBrandBox }>
  | Readonly<{ kind: 'name'; set: PrintFinalSetText }>

export type PrintFinalBackPlan = Readonly<{
  face: PrintFinalFace
  widthPt: number
  heightPt: number
  unitPt: number
  live: PrintFinalBox
  /** The brand and the name, placed by their ink, from the trim's top-left corner. */
  parts: readonly PrintFinalPlacedPart[]
  /** Where the ink as a whole sits; null when there is nothing to print. */
  block: PrintFinalBox | null
  /** The block fits the live height. */
  fits: boolean
}>

export type PrintFinalBackLayout = Readonly<{
  plan: PrintFinalBackPlan
  /** One per placed part, in the plan's order. */
  contents: readonly PrintFinalBackContent[]
}>

export type PrintFinalBackInput = Readonly<{
  /** The front's face: its piece, orientation, look and measure set decide the back's. */
  face: PrintFinalFace
  /** The front's brand, plate decision included. */
  brand: PrintFinalBrandInput
  propertyName: string
  measurer: PrintFinalTextMeasurer
}>

const squash = (text: string): string => text.trim().replace(/\s+/gu, ' ').toLowerCase()

/**
 * The name line under the brand: the property's name as stored, or none where
 * it only says again what the wordmark has set (a property with no logo and no
 * wordmark of its own is its name).
 */
export function printFinalBackName(
  brand: PrintFinalBrandInput,
  propertyName: string,
): string | null {
  const name = propertyName.trim()
  if (name === '') return null
  if (brand.kind === 'wordmark' && squash(brand.text) === squash(name)) return null
  return name
}

/** A block taller than the live area by less than this still fits: the rounding the front's planner allows too (§5.3). */
const FIT_TOLERANCE_PT = mmPt(0.05)

type Built = Readonly<{
  parts: readonly PrintFinalPart[]
  contents: readonly PrintFinalBackContent[]
}>

function buildBack(
  input: PrintFinalBackInput,
  liveWidthPt: number,
  widthPt: number,
): Built {
  const { face, brand, measurer } = input
  const logoOrWordmark = printFinalBrandPart(brand, face, liveWidthPt, 'centre', measurer)
  const text = printFinalBackName(brand, input.propertyName)
  const column = Math.min(liveWidthPt, NAME_SHARE[face.orientation] * widthPt)
  const name =
    text === null
      ? null
      : setPrintFinalText(
          text,
          printFinalNameStyle(face),
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
export function planPrintFinalBack(
  face: PrintFinalFace,
  parts: readonly PrintFinalPart[],
): PrintFinalBackPlan {
  if (!printFinalHasBack(face.piece)) {
    throw new RangeError('A tent has no back page: it prints its front on both faces')
  }
  const area = printFinalLiveArea(face)
  const { live, unitPt } = area
  const stack = stackPrintFinalGroup(parts, unitPt)
  const liveHeightPt = live.bottomPt - live.topPt
  const top =
    live.topPt + PRINT_FINAL_SPARE_TOP_SHARE * Math.max(0, liveHeightPt - stack.heightPt)
  const axis = (live.leftPt + live.rightPt) / 2
  return {
    face,
    widthPt: area.widthPt,
    heightPt: area.heightPt,
    unitPt,
    live,
    parts: stack.parts.map(({ offsetPt, ...part }) => ({
      ...part,
      xPt: axis - part.widthPt / 2,
      yPt: top + offsetPt,
    })),
    block:
      parts.length === 0
        ? null
        : {
            leftPt: axis - stack.widthPt / 2,
            topPt: top,
            rightPt: axis + stack.widthPt / 2,
            bottomPt: top + stack.heightPt,
          },
    fits: stack.heightPt <= liveHeightPt + FIT_TOLERANCE_PT,
  }
}

/** Lays a back page out: the brand and the name measured with the caller's fonts, then placed. */
export function layoutPrintFinalBack(input: PrintFinalBackInput): PrintFinalBackLayout {
  const { face } = input
  const area = printFinalLiveArea(face)
  const liveWidthPt = area.live.rightPt - area.live.leftPt
  const { parts, contents } = buildBack(input, liveWidthPt, area.widthPt)
  return { plan: planPrintFinalBack(face, parts), contents }
}
