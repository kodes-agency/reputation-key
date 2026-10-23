// The sizes of the print kit (round-3 spec-delta S1, S3, S4 and S5): the trims,
// the spacing system, the photo band, the logo plate and what each size drops.
// The code tile per size is `portal-print-kit-code-tile.ts`; the type and the
// logo's optical sizes are `portal-print-kit-size-type.ts`.
//
// A face is built from three groups: the brand (logo or wordmark, and the name),
// the message (eyebrow, call to action, sub-line, second language) and the code
// block. The gaps inside a group are fixed and at most 6 pt; the two gaps between
// groups are flexible, have a minimum, and share any spare height equally. The
// spare height goes to those gaps and not to the photo, which is what removes the
// crowding.
//
// Everything is in points, as the measures are (1 in = 72 pt). The numbers are
// the design boards' own, copied from the generator that drew them, so the
// boards' rounded inches (0.4 in, 0.3 in) are 29 pt and 22 pt here. Nothing draws
// from this yet: today's faces still read `portal-print-kit-measures.ts`, and the
// old names (`WINDOW`, the 2 in margins) go when the faces move over.

import type {
  PrintKitPaper,
  PrintKitPiece,
  PrintKitSize,
  PrintKitStyle,
} from './portal-print-kit'
import { CARD_GRID, inToPt, mmToPt } from './portal-print-kit-measures'

type PerPaper<T> = Readonly<Record<PrintKitPaper, T>>
type PerStyle<T> = Readonly<Record<PrintKitStyle, T>>

export type Trim = Readonly<{ widthPt: number; heightPt: number }>

const trimOf = (grid: Trim): Trim => ({ widthPt: grid.widthPt, heightPt: grid.heightPt })

/** The trim of each size: inches on Letter, millimetres in Europe. Mini is portrait. */
export const SIZE_TRIM_PT: Readonly<Record<PrintKitSize, PerPaper<Trim>>> = {
  large: { letter: trimOf(CARD_GRID.paper.letter), a4: trimOf(CARD_GRID.paper.a4) },
  // 90 × 130 mm is the 9 × 13 cm photo size, 2 % off 3.5 × 5 in.
  table: {
    letter: { widthPt: inToPt(3.5), heightPt: inToPt(5) },
    a4: { widthPt: mmToPt(90), heightPt: mmToPt(130) },
  },
  mini: {
    letter: { widthPt: inToPt(2), heightPt: inToPt(3.5) },
    a4: { widthPt: mmToPt(55), heightPt: mmToPt(85) },
  },
}

const TENT_TRIM_PT: PerPaper<Trim> = {
  letter: { widthPt: inToPt(5), heightPt: inToPt(3.5) },
  a4: { widthPt: mmToPt(130), heightPt: mmToPt(90) },
}

/**
 * The small table tent, which is the `table_tent` piece at size Table: faces of
 * 5 × 3.5 in (130 × 90 mm), landscape, from a 5 × 7 in flat. The top edge is the
 * fold. The row (the words, a gap, the code block) is centred, so the fold
 * clearance is the foot margin: 0.9 in with a one-line bar.
 */
export const TENT_SMALL_FACE = {
  trimPt: TENT_TRIM_PT,
  /** The Immersive photo panel: full height, down the left of the face. */
  photoPanelPt: inToPt(1.2),
  /** Between the words and the code block. */
  rowGapPt: 14,
} as const

/** The four faces the size ladder draws. The tent is its own face: a landscape row, not a card. */
export const FACE_KINDS = Object.freeze(['large', 'table', 'tent', 'mini'] as const)
export type FaceKind = (typeof FACE_KINDS)[number]

/**
 * The face a piece has at a size: a card at any size is that size, and the
 * `table_tent` at size Table is the small tent. Today's Letter-half tent (the same
 * piece at size Large) keeps its own drawing until it is retired, and there is no
 * Mini tent: both answer null.
 */
export function faceKindOf(piece: PrintKitPiece, size: PrintKitSize): FaceKind | null {
  if (piece === 'counter_card') return size
  return size === 'table' ? 'tent' : null
}

/** The photo band across the top of an Immersive card. It keeps its target, and gives way to its minimum only when a face is tight. */
export const BAND: Readonly<
  Record<PrintKitSize, Readonly<{ targetPt: number; minPt: number }>>
