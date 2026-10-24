// One final face, laid out (final design spec §2.3, §3, §5 and §8): the brand,
// the stars (Counter card only), the words and the code block, measured by their
// ink and placed by the face's planner. Pure and shared: the PDF lays a face out
// with the guest fonts' outlines and the Share tab's preview with its width
// estimates, and both draw what this returns.
//
// Long copy (§5.3): the headline steps down 1 pt at a time until both
// orientations of the piece keep their group gaps at 4u or more, never under
// 1.8 × the sub-line. Both orientations take the same step, so turning a piece
// never changes its headline's size.

import type { GuestLocale } from './guest-locale'
import { PRINT_KIT_SCAN_CUE, type PrintTextBlock } from './portal-print-kit'
import { PRINT_FINAL_ORIENTATIONS, type PrintFinalFace } from './portal-print-final'
import { printFinalBrandBox, type PrintFinalBrandBox } from './portal-print-final-brand'
import {
  printFinalCodeBlock,
  printFinalCueLines,
  type PrintFinalCodeBlock,
  type PrintFinalTile,
} from './portal-print-final-code'
import {
  printFinalHasStars,
  printFinalRule,
  printFinalStars,
  type PrintFinalStars,
} from './portal-print-final-marks'
import { PRINT_FINAL_MEASURES } from './portal-print-final-measures'
import type { PrintFinalPart } from './portal-print-final-parts'
import {
  planPrintFinalFace,
  printFinalTextColumn,
  type PrintFinalPlan,
} from './portal-print-final-plan'
import {
  setPrintFinalText,
  type PrintFinalAlign,
  type PrintFinalSetText,
  type PrintFinalTextMeasurer,
} from './portal-print-final-text'
import { choosePrintFinalHeadline } from './portal-print-final-type'
import {
  printFinalWords,
  printFinalWordmarkStyle,
  type PrintFinalTone,
  type PrintFinalWordsPart,
} from './portal-print-final-words'

/** The brand a face starts from: the property's name, or its logo by its drawn pixels. */
export type PrintFinalBrandInput =
  | Readonly<{ kind: 'wordmark'; text: string }>
  | Readonly<{ kind: 'logo'; inkWidth: number; inkHeight: number; onPlate: boolean }>

export type PrintFinalFaceInput = Readonly<{
  face: PrintFinalFace
  /** One language, or two, the first leading. */
  blocks: readonly PrintTextBlock[]
  brand: PrintFinalBrandInput
  tile: PrintFinalTile
  measurer: PrintFinalTextMeasurer
}>

/** What each placed part draws, in the plan's order. */
export type PrintFinalContent =
  | Readonly<{ kind: 'wordmark'; set: PrintFinalSetText }>
  | Readonly<{ kind: 'logo'; box: PrintFinalBrandBox }>
  | Readonly<{ kind: 'stars'; stars: PrintFinalStars }>
  | Readonly<{ kind: 'rule' }>
  | Readonly<{
      kind: 'words'
      set: PrintFinalSetText
      locale: GuestLocale
      tone: PrintFinalTone
    }>

export type PrintFinalCue = Readonly<{ text: string; locale: GuestLocale }>

export type PrintFinalFaceLayout = Readonly<{
  plan: PrintFinalPlan
  /** One per placed part, in the plan's order. */
  contents: readonly PrintFinalContent[]
  code: PrintFinalCodeBlock
  cues: readonly PrintFinalCue[]
  headlinePt: number
  /** The headline is at its floor and the words still crowd the face. */
  overflows: boolean
}>

type Built = Readonly<{
  parts: readonly PrintFinalPart[]
  contents: readonly PrintFinalContent[]
}>

/** The cue lines in the bar: one per language, or one long cue broken in two. */
function cuesOf(input: PrintFinalFaceInput): readonly PrintFinalCue[] {
  const { face, blocks, tile } = input
  const cuePt = PRINT_FINAL_MEASURES[face.region][face.piece].cuePt
  const texts = printFinalCueLines(
    blocks.map((block) => PRINT_KIT_SCAN_CUE[block.locale]),
    tile.tilePt,
    cuePt,
  )
  const lead = blocks[0]?.locale ?? 'en'
  return texts.map((text, index) => ({
    text,
    locale: texts.length === blocks.length ? (blocks[index]?.locale ?? lead) : lead,
  }))
}

