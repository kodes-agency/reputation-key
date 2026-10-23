// An Immersive face (spec 5.2 and 5.3): the guest page's dark field, with the
// photo in a framed window that type never touches, or the monogram when there is
// no photo. Two shapes, two papers each:
//
//   - the counter card (4 × 6 in, or A6), with its margins measured from the
//     trim;
//   - the tent panel (4 × 6 in, or A6), whose top margin is measured from the
//     inner edge of the ridge band over the fold: standing, the band is the
//     panel's top edge.
//
// Both stack the same way: the brand at the top margin, a fixed gap, the window,
// a flexible gap, the words, a flexible gap and the code block at the bottom
// margin, to the bar's bottom edge (Immersive has no outline). The window grows
// first and gives way first (print-kit-immersive-fit.ts). A two-language tent
// panel prints without a window (owner decision D4): even after every fit step it
// would be under the floor the photo and the monogram share.
//
// Laid out in the face's own coordinates, in points, from the top-left corner of
// its trim; the page places and turns it, and says how far it bleeds.

import type { PrintFace } from '#/shared/domain/portal-print-kit'
import type { CodeBlockPlan } from '#/shared/domain/portal-print-kit-code-block'
import {
  WINDOW_FRAME_PT,
  immersiveBrandSize,
  immersiveFitSteps,
  immersiveGridOf,
  isImmersiveGeometry,
  isTentPanel,
  wantsWindow,
  type ImmersiveFitStep,
  type ImmersiveGeometry,
  type ImmersiveGrid,
  windowPictureRangePt,
  windowWidthPt,
} from '#/shared/domain/portal-print-kit-immersive'
import {
  longCopySizes,
  type StackSizes,
} from '#/shared/domain/portal-print-kit-long-copy'
import { CODE_BLOCK } from '#/shared/domain/portal-print-kit-measures'
import type { ImmersivePrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import type { PanelGeometry } from '#/shared/domain/portal-print-kit-sheets'
import {
  drawCodeBlock,
  planFaceCodeBlock,
  type CodeBlockArt,
} from './print-kit-code-block'
import {
  drawBrand,
  planBrand,
  type BrandPlan,
  type BrandSize,
  type FaceBrandArt,
} from './print-kit-face-brand'
import {
  drawFaceStack,
  layoutFaceStack,
  type FaceStack,
  type PlacedStack,
} from './print-kit-face-stack'
import { drawField } from './print-kit-immersive-field'
import type { FaceBleed } from './print-kit-pages'
import {
  shareImmersiveHeight,
  sharedWithoutWindow,
  type MeasuredFit,
  type SharedHeight,
} from './print-kit-immersive-fit'
import { measureLine, type PrintKitFonts } from './print-kit-pdf-text'
import type { QrMatrix } from './print-kit-qr'
import { drawWindow, type WindowLayout } from './print-kit-window'
import type { OpenedImage } from './print-kit-pdf-image'

export type ImmersiveFaceArt = Readonly<{
  palette: ImmersivePrintKitPalette
  brand: FaceBrandArt
  qr: QrMatrix
}>

export type ImmersiveFaceLayout = Readonly<{
  geometry: ImmersiveGeometry
  brand: Readonly<{ plan: BrandPlan; x: number; y: number; align: 'centre' }>
  /** Null when the face prints without a window (fit step d, or decision D4). */
  window: WindowLayout | null
  stack: PlacedStack
  code: Readonly<{ plan: CodeBlockPlan; art: CodeBlockArt; x: number; y: number }>
  /** The ridge band's height on a tent panel; null on a card. */
  ridgePt: number | null
}>

type Sizing = Readonly<{
  doc: PDFKit.PDFDocument
  fonts: PrintKitFonts
  face: PrintFace
  art: ImmersiveFaceArt
  geometry: ImmersiveGeometry
  grid: ImmersiveGrid
  maxWidthPt: number
}>

/** The brand at full size, or at its floor, in the room across the face. */
const brandSize = (sizing: Sizing, size: ImmersiveFitStep['brand']): BrandSize => ({
  ...immersiveBrandSize(sizing.geometry, sizing.face.blocks.length, size),
  maxWidthPt: sizing.maxWidthPt,
})

function stackAt(sizing: Sizing, step: ImmersiveFitStep, sizes?: StackSizes): FaceStack {
  const { doc, fonts, art } = sizing
  return layoutFaceStack({
    blocks: sizing.face.blocks,
    scale: step.scale,
    sizes,
    placeToHeadPt: step.placeToHeadPt,
    maxWidthPt: sizing.maxWidthPt,
    colours: {
      ink: art.palette.headline,
      soft: art.palette.body,
      accentInk: art.palette.accentInk,
      rule: art.palette.accentLine,
    },
    measure: (text, style) => measureLine(doc, fonts, text, style),
  })
}

type Attempt = Readonly<{ brand: BrandPlan; stack: FaceStack; brandTop: number }>

/** The margins, the brand, the words and the code: everything on the face that does not flex. */
function measured(
  sizing: Sizing,
  step: ImmersiveFitStep,
  codeHeight: number,
  sizes?: StackSizes,
): MeasuredFit<Attempt> {
  const brand = planBrand(
    sizing.doc,
    sizing.fonts,
    sizing.art.brand,
    brandSize(sizing, step.brand),
  )
  const stack = stackAt(sizing, step, sizes)
  const { grid } = sizing
  const brandTop = (grid.ridgePt ?? 0) + grid.marginPt - brand.inkTopPt
  return {
    value: { brand, stack, brandTop },
    gapPt: step.gapPt,
    fixedPt: brandTop + brand.heightPt + stack.heightPt + codeHeight + grid.marginPt,
  }
}

/**
 * The first long-copy step whose words leave the gaps their minimum, measured
 * one step at a time; the last step when none does, so the overflow is as small
 * as it can be.
 */
function firstLongCopyFit(
  sizing: Sizing,
  step: ImmersiveFitStep,
  codeHeight: number,
): MeasuredFit<Attempt> {
  let last: MeasuredFit<Attempt> | null = null
  for (const sizes of longCopySizes(step.scale)) {
    last = measured(sizing, step, codeHeight, sizes)
    if (sizing.grid.heightPt - last.fixedPt >= 2 * last.gapPt) break
  }
  if (last === null) throw new Error('A place label has at least one size')
  return last
}

/**
 * The step a face is printed at. When not even the tightest step without a
 * window leaves the gaps their minimum, the words take the long-copy steps in
 * it until they do (`longCopySizes`): the code block never gives way.
 */
function chooseFit(sizing: Sizing, codeHeight: number): SharedHeight<Attempt> {
  const steps = immersiveFitSteps(sizing.face.blocks.length, isTentPanel(sizing.geometry))
  const fits = steps.map((step) => measured(sizing, step, codeHeight))
  const range = wantsWindow(sizing.geometry, sizing.face.blocks.length)
    ? { ...windowPictureRangePt(sizing.geometry), framePt: 2 * WINDOW_FRAME_PT }
    : null
  const chosen = shareImmersiveHeight(fits, sizing.grid.heightPt, range)
  if (chosen !== null) return chosen
  const tightest = steps[steps.length - 1]
  if (tightest === undefined) throw new Error('A face has at least one way to be set')
  const fitting = firstLongCopyFit(sizing, tightest, codeHeight)
  return sharedWithoutWindow(fitting, sizing.grid.heightPt)
}

function windowAt(sizing: Sizing, top: number, picturePt: number): WindowLayout {
  const widthPt = windowWidthPt(sizing.geometry)
  return {
    x: sizing.grid.sidePt,
    y: top,
    widthPt,
    heightPt: picturePt + 2 * WINDOW_FRAME_PT,
    picture: {
      x: sizing.grid.sidePt + WINDOW_FRAME_PT,
      y: top + WINDOW_FRAME_PT,
      widthPt: widthPt - 2 * WINDOW_FRAME_PT,
      heightPt: picturePt,
    },
  }
}

/** Where everything on an Immersive face goes. */
export function layoutImmersiveFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  face: PrintFace,
  art: ImmersiveFaceArt,
  geometry: PanelGeometry,
): ImmersiveFaceLayout {
  if (!isImmersiveGeometry(geometry)) {
    throw new Error(`An Immersive face is a card or a tent panel, not a ${geometry}`)
  }
  const grid = immersiveGridOf(geometry)
  const sizing: Sizing = {
    doc,
    fonts,
    face,
    art,
    geometry,
    grid,
    maxWidthPt: grid.widthPt - 2 * grid.sidePt,
  }
  const code = planFaceCodeBlock(doc, fonts, face, art.qr, art.palette)
  const fit = chooseFit(sizing, code.plan.heightPt)
  const { brand, stack, brandTop } = fit.value
  const brandBottom = brandTop + brand.heightPt
  const window =
    fit.picturePt === null
      ? null
      : windowAt(sizing, brandBottom + fit.gapPt, fit.picturePt)
  const aboveWords = window === null ? brandBottom : window.y + window.heightPt
  return {
    geometry,
    brand: {
      plan: brand,
      x: (grid.widthPt - brand.widthPt) / 2,
      y: brandTop,
      align: 'centre',
    },
    window,
    stack: {
      stack,
      x: grid.sidePt,
      y: aboveWords + fit.abovePt,
      widthPt: sizing.maxWidthPt,
      align: 'centre',
    },
    code: {
      ...code,
      x: (grid.widthPt - CODE_BLOCK.tilePt) / 2,
      y: grid.heightPt - grid.marginPt - code.plan.heightPt,
    },
    ridgePt: grid.ridgePt,
  }
}

export type ImmersiveFaceDrawing = Readonly<{
  palette: ImmersivePrintKitPalette
  /** The photo cropped to this face's window; null for the monogram. */
  photo: OpenedImage | null
  letter: string
}>

/** Draws a laid-out Immersive face, its field running `bleed` past the trim. */
export function drawImmersiveFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  layout: ImmersiveFaceLayout,
  drawing: ImmersiveFaceDrawing,
  bleed: FaceBleed,
): void {
  const grid = immersiveGridOf(layout.geometry)
  drawField(doc, drawing.palette, grid, bleed, layout.ridgePt)
  drawBrand(doc, fonts, layout.brand.plan, layout.brand)
  if (layout.window !== null) drawWindow(doc, fonts, layout.window, drawing)
  drawFaceStack(doc, fonts, layout.stack)
  drawCodeBlock(doc, fonts, layout.code.art, layout.code.plan, layout.code)
}
