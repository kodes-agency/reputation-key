// The final print kit's measures (final design spec §2, §4 and §5): one table,
// piece × region, holding the trim, the margin M and its unit u, the bottom, the
// code tile and its bar, the cue, the type floor, the holder zone, the logo's
// optical sizes and the plate padding. The live area of a face (the margins a
// tent's fold or an office sheet's guard adds) is `printFinalLiveArea`.
//
// Everything is stored in points (1 in = 72 pt, 1 mm = 72 / 25.4 pt). The
// numbers are the design's own, copied from the generator that drew and
// measured the boards (`final-engine.mjs`, PIECES, EU and geo()), not derived
// again; the golden tests hold the planners to the boards' measurements.

import type {
  PrintFinalFace,
  PrintFinalLook,
  PrintFinalPiece,
  PrintFinalRegion,
} from './portal-print-final'

// ---------------------------------------------------------------------------
// Units

const POINTS_PER_INCH = 72
const MM_PER_INCH = 25.4

export const inPt = (inches: number): number => inches * POINTS_PER_INCH
export const mmPt = (millimetres: number): number =>
  (millimetres / MM_PER_INCH) * POINTS_PER_INCH
export const ptMm = (points: number): number => (points / POINTS_PER_INCH) * MM_PER_INCH

// ---------------------------------------------------------------------------
// The table

export type PrintFinalBars = Readonly<{
  /** The bar under the tile with one cue line, and with two (two languages, or a wrapped cue). */
  onePt: number
  twoPt: number
}>

export type PrintFinalMeasures = Readonly<{
  /** The upright trim; the wide trim is the same turned a quarter. */
  shortPt: number
  longPt: number
  /** The margin at the sides and the top, in both orientations. */
  marginPt: number
  /** The bottom margin: 1.25 M in the US, a rounded millimetre value in Europe. */
  bottomPt: number
  /** The spacing unit, M / 4: 1u inside a group, 2u round the language rule, 4u to 8u between groups. */
  unitPt: number
  /** The cream square on the short address (version 3, 37 modules with the quiet zone). */
  tilePt: number
  bars: PrintFinalBars
  /** The scan cue's size. */
  cuePt: number
  /** Nothing a guest reads goes under this (rule 1.6). */
  typeFloorPt: number
  /** The strip at the bottom a holder hides, kept clear of anything read (fixed rule H). */
  holderPt: number
}>

const US: Readonly<Record<PrintFinalPiece, PrintFinalMeasures>> = {
  counter: {
    shortPt: inPt(4),
    longPt: inPt(6),
    marginPt: inPt(3 / 8),
    bottomPt: inPt((3 / 8) * 1.25),
    unitPt: inPt(3 / 32),
    tilePt: inPt(1.5),
    bars: { onePt: inPt(0.36), twoPt: inPt(0.46) },
    cuePt: 9,
    typeFloorPt: 9,
    holderPt: inPt(1 / 4),
  },
  tent: {
    shortPt: inPt(2.75),
    longPt: inPt(4.25),
    marginPt: inPt(1 / 4),
    bottomPt: inPt((1 / 4) * 1.25),
    unitPt: inPt(1 / 16),
    tilePt: inPt(1.4),
    bars: { onePt: inPt(0.3), twoPt: inPt(0.38) },
    cuePt: 9,
    typeFloorPt: 8,
    holderPt: 0,
  },
  small: {
    shortPt: inPt(2),
    longPt: inPt(3.5),
    marginPt: inPt(3 / 16),
    bottomPt: inPt((3 / 16) * 1.25),
    unitPt: inPt(3 / 64),
    tilePt: inPt(1.25),
    bars: { onePt: inPt(0.27), twoPt: inPt(0.3) },
    cuePt: 8,
    typeFloorPt: 8,
    holderPt: inPt(3 / 16),
  },
}

