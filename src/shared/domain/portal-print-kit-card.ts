// The Large card, 4 × 6 in or A6, in both styles (round-2 spec-delta R1, R2 and
// R5; round-3 spec-delta S2 to S4): where every part of a face goes, from the
// top-left corner of its trim, in points. One pure plan, which the PDF draws and
// the Share tab's preview draws, so the preview is the file.
//
//   Immersive: the photo band across the top, full bleed, the logo's cream plate
//   straddling its bottom edge (or the wordmark a group gap under it), the name
//   under the plate, a gap, the message, a gap, the code block on the bottom
//   margin, to the bar's bottom edge.
//   Paper: the logo on the top margin, the name, a gap, the message, a gap, the
//   code block with its outline on the bottom margin.
//
// The two gaps between the groups share the spare height; the band keeps its
// target and only shrinks (`portal-print-kit-card-fit.ts`). The margins are
// measured to ink: a logo's drawing, a wordmark's caps, the Paper outline. The
// code tile is the caller's, the one the address allows (`largeCardTile`): at
// today's 2 in the gaps are smaller than at the boards' 1.75 in.

import type { PrintFace, PrintKitPaper, PrintKitStyle } from './portal-print-kit'
import {
  planCardBrand,
  type CardBrand,
  type CardBrandInput,
} from './portal-print-kit-card-brand'
import {
  chooseCardFit,
  largeCardFitSteps,
  type CardFitStep,
} from './portal-print-kit-card-fit'
import {
  layoutCardMessage,
  layoutCardName,
  placeCardWords,
  type CardLine,
  type CardRule,
  type CardTextMeasure,
  type CardWords,
} from './portal-print-kit-card-words'
import type { CodeBlockPlan } from './portal-print-kit-code-block'
import {
  chooseCodeTile,
  printAddressShape,
  type CodeTile,
} from './portal-print-kit-code-tile'
import { CODE_BLOCK } from './portal-print-kit-measures'
import { FACE_TYPE_PT } from './portal-print-kit-size-type'
import {
  BAND,
  FACE_ELEMENTS,
  FACE_SPACING,
  LOGO_PLATE_PADDING_PT,
  SIZE_TRIM_PT,
} from './portal-print-kit-sizes'

export type LargeCardInput = Readonly<{
  style: PrintKitStyle
  paper: PrintKitPaper
  face: PrintFace
  brand: CardBrandInput
  /** The property name printed under a logo; null for none. */
  propertyName: string | null
  /** The code block, planned on the tile the address allows. */
  code: CodeBlockPlan
  measure: CardTextMeasure
  /** Where a wordmark's caps start under the top of its line box, at a size. */
  wordmarkInkTopPt: (sizePt: number) => number
}>

export type LargeCardPlan = Readonly<{
  style: PrintKitStyle
  widthPt: number
  heightPt: number
  /** The photo band, from the trim's top edge down; null on Paper. */
  bandPt: number | null
  brand: CardBrand
  /** The column the words are centred in. */
  column: Readonly<{ x: number; widthPt: number }>
  /** The name and the message: every line and the rule, placed on the face. */
  words: readonly (CardLine | CardRule)[]
  code: Readonly<{ x: number; y: number; plan: CodeBlockPlan }>
  /** The fit step the card is set at, and each of the two gaps between its groups. */
  step: CardFitStep
  stepIndex: number
  gapPt: number
}>

/** The tile a Large card prints its code on: 1.75 in when its modules allow, else today's 2 in. */
export function largeCardTile(
  paper: PrintKitPaper,
  address: Readonly<{ text: string; symbolModules: number }>,
): CodeTile {
  const choice = chooseCodeTile({
    size: 'large',
    paper,
    symbolModules: address.symbolModules,
    addressShape: printAddressShape(address.text),
  })
  // Large falls back to today's tile; it is never refused.
  if (choice.isErr()) throw new Error('A Large card always has a tile')
  return choice.value.tile
}

