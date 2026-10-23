// The measures of the print kit (spec sections 2, 4 and 5): the code
// block, the type scales, the grids of every piece, the margins and the photo
// window. The PDF (PDFKit) and the Share tab's preview (CSS) both read them, so
// a size has one home and the preview cannot drift from the file.
//
// Everything is stored in points (1 in = 72 pt, 1 mm = 72 / 25.4 pt), so inches
// and millimetres convert in one place and a design written in either lands on
// the same number. The numbers are the design boards' own, copied from the
// generator that produced them (`gen.mjs`), not derived again.

import { PRINT_KIT_QR_QUIET_ZONE_MODULES } from './portal-print-kit'
import type { PrintKitPaper, PrintKitStyle } from './portal-print-kit'

// ---------------------------------------------------------------------------
// Units

const POINTS_PER_INCH = 72
const POINTS_PER_MM = 72 / 25.4

export const inToPt = (inches: number): number => inches * POINTS_PER_INCH
export const mmToPt = (millimetres: number): number => millimetres * POINTS_PER_MM
export const ptToIn = (points: number): number => points / POINTS_PER_INCH
export const ptToMm = (points: number): number => points / POINTS_PER_MM

// ---------------------------------------------------------------------------
// The code block: one component, both styles, both regions (spec 2.3)

export const CODE_BLOCK = {
  /** The tile is square, and the bar under it is exactly as wide: its width is the size check. */
  tilePt: inToPt(2),
  /** Joined below the tile with no gap: 0.40 in for one cue line, 0.45 in for two. */
  barPt: { one: inToPt(0.4), two: inToPt(0.45) },
  /** What the bar grows by when the pictogram moves above a cue line that does not fit beside it. */
  barAbovePt: inToPt(0.08),
  /** The corner radius of the whole object: it clips only the tile's cream quiet zone. */
  radiusPt: inToPt(0.1),
  /** The Paper outline, drawn outside the tile so the bar stays 2 in wide. */
  outlinePt: mmToPt(0.35),
  /** Left and right padding of the bar. */
  barPaddingPt: inToPt(0.1),
  /** The camera pictogram's box, by cue lines. */
  iconPt: { one: inToPt(0.17), two: inToPt(0.18) },
  /** Between the pictogram and the cue. */
  iconGapPt: inToPt(0.07),
  /** The cue's size by cue lines, and the size it never goes under. */
  cuePt: { one: 9.5, two: 9 },
  cueFloorPt: 9,
  cueLeading: 1.12,
  cueTrackingEm: 0.005,
  /** Between the two cue lines of a two-language face. */
  cueGapPt: mmToPt(0.35),
} as const

/** How many cue lines a code block has: one language, or two. */
export type CueLines = keyof typeof CODE_BLOCK.cuePt

/** The tile and the bar together, for a bar of `barPt`. */
export const codeBlockHeightPt = (barPt: number): number => CODE_BLOCK.tilePt + barPt

/** The room for text beside the pictogram: the bar less its padding, the pictogram and its gap. */
export function cueRoomPt(lines: CueLines): number {
  return (
    CODE_BLOCK.tilePt -
    2 * CODE_BLOCK.barPaddingPt -
    CODE_BLOCK.iconPt[lines] -
    CODE_BLOCK.iconGapPt
  )
}

/**
 * The symbol of a code of `symbolModules` modules a side, in the 2 in tile: the
 * tile holds the symbol and its quiet zone, so a module is the tile over the
 * modules including the quiet zone on both sides.
 */
export function codeSymbolPt(symbolModules: number): number {
  const wholeModules = symbolModules + 2 * PRINT_KIT_QR_QUIET_ZONE_MODULES
  return (CODE_BLOCK.tilePt * symbolModules) / wholeModules
}

// ---------------------------------------------------------------------------
// Type (spec 2.2)

/**
 * The type scales, in points: the same in both regions and both styles. `two`
 * is a card with two languages, `twoTight` the same after fit step (c), `one` a
 * card with one language, `tent` a Paper tent face with two. The place label is
 * the largest type on every face; the lead call to action is 18 pt or more, and
 * 17 pt only on the stepped-down face.
 */
export const TYPE_PT = {
  two: { place: 24, place2: 9.5, head: 18, sub: 10, head2: 12.5, sub2: 9.5 },
  twoTight: { place: 22, place2: 9.5, head: 17, sub: 10, head2: 12, sub2: 9.5 },
  one: { place: 32, head: 22, sub: 12 },
  tent: { place: 40, place2: 12, head: 24, sub: 12.5, head2: 16, sub2: 11.5 },
} as const

export type TypeScale = keyof typeof TYPE_PT

/** Nothing a guest reads goes under these (fit step c stops at the place, headline and second headline floors). */
export const TYPE_FLOOR_PT = {
  read: 9,
  place: 21,
  head: 17,
  head2: 11.5,
  /** Print-check text that is cut away before use, and the print shop's slug line. */
  printCheck: 7,
  slug: 5,
} as const