/** Europe changes the trim, the margins and the tile; the bars, the cue and the floors stay the US ones. */
const europe = (
  piece: PrintFinalPiece,
  mm: Readonly<{
    short: number
    long: number
    margin: number
    bottom: number
    tile: number
  }>,
): PrintFinalMeasures => ({
  ...US[piece],
  shortPt: mmPt(mm.short),
  longPt: mmPt(mm.long),
  marginPt: mmPt(mm.margin),
  bottomPt: mmPt(mm.bottom),
  unitPt: mmPt(mm.margin / 4),
  tilePt: mmPt(mm.tile),
})

const EU: Readonly<Record<PrintFinalPiece, PrintFinalMeasures>> = {
  counter: europe('counter', {
    short: 105,
    long: 148,
    margin: 9.5,
    bottom: 12,
    tile: 38,
  }),
  tent: europe('tent', { short: 74.25, long: 105, margin: 6.5, bottom: 8, tile: 36 }),
  small: europe('small', { short: 54, long: 85, margin: 5, bottom: 6, tile: 32 }),
}

export const PRINT_FINAL_MEASURES: Readonly<
  Record<PrintFinalRegion, Readonly<Record<PrintFinalPiece, PrintFinalMeasures>>>
> = Object.freeze({ us: US, eu: EU })

/**
 * The Counter card on today's long address (§9): a version 9 symbol needs a
 * 2.1 in tile to keep its modules over 0.85 mm, with taller bars. Tents and
 * Small cards have no such tile; they wait for the short address.
 */
export const PRINT_FINAL_LONG_ADDRESS_COUNTER = Object.freeze({
  tilePt: inPt(2.1),
  bars: Object.freeze({ onePt: inPt(0.4), twoPt: inPt(0.5) }),
})

/**
 * The step-up ladder (§2.1), kept as data: if phone test 1 fails a tile on
 * density, that piece steps up one rung, in both regions. Every layout holds at
 * the larger tile except the wide Small card, whose live height (1.58 in) cannot
 * take a 1.4 in tile and its bar (1.67 in).
 */
export const PRINT_FINAL_TILE_STEP_UP_PT: Readonly<Record<PrintFinalPiece, number>> =
  Object.freeze({ counter: inPt(1.75), tent: inPt(1.5), small: inPt(1.4) })

export type PrintFinalTileRung = 'base' | 'step_up'

// ---------------------------------------------------------------------------
// Fixed distances

export const PRINT_FINAL_DISTANCES = Object.freeze({
  /** The Immersive tent's pale low-ink strip at the fold, on each face (§6.5). */
  foldStripPt: inPt(0.1),
  /** A Paper tent's ink stays this far from the fold, and every tent's this far from its base (rule 1.7). */
  tentFoldPt: inPt(0.2),
  tentBasePt: inPt(0.35),
  /** Paper office sheets: ink this far from the paper's short edges and its long edges (§10.1). */
  guardShortPt: inPt(0.5),
  guardLongPt: inPt(0.34),
  /** What a photo or ground runs past the trim on a sheet or a print-shop page. */
  bleedPt: Object.freeze({ us: inPt(1 / 8), eu: mmPt(3) }),
  /** Upright Immersive: the photo stops this far above the code block (§6.2). */
  photoAboveCodePt: inPt(0.12),
  /** The Paper outline, drawn outside the cream square and the bar (§5.2). */
  outlinePt: mmPt(0.35),
  /** The tile and bar's corner radius, as a share of the tile's width (§5.2). */
  tileRadiusShare: 0.05,
  /** The rule between two languages (§5.4). */
  ruleThicknessPt: mmPt(0.35),
})

/** The rule between two languages is this long (§5.4). */
export const PRINT_FINAL_RULE_LENGTH_PT: Readonly<Record<PrintFinalPiece, number>> =
  Object.freeze({ counter: mmPt(8), tent: mmPt(6), small: mmPt(5) })

