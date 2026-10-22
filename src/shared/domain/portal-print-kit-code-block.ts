// The code block's plan: which cue lines it carries, where its pictogram goes
// and how tall its bar is (spec 2.3 and 2.4). Pure and shared: the PDF draws
// from the plan with measured text, the Share tab's preview with the widths
// this file keeps, so both place the pictogram the same way.
//
// A cue line fits beside the pictogram, at its nominal size or at 9 pt, or the
// pictogram moves above the lines and the bar grows by 0.08 in. The cue never
// goes under 9 pt.

import type { GuestLocale } from './guest-locale'
import { PRINT_KIT_MAX_LANGUAGES, PRINT_KIT_SCAN_CUE } from './portal-print-kit'
import {
  CODE_BLOCK,
  codeBlockHeightPt,
  cueRoomPt,
  type CueLines,
} from './portal-print-kit-measures'
import type { PrintKitStylePalette } from './portal-print-kit-palette'

/** One line of the cue in the bar, with the language it is set in. */
export type CueLine = Readonly<{ text: string; locale: GuestLocale }>

/** The cue lines of a face: the lead language first, then the second below it. */
export function cueLinesFor(locales: readonly GuestLocale[]): readonly CueLine[] {
  return locales
    .slice(0, PRINT_KIT_MAX_LANGUAGES)
    .map((locale) => ({ text: PRINT_KIT_SCAN_CUE[locale], locale }))
}

/** The pictogram: a camera in strokes on a 24-unit grid (a body and a lens). */
export const CAMERA_ICON = {
  grid: 24,
  strokeWidth: 1.7,
  body: 'M3.5 8.5a2 2 0 0 1 2-2h2.3l1.5-2.2h5.4l1.5 2.2h2.3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
  lens: { cx: 12, cy: 12.8, r: 3.6 },
} as const

export type CodeBlockColours = Readonly<{
  barFill: string
  barText: string
  /** The Paper outline, drawn outside the 2 in: cream on paper is only 1.1:1. None on Immersive. */
  outline: string | null
}>

/** The colours the code block is drawn in, from a style's palette. */
export function codeBlockColours(palette: PrintKitStylePalette): CodeBlockColours {
  return {
    barFill: palette.barFill,
    barText: palette.barText,
    outline: palette.style === 'paper' ? palette.accentInk : null,
  }
}

export type CodeBlockPlan = Readonly<{
  /** How many cue lines: one language, or two. */
  lines: CueLines
  cuePt: number
  iconPt: number
  /** The pictogram sits above the lines, because a line does not fit beside it. */
  iconAbove: boolean
  barPt: number
  /** The tile and the bar together. */
  heightPt: number
}>

/**
 * Where the pictogram goes and how tall the bar is, for `cues`. `widthAt`
 * measures a cue line set at a size in points, tracking included.
 */
export function planCodeBlock(
  cues: readonly CueLine[],
  widthAt: (cue: CueLine, sizePt: number) => number,
): CodeBlockPlan {
  const lines: CueLines = cues.length > 1 ? 'two' : 'one'
  const widest = (sizePt: number) =>
    Math.max(0, ...cues.map((cue) => widthAt(cue, sizePt)))
  // Nominal first; the floor is the last size a line may be set at.
  const sizes = [...new Set([CODE_BLOCK.cuePt[lines], CODE_BLOCK.cueFloorPt])]
  const beside = sizes.find((size) => widest(size) <= cueRoomPt(lines))
  const iconPt = CODE_BLOCK.iconPt[lines]
  if (beside !== undefined) {
    const barPt = CODE_BLOCK.barPt[lines]
    return {
      lines,
      cuePt: beside,
      iconPt,
      iconAbove: false,
      barPt,
      heightPt: codeBlockHeightPt(barPt),
    }
  }
  const fullRoom = CODE_BLOCK.tilePt - 2 * CODE_BLOCK.barPaddingPt
  const cuePt = sizes.find((size) => widest(size) <= fullRoom) ?? CODE_BLOCK.cueFloorPt
  const barPt = CODE_BLOCK.barPt[lines] + CODE_BLOCK.barAbovePt
  return {
    lines,
    cuePt,
    iconPt,
    iconAbove: true,
    barPt,
    heightPt: codeBlockHeightPt(barPt),
  }
}

/** One cue line's height, and the whole block of cue lines with the gap between them. */
export const cueLineHeightPt = (plan: CodeBlockPlan): number =>
  plan.cuePt * CODE_BLOCK.cueLeading

export const cueBlockHeightPt = (plan: CodeBlockPlan, count: number): number =>
  count * cueLineHeightPt(plan) + Math.max(0, count - 1) * CODE_BLOCK.cueGapPt

/** The tracking of a cue line, in points. */
export const cueTrackingPt = (sizePt: number): number => sizePt * CODE_BLOCK.cueTrackingEm

/**
 * The width of each language's cue, in ems, set in Ysabeau Office 600 without
 * tracking. The cue copy is fixed, so its width is a constant: the preview cannot
 * measure a font, and an average advance is too coarse to tell 1.43 in from 1.56
 * in in a room of 1.55. `print-kit-code-block.test.ts` measures the PDF's fonts
 * and fails when this table or the copy drifts.
 */
export const SCAN_CUE_WIDTH_EM: Readonly<Record<GuestLocale, number>> = {
  en: 9.509,
  es: 9.258,
  bg: 10.586,
  it: 11.28,
  fr: 12.301,
  de: 10.201,
}

/** What the preview takes a cue line to measure at `sizePt`, tracking included. */
export function estimatedCueWidthPt(cue: CueLine, sizePt: number): number {
  const letters = [...cue.text].length
  const advanceEm =
    cue.text === PRINT_KIT_SCAN_CUE[cue.locale]
      ? SCAN_CUE_WIDTH_EM[cue.locale]
      : // Another text: a wide average, so it errs toward moving the pictogram.
        letters * AVERAGE_ADVANCE_EM
  // The tracking after the last letter is not part of the line, as in the PDF's measure.
  return advanceEm * sizePt + Math.max(0, letters - 1) * cueTrackingPt(sizePt)
}

/** The average advance of Ysabeau Office 600, in ems, erring wide. */
const AVERAGE_ADVANCE_EM = 0.47