> = {
  large: { targetPt: inToPt(1.3), minPt: inToPt(1.25) },
  table: { targetPt: inToPt(1.1), minPt: inToPt(0.95) },
  mini: { targetPt: inToPt(0.75), minPt: inToPt(0.65) },
}

export type FaceSpacing = Readonly<{
  /** The side margin; the tent's is 18 from the photo, 22 on Paper. */
  sidePt: PerStyle<number>
  /** The bottom margin, and the Paper top margin to ink. The tent's row is centred instead. */
  edgePt: number | null
  /** Logo to name; null where the name is dropped. */
  logoToNamePt: number | null
  /** Eyebrow to call to action; null where the eyebrow is dropped. */
  eyebrowToCtaPt: number | null
  ctaToSubPt: number
  /** Message to the second language, then its rule to the second call to action. */
  secondLanguage: Readonly<{ gapPt: number; ruleToCtaPt: number }> | null
  /** The least gap between two groups; null on the tent, whose brand and message stretch to the code block's height. */
  groupGapMinPt: number | null
}>

const bothStyles = (pt: number): PerStyle<number> => ({ immersive: pt, paper: pt })

export const FACE_SPACING: Readonly<Record<FaceKind, FaceSpacing>> = {
  large: {
    sidePt: bothStyles(22),
    edgePt: 29,
    logoToNamePt: 6,
    eyebrowToCtaPt: 4,
    ctaToSubPt: 3,
    secondLanguage: { gapPt: 9, ruleToCtaPt: 4.5 },
    groupGapMinPt: 14,
  },
  table: {
    sidePt: bothStyles(18),
    edgePt: 22,
    logoToNamePt: 5,
    eyebrowToCtaPt: 3.5,
    ctaToSubPt: 2.5,
    secondLanguage: { gapPt: 8, ruleToCtaPt: 4 },
    groupGapMinPt: 12,
  },
  tent: {
    sidePt: { immersive: 18, paper: 22 },
    edgePt: null,
    logoToNamePt: null,
    eyebrowToCtaPt: 3.5,
    ctaToSubPt: 2.5,
    secondLanguage: null,
    groupGapMinPt: null,
  },
  mini: {
    sidePt: bothStyles(14),
    edgePt: 14.4,
    logoToNamePt: null,
    eyebrowToCtaPt: null,
    ctaToSubPt: 2,
    secondLanguage: null,
    groupGapMinPt: 10,
  },
}

/** The cream plate under a logo: vertical and horizontal padding. */
export const LOGO_PLATE_PADDING_PT: Readonly<
  Record<FaceKind, Readonly<{ yPt: number; xPt: number }>>
> = {
  large: { yPt: mmToPt(2), xPt: mmToPt(3) },
  table: { yPt: mmToPt(1.7), xPt: mmToPt(2.6) },
  tent: { yPt: mmToPt(1.7), xPt: mmToPt(2.6) },
  mini: { yPt: mmToPt(1.4), xPt: mmToPt(2.2) },
}

export type FaceElements = Readonly<{
  /** Where the photo sits on Immersive: a band across the top, or a panel down the left. */
  photo: 'band' | 'panel'
  /** The property name under the logo. */
  name: boolean
  /** The portal title above the call to action. */
  eyebrow: boolean
  /**
   * The second language: its call to action alone on the same face (after a
   * rule, with no second sub-line), the whole second language on the other face,
   * or not at all.
   */
  secondLanguage: 'headline' | 'other-face' | 'dropped'
  /** The most cue lines the bar carries. */
  cueLines: 1 | 2
}>

/** What each face keeps (spec-delta S4): fewer elements, never squeezed. The logo, call to action and sub-line stay on every face. */
export const FACE_ELEMENTS: Readonly<Record<FaceKind, FaceElements>> = {
  large: {
    photo: 'band',
    name: true,
    eyebrow: true,
    secondLanguage: 'headline',
    cueLines: 2,
  },
  table: {
    photo: 'band',
    name: true,
    eyebrow: true,
    secondLanguage: 'headline',
    cueLines: 2,
  },
  tent: {
    photo: 'panel',
    name: false,
    eyebrow: true,
    secondLanguage: 'other-face',
    cueLines: 1,
  },
  mini: {
    photo: 'band',
    name: false,
    eyebrow: false,
    secondLanguage: 'dropped',
    cueLines: 1,
  },
}