const SPACING = FACE_SPACING.large

type Head = Readonly<{
  brand: ReturnType<typeof planCardBrand>
  name: CardWords
  message: CardWords
  /** From the top of the brand's box to the bottom of the name. */
  headPt: number
  /** From the band's edge (Immersive) or the trim's top (Paper) to the top of the brand's box. */
  brandTopPt: number
}>

/** The brand, the name and the message at a step, and where the brand's box starts. */
function headAt(input: LargeCardInput, step: CardFitStep, columnPt: number): Head {
  const { measure, style } = input
  const brand = planCardBrand(input.brand, {
    logo: step.logo,
    platePadding: LOGO_PLATE_PADDING_PT.large,
    wordmarkPt: FACE_TYPE_PT.large.wordmark,
    columnPt,
    measure,
    wordmarkInkTopPt: input.wordmarkInkTopPt,
  })
  const named =
    input.brand.kind === 'logo' &&
    step.name &&
    FACE_ELEMENTS.large.name &&
    input.propertyName !== null
  const nameSize = FACE_TYPE_PT.large.name ?? 0
  const name = named
    ? layoutCardName(input.propertyName ?? '', nameSize, columnPt, measure)
    : { items: [], heightPt: 0 }
  const nameBlock =
    name.items.length === 0 ? 0 : (SPACING.logoToNamePt ?? 0) + name.heightPt
  const message = layoutCardMessage({
    blocks: input.face.blocks,
    type: step,
    spacing: SPACING,
    widthPt: columnPt,
    eyebrow: FACE_ELEMENTS.large.eyebrow,
    measure,
  })
  const edge = SPACING.edgePt ?? 0
  const gapMin = SPACING.groupGapMinPt ?? 0
  const brandTopPt =
    style === 'paper'
      ? edge - brand.inkTopPt
      : input.brand.kind === 'logo'
        ? -brand.heightPt / 2
        : gapMin
  return { brand, name, message, headPt: brand.heightPt + nameBlock, brandTopPt }
}

/** Where everything on a Large card goes. */
export function planLargeCard(input: LargeCardInput): LargeCardPlan {
  const { style } = input
  const trim = SIZE_TRIM_PT.large[input.paper]
  const side = SPACING.sidePt[style]
  const edge = SPACING.edgePt ?? 0
  const columnPt = trim.widthPt - 2 * side
  const immersive = style === 'immersive'
  const outline = immersive ? 0 : CODE_BLOCK.outlinePt
  const below = input.code.heightPt + outline + edge
  const chosen = chooseCardFit(
    largeCardFitSteps(style),
    {
      heightPt: trim.heightPt,
      band: immersive ? BAND.large : null,
      gapMinPt: SPACING.groupGapMinPt ?? 0,
    },
    (step) => {
      const head = headAt(input, step, columnPt)
      const above = head.brandTopPt + head.headPt + head.message.heightPt
      return { fixedPt: above + below, value: head }
    },
  )
  const head = chosen.value
  const brandTop = (chosen.bandPt ?? 0) + head.brandTopPt
  const nameTop = brandTop + head.brand.heightPt + (SPACING.logoToNamePt ?? 0)
  const messageTop = brandTop + head.headPt + chosen.gapPt
  return {
    style,
    widthPt: trim.widthPt,
    heightPt: trim.heightPt,
    bandPt: chosen.bandPt,
    brand: head.brand.at(brandTop, trim.widthPt),
    column: { x: side, widthPt: columnPt },
    words: [
      ...placeCardWords(head.name, nameTop),
      ...placeCardWords(head.message, messageTop),
    ],
    code: {
      x: (trim.widthPt - input.code.tile.tilePt) / 2,
      y: trim.heightPt - below,
      plan: input.code,
    },
    step: chosen.step,
    stepIndex: chosen.index,
    gapPt: chosen.gapPt,
  }
}
