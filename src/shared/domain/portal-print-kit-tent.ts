// The small table tent's face (round-3 spec-delta S5, on round-2 R3): a
// landscape face of 5 × 3.5 in (130 × 90 mm) whose top edge is the fold, in one
// language. Where every part of it goes, from the top-left corner of its trim,
// in points: one pure plan, as the cards have (`portal-print-kit-card.ts`).
//
//   Immersive: the photo panel down the left, full height, 1.2 in wide; then,
//   18 pt from it, a row: the words, a 14 pt gap and the 1.4 in code block.
//   Paper: the same row with no photo, 22 pt from each edge, the code block with
//   its outline on the right.
//
// The words are the brand at the top-left (the logo, on its cream plate on
// Immersive, or the wordmark) and the message at the foot: the eyebrow, the call
// to action and its sub-line, stretched to the code block's height, so the
// logo's top is the code's top and the sub-line's foot is the bar's foot. The
// row is centred, so the fold clearance is the foot margin: 0.9 in with a
// one-line bar. The tent prints no name under the logo (D12: the logo carries it
// at this size) and one language a face: the lead on the front, the second on
// the back.
//
// When the words are taller than the code block (a call to action that breaks
// onto three lines in a long language), the call to action steps down 2 pt at a
// time, twice; then the row grows past the code block, and stays centred.

import type { PrintFace, PrintKitPaper, PrintKitStyle } from './portal-print-kit'
import {
  planCardBrand,
  type CardBrand,
  type CardBrandInput,
} from './portal-print-kit-card-brand'
import {
  layoutCardMessage,
  placeCardWords,
  type CardLine,
  type CardRule,
  type CardTextMeasure,
  type CardWords,
} from './portal-print-kit-card-words'
import type { CodeBlockPlan } from './portal-print-kit-code-block'
import { CODE_BLOCK } from './portal-print-kit-measures'
import { FACE_TYPE_PT, LOGO_OPTICAL } from './portal-print-kit-size-type'
import {
  FACE_SPACING,
  LOGO_PLATE_PADDING_PT,
  TENT_SMALL_FACE,
} from './portal-print-kit-sizes'

export type TentInput = Readonly<{
  style: PrintKitStyle
  paper: PrintKitPaper
  /** The face; only its lead language prints on it. */
  face: PrintFace
  brand: CardBrandInput
  /** The code block, planned on the tile the address allows, with one cue line. */
  code: CodeBlockPlan
  measure: CardTextMeasure
  /** Where a wordmark's caps start under the top of its line box, at a size. */
  wordmarkInkTopPt: (sizePt: number) => number
}>

export type TentPlan = Readonly<{
  style: PrintKitStyle
  widthPt: number
  heightPt: number
  /** The photo panel's width, from the trim's left edge; null on Paper. */
  panelPt: number | null
  /** The brand at the top-left of the words. */
  brand: CardBrand
  /** The column the words are set in, from its left edge. */
  column: Readonly<{ x: number; widthPt: number }>
  /** The message: every line placed on the face. */
  words: readonly (CardLine | CardRule)[]
  code: Readonly<{ x: number; y: number; plan: CodeBlockPlan }>
  /** The row: the words and the code block, centred down the face. */
  row: Readonly<{ topPt: number; heightPt: number }>
  /** The call to action's size, after any step down. */
  ctaPt: number
}>

/** The least room between the brand and the message: Table's group-gap minimum. */
export const TENT_WORDS_GAP_MIN_PT = 12

/** What the call to action steps down by, and how many times, before the row grows. */
const CTA_STEP_PT = 2
const CTA_STEPS = 2

/** The brand moved across so its box starts at `x`. */
function alignBrandLeft(brand: CardBrand, x: number): CardBrand {
  if (brand.kind === 'wordmark') return { ...brand, box: { ...brand.box, x } }
  const dx = x - (brand.plate?.x ?? brand.ink.x)
  return {
    kind: 'logo',
    ink: { ...brand.ink, x: brand.ink.x + dx },
    plate: brand.plate === null ? null : { ...brand.plate, x },
  }
}

type Words = Readonly<{
  brand: ReturnType<typeof planCardBrand>
  message: CardWords
  ctaPt: number
  /** The brand, the least gap and the message, stacked. */
  heightPt: number
}>

function wordsAt(input: TentInput, ctaPt: number, columnPt: number): Words {
  const type = FACE_TYPE_PT.tent
  const brand = planCardBrand(input.brand, {
    logo: LOGO_OPTICAL.tent[input.style],
    platePadding: LOGO_PLATE_PADDING_PT.tent,
    wordmarkPt: type.wordmark,
    columnPt,
    measure: input.measure,
    wordmarkInkTopPt: input.wordmarkInkTopPt,
  })
  const message = layoutCardMessage({
    blocks: input.face.blocks.slice(0, 1),
    type: {
      eyebrowPt: type.eyebrow ?? 0,
      ctaPt,
      ctaOneLineFloorPt: null,
      subPt: type.sub,
      cta2Pt: 0,
    },
    spacing: FACE_SPACING.tent,
    widthPt: columnPt,
    eyebrow: true,
    measure: input.measure,
  })
  const ink = brand.heightPt - brand.inkTopPt
  return {
    brand,
    message,
    ctaPt,
    heightPt: ink + TENT_WORDS_GAP_MIN_PT + message.heightPt,
  }
}

/** The roomiest call to action whose words fit beside the code block; else the smallest. */
function chooseWords(input: TentInput, columnPt: number): Words {
  const type = FACE_TYPE_PT.tent
  const lead = input.style === 'immersive' ? type.ctaImmersive : type.ctaPaper
  let words = wordsAt(input, lead, columnPt)
  for (let step = 1; step <= CTA_STEPS && words.heightPt > input.code.heightPt; step++) {
    words = wordsAt(input, lead - step * CTA_STEP_PT, columnPt)
  }
  return words
}

/** Where everything on a small tent's face goes. */
export function planTent(input: TentInput): TentPlan {
  const { style, code } = input
  const trim = TENT_SMALL_FACE.trimPt[input.paper]
  const immersive = style === 'immersive'
  const panelPt = immersive ? TENT_SMALL_FACE.photoPanelPt : null
  const side = FACE_SPACING.tent.sidePt[style]
  const outline = immersive ? 0 : CODE_BLOCK.outlinePt
  const left = (panelPt ?? 0) + side
  const codeX = trim.widthPt - side - outline - code.tile.tilePt
  const columnPt = codeX - outline - TENT_SMALL_FACE.rowGapPt - left
  const words = chooseWords(input, columnPt)
  const rowHeight = Math.max(code.heightPt, words.heightPt)
  const rowTop = (trim.heightPt - rowHeight) / 2
  const brandTop = rowTop - words.brand.inkTopPt
  const messageTop = rowTop + rowHeight - words.message.heightPt
  return {
    style,
    widthPt: trim.widthPt,
    heightPt: trim.heightPt,
    panelPt,
    brand: alignBrandLeft(words.brand.at(brandTop, 0), left),
    column: { x: left, widthPt: columnPt },
    words: placeCardWords(words.message, messageTop),
    code: { x: codeX, y: rowTop + (rowHeight - code.heightPt) / 2, plan: code },
    row: { topPt: rowTop, heightPt: rowHeight },
    ctaPt: words.ctaPt,
  }
}