function brandOf(
  input: PrintFinalFaceInput,
  face: PrintFinalFace,
  column: number,
  align: PrintFinalAlign,
): Built {
  const { brand } = input
  if (brand.kind === 'logo') {
    const box = printFinalBrandBox(face.piece, face.look, brand, brand.onPlate)
    return {
      parts: [{ key: 'brand', widthPt: box.widthPt, heightPt: box.heightPt }],
      contents: [{ kind: 'logo', box }],
    }
  }
  const style = printFinalWordmarkStyle(face)
  // The wordmark is padded by its tracking on the left, so each line's box is symmetric about its ink.
  const room = column - style.trackingEm * style.sizePt
  const set = setPrintFinalText(brand.text, style, room, align, input.measurer)
  if (set === null) return { parts: [], contents: [] }
  return {
    parts: [{ key: 'brand', widthPt: set.widthPt, heightPt: set.heightPt }],
    contents: [{ kind: 'wordmark', set }],
  }
}

function wordsOf(
  input: PrintFinalFaceInput,
  words: readonly PrintFinalWordsPart[],
  column: number,
  align: PrintFinalAlign,
): Built {
  const built = words.flatMap((word) => {
    const set = setPrintFinalText(word.text, word.style, column, align, input.measurer)
    if (set === null) return []
    const content = { kind: 'words', set, locale: word.locale, tone: word.tone } as const
    return [
      { part: { key: word.key, widthPt: set.widthPt, heightPt: set.heightPt }, content },
    ]
  })
  return { parts: built.map((b) => b.part), contents: built.map((b) => b.content) }
}

/** Every part of `face` at `headlinePt`, top to bottom, with what each draws. */
function buildFace(
  input: PrintFinalFaceInput,
  face: PrintFinalFace,
  headlinePt: number,
): Built {
  const column = printFinalTextColumn(face, input.tile.tilePt)
  const columnPt = column.rightPt - column.leftPt
  const align: PrintFinalAlign = face.orientation === 'upright' ? 'centre' : 'left'
  const brand = brandOf(input, face, columnPt, align)
  const { words, rule } = printFinalWords(face, input.blocks, headlinePt)
  const firstLanguage = words.filter(
    (w) => !['headline2', 'subline2', 'secondLine'].includes(w.key),
  )
  const secondLanguage = words.filter((w) => !firstLanguage.includes(w))
  const first = wordsOf(input, firstLanguage, columnPt, align)
  const second = wordsOf(input, secondLanguage, columnPt, align)
  const stars = printFinalHasStars(face.piece) ? printFinalStars() : null
  const ruleBox = printFinalRule(face.piece)
  return {
    parts: [
      ...brand.parts,
      ...(stars === null
        ? []
        : [{ key: 'stars', widthPt: stars.widthPt, heightPt: stars.heightPt } as const]),
      ...first.parts,
      ...(rule ? [{ key: 'rule', ...ruleBox } as const] : []),
      ...second.parts,
    ],
    contents: [
      ...brand.contents,
      ...(stars === null ? [] : [{ kind: 'stars', stars } as const]),
      ...first.contents,
      ...(rule ? [{ kind: 'rule' } as const] : []),
      ...second.contents,
    ],
  }
}

function planAt(input: PrintFinalFaceInput, face: PrintFinalFace, headlinePt: number) {
  const built = buildFace(input, face, headlinePt)
  const code = printFinalCodeBlock(face, input.tile, cuesOf(input).length)
  return { ...built, code, plan: planPrintFinalFace({ face, parts: built.parts, code }) }
}

/**
 * Lays out `input.face`: the headline at the largest size at which both
 * orientations of the piece fit (§5.3), then every part where the face's
 * planner puts it.
 */
export function layoutPrintFinalFace(input: PrintFinalFaceInput): PrintFinalFaceLayout {
  const { face } = input
  const choice = choosePrintFinalHeadline(face.piece, (headlinePt) =>
    PRINT_FINAL_ORIENTATIONS.every(
      (orientation) => planAt(input, { ...face, orientation }, headlinePt).plan.fits,
    ),
  )
  const laid = planAt(input, face, choice.headlinePt)
  return {
    plan: laid.plan,
    contents: laid.contents,
    code: laid.code,
    cues: cuesOf(input),
    headlinePt: choice.headlinePt,
    overflows: choice.overflows,
  }
}
