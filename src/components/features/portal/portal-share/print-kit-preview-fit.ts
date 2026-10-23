// The fit a Paper face is set at in the Share tab's preview (spec 2.5): the type
// scale, the brand's size and the long-copy steps, chosen by the PDF's rules
// from widths the preview estimates (`portal-print-kit-text-widths.ts`), since
// it cannot measure the fonts. The estimates err wide, so the preview never
// sets the words larger than the file prints them, and a long title never
// pushes the code block off the face. The Immersive preview chooses its step
// in `print-kit-immersive-art-layout.ts`, from the same estimates.
//
// Every measure is read from the files the PDF reads.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintFace } from '#/shared/domain/portal-print-kit'
import {
  cueLinesFor,
  estimatedCueWidthPt,
  planCodeBlock,
} from '#/shared/domain/portal-print-kit-code-block'
import {
  longCopySizes,
  scaleSizes,
  type StackSizes,
} from '#/shared/domain/portal-print-kit-long-copy'
import {
  CARD_GRID,
  CODE_BLOCK,
  FIT,
  LOGO_BOX_MM,
  STACK,
  TENT_FACE,
  TENT_FACE_GRID,
  TENT_WORDMARK_PT,
  TYPE_PT,
  WORDMARK,
  mmToPt,
  type TypeScale,
} from '#/shared/domain/portal-print-kit-measures'
import type { PanelGeometry } from '#/shared/domain/portal-print-kit-sheets'
import { fillWords } from '#/shared/domain/portal-print-kit-text'
import {
  estimatedLineWidthPt,
  type EstimatedFace,
} from '#/shared/domain/portal-print-kit-text-widths'
import { brandInkPt } from './print-kit-face-brand-art'

type Look = PortalPrintKitView['look']

/** The height of `text`'s lines at `sizePt`, wrapped at `widthPt` as the PDF wraps it. */
function linesHeight(
  text: string,
  face: EstimatedFace,
  sizePt: number,
  leading: number,
  widthPt: number,
  trackingEm = 0,
): number {
  const width = (line: string) => estimatedLineWidthPt(line, face, sizePt, trackingEm)
  // A balanced heading takes as many lines as the greedy fill does.
  return fillWords(text, widthPt, width).length * sizePt * leading
}

/**
 * The estimated height of a face's words, stacked as the PDF stacks them: with
 * one language the rule sits between the place label and the call to action,
 * with two it sits between the two calls to action. `sizes` are the long-copy
 * steps' when they have taken any, `placeToHeadPt` the place block's gap when
 * a fit step has tightened it.
 */
export function estimatedStackHeight(
  face: PrintFace,
  scale: TypeScale,
  widthPt: number,
  options: Readonly<{ sizes?: StackSizes; placeToHeadPt?: number }> = {},
): number {
  const [lead, second] = face.blocks
  if (lead === undefined) return 0
  const size = options.sizes ?? scaleSizes(scale)
  const gaps: Readonly<{ rule: number; placeToHead?: number }> = STACK.gapsPt[scale]
  const { leading, trackingEm } = STACK
  const tent = scale === 'tent'
  const rule = 2 * gaps.rule + (tent ? STACK.rule.tentWeightPt : STACK.rule.weightPt)
  const text = (copy: string, face: EstimatedFace, at: number, lead: number) =>
    linesHeight(copy, face, at, lead, widthPt)
  const leadHeight =
    linesHeight(
      lead.kicker,
      'display',
      size.place,
      leading.place,
      widthPt,
      trackingEm.place,
    ) +
    text(lead.headline, 'display', size.head, leading.head) +
    STACK.subAbovePt +
    text(lead.subline, 'text', size.sub, leading.sub)
  if (second === undefined) return leadHeight + rule
  return (
    leadHeight +
    STACK.placeGapPt +
    linesHeight(
      second.kicker,
      'text',
      size.place2,
      leading.place2,
      widthPt,
      trackingEm.place2,
    ) +
    (options.placeToHeadPt ?? gaps.placeToHead ?? 0) +
    rule +
    text(second.headline, 'display', size.head2, leading.head2) +
    STACK.sub2AbovePt +
    text(second.subline, 'text', size.sub2, leading.sub2)
  )
}

/** The scale's own sizes when `fits` takes them, else the first long-copy step it takes, else the last. */
export function fittedSizes(
  scale: TypeScale,
  fits: (sizes: StackSizes) => boolean,
): StackSizes {
  const steps = [scaleSizes(scale), ...longCopySizes(scale)]
  return steps.find(fits) ?? steps[steps.length - 1] ?? scaleSizes(scale)
}

export type PreviewPaperFit = Readonly<{
  scale: TypeScale
  sizes: StackSizes
  wordmarkPt: number
  logoHeightPt: number
}>

