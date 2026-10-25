// Whether a call to action fits a final print (final design spec §5.5 and §5.7),
// answered by the planner the PDF uses: Share's menu greys a wording the chosen
// print would refuse, "Write your own…" says how the manager's words print, and
// "These words on every card" ticks each piece and orientation. Pure and shared:
// the caller hands in how a face is laid out (the preview's estimated measures in
// the browser, the guest fonts in tests), so the answers are the planner's, never
// a character count's.

import type { GuestLocale } from './guest-locale'
import type { PrintTextBlock } from './portal-print-kit'
import {
  printFinalLanguageMode,
  type PrintFinalFace,
  type PrintFinalLanguageMode,
  type PrintFinalOrientation,
  type PrintFinalPiece,
} from './portal-print-final'
import {
  PRINT_FINAL_CALLS_TO_ACTION,
  printFinalHeldLanguage,
  type PrintFinalCallToAction,
} from './portal-print-final-copy'
import type { PrintFinalFaceLayout } from './portal-print-final-face'
import type { PrintFinalPartKey } from './portal-print-final-parts'
import { PRINT_FINAL_TYPE } from './portal-print-final-type'

/** Lays out one face of the print with these words; `ownStepOnly` steps for that orientation alone. */
export type PrintFinalLayoutFor = (
  face: PrintFinalFace,
  blocks: readonly PrintTextBlock[],
  ownStepOnly?: boolean,
) => PrintFinalFaceLayout

/** How the words print: at full size, stepped down, or refused even at the floor. */
export type PrintFinalFitState = 'full' | 'step' | 'refused'

export type PrintFinalWordsFit = Readonly<{
  state: PrintFinalFitState
  headlinePt: number
  /** Lines of the first headline and of its sub-line (0 with none). */
  headlineLines: number
  sublineLines: number
  /** The other orientation of the piece refuses these words. */
  otherRefused: boolean
  /** This orientation alone would print at full size: the step is the other orientation's. */
  steppedForOther: boolean
  /** How a second language prints: in full under a rule, as one small line, or there is none. */
  secondMode: PrintFinalLanguageMode
  secondRefused: boolean
  /** Lines of the second language's sub-line: 0 where it is left out (the one small line) or empty. */
  secondSublineLines: number
}>

const otherOf = (orientation: PrintFinalOrientation): PrintFinalOrientation =>
  orientation === 'upright' ? 'wide' : 'upright'

const linesOf = (layout: PrintFinalFaceLayout, key: PrintFinalPartKey): number =>
  layout.plan.parts.find((part) => part.key === key)?.lines ?? 0

/** The state of a layout: refused at the floor, stepped under the piece's full size, or full. */
const stateOf = (
  layout: PrintFinalFaceLayout,
  piece: PrintFinalPiece,
): PrintFinalFitState => {
  if (layout.overflows) return 'refused'
  return layout.headlinePt < PRINT_FINAL_TYPE[piece].headlinePt ? 'step' : 'full'
}

/** How `blocks` print on `face`, both orientations of the piece sharing the step (§5.3). */
export function printFinalWordsFit(
  face: PrintFinalFace,
  blocks: readonly PrintTextBlock[],
  layoutFor: PrintFinalLayoutFor,
): PrintFinalWordsFit {
  const laid = layoutFor(face, blocks)
  const state = stateOf(laid, face.piece)
  const otherRefused = layoutFor(
    { ...face, orientation: otherOf(face.orientation) },
    blocks,
  ).overflows
  const steppedForOther =
    state === 'step' && stateOf(layoutFor(face, blocks, true), face.piece) === 'full'
  const secondMode = printFinalLanguageMode(face, blocks.length)
  const secondLines = linesOf(laid, secondMode === 'line' ? 'secondLine' : 'headline2')
  return {
    state,
    headlinePt: laid.headlinePt,
    headlineLines: linesOf(laid, 'headline'),
    sublineLines: linesOf(laid, 'subline'),
    otherRefused,
    steppedForOther,
    secondMode,
    secondRefused: state === 'refused' && blocks.length > 1 && secondLines > 0,
    secondSublineLines: linesOf(laid, 'subline2'),
  }
}

/** Cut off with the words that fit: the trailing comma or dash a cut leaves goes too. */
const TRAILING_PUNCTUATION = /[\s,;:–—-]+$/u

/**
 * "Shorten by about N" (§5.7): the characters typed past the longest run of
 * whole words, from the start, that `fits` takes, at least 1. The planner is
 * asked about 4 times, bisecting over the word cuts. Null when not even the first
 * word fits, so no cut helps.
 */
export function printFinalShortenBy(
  headline: string,
  fits: (headline: string) => boolean,
): number | null {
  const words = headline.split(' ')
  const cut = (count: number) =>
    words.slice(0, count).join(' ').replace(TRAILING_PUNCTUATION, '')
  let low = 0
  let high = words.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fits(cut(middle))) low = middle
    else high = middle - 1
  }
  if (low === 0) return null
  return Math.max(1, [...headline].length - [...cut(low)].length)
}

/** One wording in Share's menu, checked against the chosen print. */
export type PrintFinalMenuRow = Readonly<{
  preset: PrintFinalCallToAction
  /** `held`: rule F holds its copy back in `heldIn` (§5.5); `too_long`: the planner refuses it here. */
  state: 'fits' | 'too_long' | 'held'
  heldIn: GuestLocale | null
}>

/**
 * Every wording of the menu against the chosen print (piece, orientation, look,
 * paper and languages). `blocksOf` gives the print's blocks for a wording.
 */
export function printFinalMenuRows(
  face: PrintFinalFace,
  languages: readonly GuestLocale[],
  blocksOf: (preset: PrintFinalCallToAction) => readonly PrintTextBlock[],
  layoutFor: PrintFinalLayoutFor,
): readonly PrintFinalMenuRow[] {
  return PRINT_FINAL_CALLS_TO_ACTION.map((preset) => {
    const heldIn = printFinalHeldLanguage(preset, languages)
    if (heldIn !== null) return { preset, state: 'held', heldIn }
    const refused = layoutFor(face, blocksOf(preset)).overflows
    return { preset, state: refused ? 'too_long' : 'fits', heldIn: null }
  })
}

/** One line of "These words on every card": a piece in an orientation, and how the words print there. */
export type PrintFinalEveryCardRow = Readonly<{
  piece: PrintFinalPiece
  orientation: PrintFinalOrientation
  state: PrintFinalFitState
  headlinePt: number
  secondMode: PrintFinalLanguageMode
}>

/** The board's order: tents, Counter cards, Small cards, each wide then upright. */
const EVERY_CARD_ORDER: readonly PrintFinalPiece[] = ['tent', 'counter', 'small']
const WIDE_FIRST: readonly PrintFinalOrientation[] = ['wide', 'upright']

/** The same words on every piece, both ways up, in the chosen look and paper (§5.7, panel 9). */
export function printFinalEveryCard(
  face: Pick<PrintFinalFace, 'look' | 'region'>,
  blocks: readonly PrintTextBlock[],
  layoutFor: PrintFinalLayoutFor,
): readonly PrintFinalEveryCardRow[] {
  return EVERY_CARD_ORDER.flatMap((piece) =>
    WIDE_FIRST.map((orientation) => {
      const each = { ...face, piece, orientation }
      const laid = layoutFor(each, blocks)
      return {
        piece,
        orientation,
        state: stateOf(laid, piece),
        headlinePt: laid.headlinePt,
        secondMode: printFinalLanguageMode(each, blocks.length),
      }
    }),
  )
}
