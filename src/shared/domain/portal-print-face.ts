// One face, laid out (design spec §2.3, §3, §5 and §8): the brand,
// the words and the code block, measured by their ink and placed by the face's
// planner. Pure and shared: the PDF lays a face out with the guest fonts'
// outlines and the Share tab's preview with its width estimates, and both draw
// what this returns.
//
// Long copy (§5.3): the headline steps down 1 pt at a time until both
// orientations of the piece keep their group gaps at 4u or more and their words
// within 3 lines for the headline and 2 for the sub-line, never under 1.8 × the
// sub-line. Both orientations take the same step, so turning a piece never
// changes its headline's size. What the floor cannot hold is refused.

import type { GuestLocale } from './guest-locale'
import type { PrintTextBlock } from './portal-print-kit'
import { PRINT_ORIENTATIONS, type PrintFace } from './portal-print'
import { printBrandBox, type PrintBrandBox } from './portal-print-brand'
import { printCodeBlock, type PrintCodeBlock, type PrintTile } from './portal-print-code'
import { PRINT_SCAN_CUE, placePrintCues, printCueLines } from './portal-print-cue'
import { printRule } from './portal-print-marks'
import { PRINT_MEASURES } from './portal-print-measures'
import type { PrintPart } from './portal-print-parts'
import { planPrintFace, printTextColumn, type PrintPlan } from './portal-print-plan'
import {
  setPrintText,
  type PrintAlign,
  type PrintSetText,
  type PrintTextMeasurer,
} from './portal-print-text'
import { choosePrintHeadline } from './portal-print-type'
import {
  printWords,
  printWordmarkStyle,
  type PrintTone,
  type PrintWordsPart,
} from './portal-print-words'

/** The brand a face starts from: the property's name, or its logo by its drawn pixels. */
export type PrintBrandInput =
  | Readonly<{ kind: 'wordmark'; text: string }>
  | Readonly<{ kind: 'logo'; inkWidth: number; inkHeight: number; onPlate: boolean }>

export type PrintFaceInput = Readonly<{
  face: PrintFace
  /** One language, or two, the first leading. */
  blocks: readonly PrintTextBlock[]
  brand: PrintBrandInput
  tile: PrintTile
  measurer: PrintTextMeasurer
  /**
   * Step the headline for this orientation alone. Off (the print's way), both
   * orientations of the piece take the same step; Share's fit check turns it on
   * to tell a step this orientation needs from one only the other forces.
   */
  ownStepOnly?: boolean
}>

/** What each placed part draws, in the plan's order. */
export type PrintContent =
  | Readonly<{ kind: 'wordmark'; set: PrintSetText }>
  | Readonly<{ kind: 'logo'; box: PrintBrandBox }>
  | Readonly<{ kind: 'rule' }>
  | Readonly<{
      kind: 'words'
      set: PrintSetText
      locale: GuestLocale
      tone: PrintTone
    }>

export type PrintCue = Readonly<{
  text: string
  locale: GuestLocale
  /** The cue line's baseline, from the bar's top: the lines are centred in the bar by their ink. */
  baselinePt: number
}>

export type PrintFaceLayout = Readonly<{
  plan: PrintPlan
  /** One per placed part, in the plan's order. */
  contents: readonly PrintContent[]
  code: PrintCodeBlock
  cues: readonly PrintCue[]
  headlinePt: number
  /**
   * The face does not hold its words at the size it prints: a group gap under 4u,
   * ink past the live area, or a headline over 3 lines or a sub-line over 2, with
   * the headline at the floor. The print is refused (`words_do_not_fit`). When
   * only the other orientation misses, this one prints at the shared size and is
   * not refused.
   */
  overflows: boolean
}>

/** Parts as they are measured, and what each draws, in the same order. */
export type PrintBuilt = Readonly<{
  parts: readonly PrintPart[]
  contents: readonly PrintContent[]
}>

/** The cue lines in the bar: one per language, or one long cue broken in two, and each line's language. */
function cueLinesOf(
  input: PrintFaceInput,
): readonly Readonly<{ text: string; locale: GuestLocale }>[] {
  const { face, blocks, tile, measurer } = input
  const cuePt = PRINT_MEASURES[face.region][face.piece].cuePt
  const texts = printCueLines(
    blocks.map((block) => PRINT_SCAN_CUE[block.locale]),
    tile.tilePt,
    cuePt,
    measurer,
  )
  const lead = blocks[0]?.locale ?? 'en'
  return texts.map((text, index) => ({
    text,
    locale: texts.length === blocks.length ? (blocks[index]?.locale ?? lead) : lead,
  }))
}