/** Five outline stars above the kicker, on the Counter card only (§5.1). */
export const PRINT_FINAL_STARS = Object.freeze({
  pieces: Object.freeze(['counter'] as readonly PrintFinalPiece[]),
  count: 5,
  sizePt: inPt(0.13),
  /** The space between two stars, as a share of a star's size. */
  gapShare: 0.38,
  strokePt: mmPt(0.3),
})

// ---------------------------------------------------------------------------
// The live area

export type PrintFinalBox = Readonly<{
  leftPt: number
  topPt: number
  rightPt: number
  bottomPt: number
}>

export type PrintFinalLiveArea = Readonly<{
  widthPt: number
  heightPt: number
  marginPt: number
  unitPt: number
  /** Where ink may go, from the trim's top-left corner. */
  live: PrintFinalBox
  /** The Immersive tent's fold strip at the top; 0 elsewhere. */
  foldStripPt: number
  holderPt: number
}>

type Edges = Readonly<{ side: number; top: number; bottom: number }>

/**
 * A tent's edges: its top is the fold and its bottom the base. The Paper face
 * always prints on an office quarter or strip, so it carries the sheet's guard in
 * its own margins: the base on a short edge, and the sides on the long edges
 * when wide or the short edges when upright (§2.2).
 */
function tentEdges(face: PrintFinalFace, base: Edges): Edges {
  const D = PRINT_FINAL_DISTANCES
  const bottom = Math.max(base.bottom, D.tentBasePt)
  if (face.look === 'immersive') {
    return { side: base.side, top: D.foldStripPt + base.top, bottom }
  }
  const sideGuard = face.orientation === 'wide' ? D.guardLongPt : D.guardShortPt
  return {
    side: Math.max(base.side, sideGuard),
    top: Math.max(base.top, D.tentFoldPt),
    bottom: Math.max(bottom, D.guardShortPt),
  }
}

/** The Paper A6 card prints 4 to an A4 sheet as quarters, so the edges that meet the sheet's edge keep its guard (§2.2). */
function paperA6Edges(face: PrintFinalFace, base: Edges): Edges {
  const guard = PRINT_FINAL_DISTANCES.guardShortPt
  if (face.orientation === 'upright') {
    return {
      ...base,
      top: Math.max(base.top, guard),
      bottom: Math.max(base.bottom, guard),
    }
  }
  return { ...base, side: Math.max(base.side, guard) }
}

function edgesOf(face: PrintFinalFace, m: PrintFinalMeasures): Edges {
  const base = { side: m.marginPt, top: m.marginPt, bottom: m.bottomPt }
  if (face.piece === 'tent') return tentEdges(face, base)
  if (face.piece === 'counter' && face.region === 'eu' && face.look === 'paper') {
    return paperA6Edges(face, base)
  }
  return base
}

/** The trim and the live area of one face: the same margin in both orientations, "bottom" always the edge a holder or a table hides. */
export function printFinalLiveArea(face: PrintFinalFace): PrintFinalLiveArea {
  const m = PRINT_FINAL_MEASURES[face.region][face.piece]
  const upright = face.orientation === 'upright'
  const widthPt = upright ? m.shortPt : m.longPt
  const heightPt = upright ? m.longPt : m.shortPt
  const edges = edgesOf(face, m)
  return {
    widthPt,
    heightPt,
    marginPt: m.marginPt,
    unitPt: m.unitPt,
    live: {
      leftPt: edges.side,
      topPt: edges.top,
      rightPt: widthPt - edges.side,
      bottomPt: heightPt - edges.bottom,
    },
    foldStripPt:
      face.piece === 'tent' && face.look === 'immersive'
        ? PRINT_FINAL_DISTANCES.foldStripPt
        : 0,
    holderPt: m.holderPt,
  }
}

/** Whether a look draws the Paper outline round the tile. */
export const printFinalOutlinePt = (look: PrintFinalLook): number =>
  look === 'paper' ? PRINT_FINAL_DISTANCES.outlinePt : 0