type BrandSize = Readonly<{ wordmarkPt: number; logoHeightPt: number }>

const codeOf = (face: PrintFace) =>
  planCodeBlock(
    cueLinesFor(face.blocks.map((block) => block.locale)),
    estimatedCueWidthPt,
  )

/** The brand's box: a logo as tall as it may be (its width is the browser's), or the wordmark's line box. */
const brandHeightPt = (look: Look, wordmarkPt: number, logoHeightPt: number) =>
  look.logoUrl === null ? wordmarkPt * WORDMARK.lineBoxEm : logoHeightPt

/**
 * A card, as the PDF's `cardCandidates` and `shrunkStack` choose: the full
 * scale, then two languages stepped down (fit step c), the brand at its full
 * size and then its floor at each; the long-copy steps on the last when none
 * leaves the two gaps their minimums.
 */
function previewPaperCardFit(
  face: PrintFace,
  geometry: 'card4x6' | 'cardA6',
  look: Look,
): PreviewPaperFit {
  const grid = CARD_GRID.paper[geometry === 'card4x6' ? 'letter' : 'a4']
  const width = grid.widthPt - 2 * grid.sidePt
  const free =
    grid.heightPt -
    2 * grid.marginPt -
    CODE_BLOCK.outlinePt -
    codeOf(face).heightPt -
    FIT.paperGapPt.brand -
    FIT.paperGapPt.code
  const brands: readonly BrandSize[] = [
    { wordmarkPt: WORDMARK.pt, logoHeightPt: mmToPt(LOGO_BOX_MM.height) },
    { wordmarkPt: FIT.wordmarkFloorPt, logoHeightPt: FIT.logoFloorPt },
  ]
  const scales: readonly TypeScale[] =
    face.blocks.length > 1 ? ['two', 'twoTight'] : ['one']
  const candidates = scales.flatMap((scale) =>
    brands.map((brand) => ({ ...brand, scale, sizes: scaleSizes(scale) })),
  )
  const room = (brand: BrandSize) =>
    free +
    brandInkPt(look, brand.wordmarkPt) -
    brandHeightPt(look, brand.wordmarkPt, brand.logoHeightPt)
  const fits = (candidate: PreviewPaperFit, sizes: StackSizes) =>
    estimatedStackHeight(face, candidate.scale, width, { sizes }) <= room(candidate)
  const chosen = candidates.find((candidate) => fits(candidate, candidate.sizes))
  if (chosen !== undefined) return chosen
  const tightest = candidates[candidates.length - 1]
  if (tightest === undefined)
    throw new Error('A card has at least one way to set its words')
  return {
    ...tightest,
    sizes: fittedSizes(tightest.scale, (sizes) => fits(tightest, sizes)),
  }
}

/** Where the code's tile starts under the top of the place label's line box: on its cap line. */
export const tentCodeOffsetPt = (placePt: number): number =>
  (TENT_FACE.codeTopOffsetPt * placePt) / TYPE_PT.tent.place

/** A tent face, as the PDF's `layoutPaperTent` chooses: the tent scale, then the long-copy steps. */
function previewPaperTentFit(
  face: PrintFace,
  geometry: 'tentFaceLetter' | 'tentFaceA5',
  look: Look,
): PreviewPaperFit {
  const grid = TENT_FACE_GRID[geometry === 'tentFaceLetter' ? 'letter' : 'a4']
  const width = grid.widthPt - 2 * grid.sidePt - CODE_BLOCK.tilePt - TENT_FACE.rowGapPt
  const code = codeOf(face)
  const bottomPad = brandInkPt(look, TENT_WORDMARK_PT) + CODE_BLOCK.outlinePt
  const needed = 2 * grid.foldClearancePt + TENT_FACE.logoToRowMinPt - bottomPad
  const free =
    grid.heightPt -
    bottomPad -
    brandHeightPt(look, TENT_WORDMARK_PT, TENT_FACE.logoHeightPt) -
    needed
  const sizes = fittedSizes('tent', (at) => {
    const words = estimatedStackHeight(face, 'tent', width, { sizes: at })
    return Math.max(words, tentCodeOffsetPt(at.place) + code.heightPt) <= free
  })
  return {
    scale: 'tent',
    sizes,
    wordmarkPt: TENT_WORDMARK_PT,
    logoHeightPt: TENT_FACE.logoHeightPt,
  }
}

/** The fit of a Paper face; null for a shape Paper does not print. */
export function previewPaperFit(
  face: PrintFace,
  geometry: PanelGeometry,
  look: Look,
): PreviewPaperFit | null {
  switch (geometry) {
    case 'card4x6':
    case 'cardA6':
      return previewPaperCardFit(face, geometry, look)
    case 'tentFaceLetter':
    case 'tentFaceA5':
      return previewPaperTentFit(face, geometry, look)
    default:
      return null
  }
}