/** The brand's wordmark: a Cormorant line of tracked capitals whose box is close to its cap height. */
export const WORDMARK = {
  pt: 16,
  /** On the Immersive A6 card, which has the least room. */
  ptImmersiveA6: 15,
  trackingEm: 0.16,
  lineBoxEm: 0.75,
} as const

/** The spacing and line heights of the stack of words, which the type scales above are set in. */
export const STACK = {
  /** Between the place label and its second-language title. */
  placeGapPt: mmToPt(0.9),
  /** Above the lead subline and the second subline. */
  subAbovePt: mmToPt(0.7),
  sub2AbovePt: mmToPt(0.4),
  /** Line heights, as a multiple of the type size. */
  leading: { place: 0.96, place2: 1.2, head: 1.05, sub: 1.25, head2: 1.08, sub2: 1.25 },
  trackingEm: { place: -0.005, place2: 0.02 },
  /** The rule between two languages, or between the place label and the call to action. */
  rule: {
    widthPt: mmToPt(9),
    weightPt: mmToPt(0.35),
    tentWidthPt: mmToPt(12),
    tentWeightPt: mmToPt(0.4),
  },
  /** `placeToHead`: the place block to the call to action, on two-language faces. `rule`: above and below the rule. */
  gapsPt: {
    two: { placeToHead: mmToPt(3.4), rule: mmToPt(2) },
    twoTight: { placeToHead: mmToPt(2.4), rule: mmToPt(2) },
    one: { rule: mmToPt(2.6) },
    tent: { placeToHead: mmToPt(6), rule: mmToPt(3.6) },
  },
} as const

// ---------------------------------------------------------------------------
// Margins (spec 2.5)

export const MARGIN = {
  /** The top and bottom margin, to ink: 0.4 in on Letter pieces, 10 mm on European ones. */
  letterPt: inToPt(0.4),
  a4Pt: mmToPt(10),
  /** Never below this, whatever the fit. */
  floorLetterPt: inToPt(0.35),
  floorA4Pt: mmToPt(9),
  /**
   * Where the ink starts inside the box it is measured from, so a padding is the
   * margin less (or plus) this. The wordmark's caps sit 0.3 mm under the top of
   * their 0.75 em line box; a supplied logo has 1.2 mm of transparent edge; the
   * Paper tile's outline is drawn outside the 2 in block.
   */
  optical: {
    wordmarkCapPt: mmToPt(0.3),
    logoEdgePt: mmToPt(1.2),
    outlinePt: mmToPt(0.35),
  },
} as const

/** The logo fits a box this size on every face, and gives up height to 10 mm before anything else. */
export const LOGO_BOX_MM = { width: 60, height: 15 } as const
export const LOGO_FLOOR_MM = 10

/** The plate under a logo that would not read on its own ground (spec 3.1 and 3.2). */
export const LOGO_PLATE = {
  paddingYPt: mmToPt(2),
  paddingXPt: mmToPt(2.5),
  radiusPt: mmToPt(1.6),
} as const

/**
 * A logo printed at fewer dots per inch than this looks soft, and the manager is
 * warned. It is never refused: a soft logo is better than no print.
 */
export const LOGO_MIN_DPI = 150

/** The dots per inch an image of `pixels` across prints at when drawn `drawnPt` wide. */
export const printedDpi = (pixels: number, drawnPt: number): number =>
  drawnPt <= 0 ? Number.POSITIVE_INFINITY : pixels / ptToIn(drawnPt)

// ---------------------------------------------------------------------------
// The Immersive photo window (spec 5.2)

export const WINDOW = {
  /** It grows from its floor to its cap, and is the first thing to give way. */
  minPt: inToPt(0.55),
  maxPt: inToPt(1.2),
  tentMaxPt: inToPt(1.35),
  /** The frame is a border and a padding round the picture. */
  frame: {
    borderPt: mmToPt(0.3),
    paddingPt: mmToPt(0.7),
    outerRadiusPt: mmToPt(2.7),
    innerRadiusPt: mmToPt(1.8),
  },
  /** With no photo: the brand's first letter between two rules. */
  monogram: {
    letterShare: 0.74,
    ruleLengthPt: mmToPt(16),
    ruleWeightPt: mmToPt(0.3),
    gapPt: mmToPt(4),
  },
} as const

// ---------------------------------------------------------------------------
// Fit (spec 2.5): what gives, in what order, when a face is tight

/** A step is taken only when the one before it is used up. */
export const FIT_ORDER = Object.freeze(['window', 'gaps', 'type', 'monogram'] as const)
export type FitStep = (typeof FIT_ORDER)[number]

export const FIT = {
  /** The flexible gaps' minimum on an Immersive card, and after fit step (b). No gap between two groups is ever less. */
  gapPt: { immersive: mmToPt(2.2), tight: mmToPt(2), tent: mmToPt(3), floor: mmToPt(2) },
  /** On Paper: under the brand, and above the code block. */
  paperGapPt: { brand: mmToPt(4), code: mmToPt(3) },
  /** The brand gives up size last: a wordmark to 15 pt, a logo to its floor. */
  wordmarkFloorPt: 15,
  logoFloorPt: mmToPt(LOGO_FLOOR_MM),
} as const

