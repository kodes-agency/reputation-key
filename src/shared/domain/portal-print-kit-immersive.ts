// What the Immersive style adds to the shared measures (spec 3.2, 5.2 to 5.4):
// the photo window of each face shape, the monogram that stands in for a photo,
// the dim a photo gets under white type, and the print shop's marks round a page
// (crop marks outside the bleed, fold marks in the side slugs, and the slug line
// that names the piece). Pure and shared: the PDF draws these and the Share tab's
// Whole sheet preview draws the same ones.
//
// Everything is in points, as the measures are; a page's marks are placed from
// its trim, with the origin at the page's top-left corner.

import type { PrintFaceSide, PrintKitPaper, PrintKitPiece } from './portal-print-kit'
import { stripUnsupportedCharacters } from './portal-print-kit-font-ranges'
import {
  CARD_GRID,
  FIT,
  IMMERSIVE_TENT_GRID,
  IMMERSIVE_TENT_LOGO_PT,
  LOGO_BOX_MM,
  LOGO_MIN_DPI,
  STACK,
  WINDOW,
  WORDMARK,
  inToPt,
  mmToPt,
  type TypeScale,
} from './portal-print-kit-measures'
import type { PanelGeometry, PrintKitPage } from './portal-print-kit-sheets'

// ---------------------------------------------------------------------------
// The photo window (spec 5.2 and 5.3)

export type ImmersiveGeometry = Extract<
  PanelGeometry,
  'card4x6' | 'cardA6' | 'tentPanel4x6' | 'tentPanelA6'
>

const IMMERSIVE_GEOMETRIES: ReadonlySet<PanelGeometry> = new Set([
  'card4x6',
  'cardA6',
  'tentPanel4x6',
  'tentPanelA6',
])

export type ImmersiveGrid = Readonly<{
  /** The trim of one face. */
  widthPt: number
  heightPt: number
  sidePt: number
  /** The top and bottom margin, to ink. */
  marginPt: number
  /** The ridge band over the fold on a tent panel; null on a card. */
  ridgePt: number | null
}>

/** The grid of an Immersive face shape. */
export function immersiveGridOf(geometry: ImmersiveGeometry): ImmersiveGrid {
  switch (geometry) {
    case 'card4x6':
      return { ...CARD_GRID.immersive.letter, ridgePt: null }
    case 'cardA6':
      return { ...CARD_GRID.immersive.a4, ridgePt: null }
    case 'tentPanel4x6':
      return IMMERSIVE_TENT_GRID.letter
    case 'tentPanelA6':
      return IMMERSIVE_TENT_GRID.a4
  }
}

export const isImmersiveGeometry = (
  geometry: PanelGeometry,
): geometry is ImmersiveGeometry => IMMERSIVE_GEOMETRIES.has(geometry)

export const isTentPanel = (geometry: PanelGeometry): boolean =>
  geometry === 'tentPanel4x6' || geometry === 'tentPanelA6'

/** The frame round the picture, on each side: its border and its padding. */
export const WINDOW_FRAME_PT = WINDOW.frame.borderPt + WINDOW.frame.paddingPt

/** The window's outer width: the face less its side margins, as the boards stretch it. */
export function windowWidthPt(geometry: ImmersiveGeometry): number {
  const grid = immersiveGridOf(geometry)
  return grid.widthPt - 2 * grid.sidePt
}

/**
 * The picture's height inside the window, at its floor and at its cap: 0.55 in
 * to 1.2 in on a card, to 1.35 in on a tent panel. The frame adds its border and
 * padding round it.
 */