/** The cue lines placed in a bar `barPt` tall, centred by their ink. */
function cuesIn(
  input: PrintFaceInput,
  lines: readonly Readonly<{ text: string; locale: GuestLocale }>[],
  barPt: number,
): readonly PrintCue[] {
  const { face, measurer } = input
  const cuePt = PRINT_MEASURES[face.region][face.piece].cuePt
  const baselines = placePrintCues(
    lines.map((line) => line.text),
    cuePt,
    barPt,
    measurer,
  )
  return lines.map((line, index) => ({ ...line, baselinePt: baselines[index] ?? 0 }))
}

/**
 * The brand of a face: the logo at its optical size (on its plate when it has
 * one), or the wordmark broken in `column` points. The front and the back page
 * set it alike.
 */
export function printBrandPart(
  brand: PrintBrandInput,
  face: PrintFace,
  column: number,
  align: PrintAlign,
  measurer: PrintTextMeasurer,
): PrintBuilt {
  if (brand.kind === 'logo') {
    const box = printBrandBox(face.piece, face.look, brand, brand.onPlate)
    return {
      parts: [{ key: 'brand', widthPt: box.widthPt, heightPt: box.heightPt }],
      contents: [{ kind: 'logo', box }],
    }
  }
  const style = printWordmarkStyle(face)
  // The wordmark is padded by its tracking on the left, so each line's box is symmetric about its ink.
  const room = column - style.trackingEm * style.sizePt
  const set = setPrintText(brand.text, style, room, align, measurer)
  if (set === null) return { parts: [], contents: [] }
  return {
    parts: [{ key: 'brand', widthPt: set.widthPt, heightPt: set.heightPt }],
    contents: [{ kind: 'wordmark', set }],
  }
}

function wordsOf(
  input: PrintFaceInput,
  words: readonly PrintWordsPart[],
  column: number,
  align: PrintAlign,
): PrintBuilt {
  const built = words.flatMap((word) => {
    const set = setPrintText(word.text, word.style, column, align, input.measurer)
    if (set === null) return []
    const content = { kind: 'words', set, locale: word.locale, tone: word.tone } as const
    return [
      {
        part: {
          key: word.key,
          widthPt: set.widthPt,
          heightPt: set.heightPt,
          lines: set.lines.length,
        },
        content,
      },
    ]
  })
  return { parts: built.map((b) => b.part), contents: built.map((b) => b.content) }
}

/** Every part of `face` at `headlinePt`, top to bottom, with what each draws. */
function buildFace(
  input: PrintFaceInput,
  face: PrintFace,
  headlinePt: number,
): PrintBuilt {
  const column = printTextColumn(face, input.tile.tilePt)
  const columnPt = column.rightPt - column.leftPt
  const align: PrintAlign = face.orientation === 'upright' ? 'centre' : 'left'
  const brand = printBrandPart(input.brand, face, columnPt, align, input.measurer)
  const { words, rule } = printWords(face, input.blocks, headlinePt)
  const firstLanguage = words.filter(
    (w) => !['headline2', 'subline2', 'secondLine'].includes(w.key),
  )
  const secondLanguage = words.filter((w) => !firstLanguage.includes(w))
  const first = wordsOf(input, firstLanguage, columnPt, align)
  const second = wordsOf(input, secondLanguage, columnPt, align)
  const ruleBox = printRule(face.piece)
  return {
    parts: [
      ...brand.parts,
      ...first.parts,
      ...(rule ? [{ key: 'rule', ...ruleBox } as const] : []),
      ...second.parts,
    ],
    contents: [
      ...brand.contents,
      ...first.contents,
      ...(rule ? [{ kind: 'rule' } as const] : []),
      ...second.contents,
    ],
  }
}

function planAt(
  input: PrintFaceInput,
  face: PrintFace,
  headlinePt: number,
  cueLineCount: number,
) {
  const built = buildFace(input, face, headlinePt)
  const code = printCodeBlock(face, input.tile, cueLineCount)
  return { ...built, code, plan: planPrintFace({ face, parts: built.parts, code }) }
}

/**
 * Lays out `input.face`: the headline at the largest size at which both
 * orientations of the piece fit (§5.3), then every part where the face's
 * planner puts it.
 */
export function layoutPrintFace(input: PrintFaceInput): PrintFaceLayout {
  const { face } = input
  const cueLines = cueLinesOf(input)
  const orientations =
    input.ownStepOnly === true ? [face.orientation] : PRINT_ORIENTATIONS
  const choice = choosePrintHeadline(face.piece, (headlinePt) =>
    orientations.every(
      (orientation) =>
        planAt(input, { ...face, orientation }, headlinePt, cueLines.length).plan.fits,
    ),
  )
  const laid = planAt(input, face, choice.headlinePt, cueLines.length)
  return {
    plan: laid.plan,
    contents: laid.contents,
    code: laid.code,
    cues: cuesIn(input, cueLines, laid.code.barPt),
    headlinePt: choice.headlinePt,
    overflows: !laid.plan.fits,
  }
}