// ---------------------------------------------------------------------------
// The grids of the pieces (spec 4 and 5)

type Pieces<T> = Readonly<Record<PrintKitPaper, T>>

export type CardGrid = Readonly<{
  /** The trim. */
  widthPt: number
  heightPt: number
  /** Margins to ink: top and bottom are equal. */
  sidePt: number
  marginPt: number
  /** The bleed round the trim; none on Paper. */
  bleedPt: number
  /** The paper outside the trim on an Immersive page, bleed and slug together. */
  trimOriginPt: number
}>

/** 4 × 6 in on Letter, A6 on A4; Paper has no bleed, Immersive 1/8 in or 3 mm. */
export const CARD_GRID: Readonly<Record<PrintKitStyle, Pieces<CardGrid>>> = {
  paper: {
    letter: {
      widthPt: inToPt(4),
      heightPt: inToPt(6),
      sidePt: inToPt(0.3),
      marginPt: MARGIN.letterPt,
      bleedPt: 0,
      trimOriginPt: 0,
    },
    a4: {
      widthPt: mmToPt(105),
      heightPt: mmToPt(148),
      sidePt: mmToPt(7.5),
      marginPt: MARGIN.a4Pt,
      bleedPt: 0,
      trimOriginPt: 0,
    },
  },
  immersive: {
    letter: {
      widthPt: inToPt(4),
      heightPt: inToPt(6),
      sidePt: inToPt(0.3),
      marginPt: MARGIN.letterPt,
      bleedPt: inToPt(0.125),
      trimOriginPt: inToPt(0.375),
    },
    a4: {
      widthPt: mmToPt(105),
      heightPt: mmToPt(148),
      sidePt: mmToPt(7.5),
      marginPt: MARGIN.a4Pt,
      bleedPt: mmToPt(3),
      trimOriginPt: mmToPt(10),
    },
  },
}

export type TentFaceGrid = Readonly<{
  /** One face of the folded sheet: its top edge is the fold, its bottom edge a sheet edge. */
  widthPt: number
  heightPt: number
  sidePt: number
  /** No ink comes closer to the fold than this. */
  foldClearancePt: number
}>

/** The Paper tent: US Letter folded to 8.5 × 5.5 in faces, A4 folded to A5 landscape. */
export const TENT_FACE_GRID: Pieces<TentFaceGrid> = {
  letter: {
    widthPt: inToPt(8.5),
    heightPt: inToPt(5.5),
    sidePt: inToPt(0.4),
    foldClearancePt: inToPt(0.45),
  },
  a4: {
    widthPt: mmToPt(210),
    heightPt: mmToPt(148.5),
    sidePt: mmToPt(10),
    foldClearancePt: mmToPt(11),
  },
}

/** What a Paper tent face is built from, in both regions. */
export const TENT_FACE = {
  logoHeightPt: mmToPt(13.5),
  /** The logo is shifted left by this, to cancel its transparent edge optically. */
  logoShiftPt: mmToPt(-1.3),
  /** The words and the code column sit in a row, this far apart. */
  rowGapPt: mmToPt(12),
  /** Between the logo and the row, at least. */
  logoToRowMinPt: mmToPt(4),
  /** The code column's top sits on the place label's cap line, this far under its line box. */
  codeTopOffsetPt: mmToPt(2.45),
} as const

export type ImmersiveTentGrid = Readonly<{
  /** One panel, as it stands. */
  widthPt: number
  heightPt: number
  sidePt: number
  marginPt: number
  /** The ridge band over the fold: this tall on each panel. */
  ridgePt: number
  bleedPt: number
  trimOriginPt: number
}>

/** The Immersive tent: two card-size panels, 4 × 12 in flat on Letter, 105 × 296 mm on A4. */
export const IMMERSIVE_TENT_GRID: Pieces<ImmersiveTentGrid> = {
  letter: {
    widthPt: inToPt(4),
    heightPt: inToPt(6),
    sidePt: inToPt(0.3),
    marginPt: MARGIN.letterPt,
    ridgePt: inToPt(0.18),
    bleedPt: inToPt(0.125),
    trimOriginPt: inToPt(0.375),
  },
  a4: {
    widthPt: mmToPt(105),
    heightPt: mmToPt(148),
    sidePt: mmToPt(7.5),
    marginPt: MARGIN.a4Pt,
    ridgePt: mmToPt(4.5),
    bleedPt: mmToPt(3),
    trimOriginPt: mmToPt(10),
  },
}

/** The wordmark on a Paper tent face, when the property has no logo: the boards draw a logo there. */
export const TENT_WORDMARK_PT = 20

/** The logo's height on an Immersive tent panel. */
export const IMMERSIVE_TENT_LOGO_PT = mmToPt(11.6)