export function windowPictureRangePt(
  geometry: ImmersiveGeometry,
): Readonly<{ minPt: number; maxPt: number }> {
  return {
    minPt: WINDOW.minPt,
    maxPt: isTentPanel(geometry) ? WINDOW.tentMaxPt : WINDOW.maxPt,
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * The monogram's letter: the first grapheme of the wordmark, in capitals, as the
 * wordmark is set. Empty when the wordmark has nothing the fonts can set.
 */
export function monogramLetter(wordmark: string): string {
  const text = stripUnsupportedCharacters(wordmark).trim()
  const [first] = graphemes.segment(text)
  return first === undefined ? '' : first.segment.toLocaleUpperCase()
}

/**
 * How strongly a photo is dimmed in the field colour so white type near it
 * holds: nothing for a dark crop, more the lighter it is, never past 0.45. `L` is
 * the crop's mean relative luminance, 0 to 1.
 */
export function photoDim(luminance: number): number {
  return Math.min(0.45, Math.max(0, (luminance - 0.3) * 1.1))
}

// ---------------------------------------------------------------------------
// The fit order (spec 2.5): what an Immersive face tries, roomiest first

/** One way to set a face: the gap under the brand and the gaps' minimum, the type, the brand's size. */
export type ImmersiveFitStep = Readonly<{
  gapPt: number
  scale: TypeScale
  /** The place block to the call to action, when step (b) has tightened it. */
  placeToHeadPt?: number
  brand: 'full' | 'floor'
}>

/**
 * The steps a face tries, roomiest first: (b) the gaps tighten, then (c) two
 * languages step their type down, and at each type scale the brand tries its
 * full size and then its floor. The brand ranks last of everything a face keeps
 * (spec 2.5), so it gives way before the place label steps down, and the window,
 * which every step tries before the next, never gives way to it; once the type
 * has stepped down the brand is full again if it fits. A card's gaps start at
 * 2.2 mm and a tent panel's at 3 mm; step (b) takes both to 2 mm, the least any
 * gap between two groups may be, and the place block's gap from 3.4 to 2.4 mm.
 * Step (a), the window shrinking, happens inside every step; step (d), dropping
 * the window, after the last.
 */
export function immersiveFitSteps(
  languages: number,
  tent: boolean,
): readonly ImmersiveFitStep[] {
  const roomy = tent ? FIT.gapPt.tent : FIT.gapPt.immersive
  const tight = FIT.gapPt.tight
  const tightPlace = STACK.gapsPt.twoTight.placeToHead
  if (languages < 2) {
    return [
      { gapPt: roomy, scale: 'one', brand: 'full' },
      { gapPt: tight, scale: 'one', brand: 'full' },
      { gapPt: tight, scale: 'one', brand: 'floor' },
    ]
  }
  return [
    { gapPt: roomy, scale: 'two', brand: 'full' },
    { gapPt: tight, scale: 'two', placeToHeadPt: tightPlace, brand: 'full' },
    { gapPt: tight, scale: 'two', placeToHeadPt: tightPlace, brand: 'floor' },
    { gapPt: tight, scale: 'twoTight', brand: 'full' },
    { gapPt: tight, scale: 'twoTight', brand: 'floor' },
  ]
}

/**
 * The brand's size on an Immersive face at a step: a 16 pt wordmark (15 pt on the
 * two-language A6 card, which has the least room), a logo 15 mm tall on a card
 * and 11.6 mm on a tent panel; at its floor a 15 pt wordmark or a 10 mm logo.
 */
export function immersiveBrandSize(
  geometry: ImmersiveGeometry,
  languages: number,
  size: ImmersiveFitStep['brand'],
): Readonly<{ wordmarkPt: number; logoHeightPt: number }> {
  if (size === 'floor') {
    return { wordmarkPt: FIT.wordmarkFloorPt, logoHeightPt: FIT.logoFloorPt }
  }
  return {
    wordmarkPt:
      geometry === 'cardA6' && languages > 1 ? WORDMARK.ptImmersiveA6 : WORDMARK.pt,
    logoHeightPt: isTentPanel(geometry)
      ? IMMERSIVE_TENT_LOGO_PT
      : mmToPt(LOGO_BOX_MM.height),
  }
}

/** Decision D4: two languages leave a tent panel no room for a window, photo or monogram. */
export const wantsWindow = (geometry: ImmersiveGeometry, languages: number): boolean =>
  !(isTentPanel(geometry) && languages > 1)

/** A photo printed at fewer of its own pixels per inch than a logo may looks soft too, and is reported. */
export const PHOTO_MIN_DPI = LOGO_MIN_DPI

// ---------------------------------------------------------------------------
// The print shop's marks (spec 5.3)

/** How far off the trim the marks run: they start outside the bleed. */
const MARK_SPAN_PT: Readonly<
  Record<PrintKitPaper, Readonly<{ from: number; to: number }>>
> = {
  letter: { from: inToPt(0.175), to: inToPt(0.355) },
  a4: { from: mmToPt(4), to: mmToPt(9) },
}

/** The paper round a print shop's bleed, as the preview shows the page: the shop's sheet is white. */
export const PRINT_SHOP_PAGE = '#FFFFFF'

export const PRINT_SHOP_MARK = {
  weightPt: mmToPt(0.2),
  /** The fold marks' dashes, and the gaps between them. */
  dashPt: mmToPt(0.8),
  /** The slug line: 5 pt, the least a print shop's line may be (spec 2.2). */
  slug: {
    sizePt: 5,
    colour: '#5C5650',
    topPt: { letter: inToPt(0.19), a4: mmToPt(4.8) },
  },
} as const

export type MarkLine = Readonly<{ x1: number; y1: number; x2: number; y2: number }>

export type PrintShopMarks = Readonly<{
  /** Two lines at each corner of the trim, pointing away from the art. */
  crop: readonly MarkLine[]
  /** Dashed, in both side slugs, on the fold; none on a flat card. */
  fold: readonly MarkLine[]
  /** Where the slug line sits: centred under the trim, between the bottom marks. */
  slug: Readonly<{ centreXPt: number; topPt: number; widthPt: number }>
}>

/** The marks round an Immersive page on its paper. */
export function printShopMarks(page: PrintKitPage, paper: PrintKitPaper): PrintShopMarks {
  const { from, to } = MARK_SPAN_PT[paper]
  const left = page.trim.leftPt
  const right = left + page.trim.widthPt
  const top = page.trim.topPt
  const bottom = top + page.trim.heightPt
  const crop = [left, right].flatMap((x) => {
    const out = x === left ? -1 : 1
    return [top, bottom].flatMap((y) => {
      const away = y === top ? -1 : 1
      return [
        { x1: x + out * from, y1: y, x2: x + out * to, y2: y },
        { x1: x, y1: y + away * from, x2: x, y2: y + away * to },
      ]
    })
  })
  const foldY = page.foldAtPt
  const fold =
    foldY === null
      ? []
      : [
          { x1: left - to, y1: foldY, x2: left - from, y2: foldY },
          { x1: right + from, y1: foldY, x2: right + to, y2: foldY },
        ]
  return {
    crop,
    fold,
    slug: {
      centreXPt: left + page.trim.widthPt / 2,
      topPt: bottom + PRINT_SHOP_MARK.slug.topPt[paper],
      widthPt: page.trim.widthPt - 2 * from,
    },
  }
}

const TRIM_FACTS: Readonly<
  Record<PrintKitPaper, Readonly<Record<PrintKitPiece, readonly string[]>>>
> = {
  letter: {
    counter_card: ['trim 4 × 6 in', 'bleed 1/8 in'],
    table_tent: ['trim 4 × 12 in', 'bleed 1/8 in', 'fold 6 in', 'score'],
  },
  a4: {
    counter_card: ['trim 105 × 148 mm', 'bleed 3 mm'],
    table_tent: ['trim 105 × 296 mm', 'bleed 3 mm', 'fold 148 mm', 'score'],
  },
}

const PIECE_NAME: Readonly<Record<PrintKitPiece, string>> = {
  counter_card: 'counter card',
  table_tent: 'table tent',
}

/**
 * The slug lines a page may carry, longest first: the brand, the place, the
 * piece (and which face, for a card with a back), then the trim, bleed and fold.
 * The page prints the first that fits between its bottom marks; the facts the
 * print shop needs are in every one.
 */
export function printShopSlugLines(
  piece: PrintKitPiece,
  paper: PrintKitPaper,
  names: Readonly<{ brand: string; place: string; side: PrintFaceSide | null }>,
): readonly string[] {
  const pieceName =
    names.side === null ? PIECE_NAME[piece] : `${PIECE_NAME[piece]}, ${names.side}`
  const facts = [pieceName, ...TRIM_FACTS[paper][piece]]
  const named = [names.brand, names.place].filter((name) => name.trim() !== '')
  return [[...named, ...facts], [...named.slice(0, 1), ...facts], facts].map((parts) =>
    parts.join(' · '),
  )
}
