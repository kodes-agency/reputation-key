// The brand at the head of a card (round-2 spec-delta R1 and R2, round-3 S3):
// the property's logo, sized by its optical size and drawn clipped to its
// drawing, or its wordmark in tracked capitals.
//
// A logo's optical size holds the geometric mean of its drawn width and height,
// so a square mark prints as large as a wide badge; its height is then clamped
// (`logoOpticalHeightMm`). On Immersive every logo sits on the cream plate, and
// on Paper a logo too light for the paper sits on one in the field colour; the
// plate's padding is the size's. The margins are measured to ink, so the box a
// logo is placed by is its drawing (or its plate), and a wordmark says how far
// under the top of its box its caps start.

import { fitLines } from './portal-print-kit-text'
import {
  CARD_TEXT,
  cardTextStyle,
  type CardLine,
  type CardTextMeasure,
} from './portal-print-kit-card-words'
import { mmToPt } from './portal-print-kit-measures'
import { logoOpticalHeightMm, type LogoOptical } from './portal-print-kit-size-type'
import { stripUnsupportedCharacters } from './portal-print-kit-font-ranges'

export type CardBox = Readonly<{
  x: number
  y: number
  widthPt: number
  heightPt: number
}>

export type CardBrandInput =
  | Readonly<{
      kind: 'logo'
      /** The drawing's width over its height, measured to its ink. */
      inkAspect: number
      /** Whether it sits on a plate: every logo on Immersive, a light logo on Paper. */
      plate: boolean
    }>
  | Readonly<{ kind: 'wordmark'; text: string }>

/** The brand placed on the face. */
export type CardBrand =
  | Readonly<{ kind: 'logo'; ink: CardBox; plate: CardBox | null }>
  | Readonly<{ kind: 'wordmark'; lines: readonly CardLine[]; box: CardBox }>

/** The cream plate under a logo: its corners, and its soft shadow (CSS `0 0.5mm 1.6mm`, black at 28 %). */
export const CARD_PLATE = {
  radiusPt: mmToPt(1.6),
  shadow: { offsetYPt: mmToPt(0.5), blurPt: mmToPt(1.6), alpha: 0.28 },
} as const

/**
 * What the band holds with no photo: the brand's first letter, tone on tone on a
 * lighter ground at 62 % of the band's height and lifted 6 % of its size, between
 * two 12 mm rules 4 mm away (the round-3 boards' measures).
 */
export const CARD_BAND_MONOGRAM = {
  letterShare: 0.62,
  ruleLengthPt: mmToPt(12),
  ruleWeightPt: mmToPt(0.3),
  gapPt: mmToPt(4),
  dropEm: -0.06,
} as const

export type BrandPlan = Readonly<{
  /** The brand's box: the plate, the drawing, or the wordmark's lines. */
  heightPt: number
  /** Where its ink starts under the top of the box: 0 for a logo, the cap line for a wordmark. */
  inkTopPt: number
  /** The brand with the top of its box at `topPt`, centred across a face `faceWidthPt` wide. */
  at: (topPt: number, faceWidthPt: number) => CardBrand
}>

export type BrandSizing = Readonly<{
  logo: LogoOptical
  /** The plate's padding, top and bottom, and left and right. */
  platePadding: Readonly<{ yPt: number; xPt: number }>
  wordmarkPt: number
  /** The room across the face, for a wordmark. */
  columnPt: number
  measure: CardTextMeasure
  wordmarkInkTopPt: (sizePt: number) => number
}>

function logoPlan(
  brand: Extract<CardBrandInput, { kind: 'logo' }>,
  sizing: BrandSizing,
): BrandPlan {
  const inkHeight = mmToPt(logoOpticalHeightMm(brand.inkAspect, sizing.logo))
  const inkWidth = inkHeight * brand.inkAspect
  const pad = brand.plate ? sizing.platePadding : { xPt: 0, yPt: 0 }
  const height = inkHeight + 2 * pad.yPt
  const width = inkWidth + 2 * pad.xPt
  return {
    heightPt: height,
    inkTopPt: 0,
    at: (top, faceWidth) => {
      const left = (faceWidth - width) / 2
      return {
        kind: 'logo',
        ink: {
          x: left + pad.xPt,
          y: top + pad.yPt,
          widthPt: inkWidth,
          heightPt: inkHeight,
        },
        plate: brand.plate ? { x: left, y: top, widthPt: width, heightPt: height } : null,
      }
    },
  }
}

function wordmarkPlan(text: string, sizing: BrandSizing): BrandPlan {
  const { measure } = sizing
  const { floorPt, leading, pitchEm } = CARD_TEXT.wordmark
  const widthAt = (line: string, sizePt: number) =>
    measure(line, cardTextStyle('wordmark', sizePt))
  // A brand wider than the face shrinks to its floor before it takes a second line.
  const { lines, size } = fitLines({
    text: stripUnsupportedCharacters(text.toUpperCase()),
    size: sizing.wordmarkPt,
    minSize: Math.min(sizing.wordmarkPt, floorPt),
    maxLines: 2,
    maxWidth: sizing.columnPt,
    widthAt,
  })
  const lineBox = size * leading
  const height = lineBox + Math.max(0, lines.length - 1) * size * pitchEm
  const style = cardTextStyle('wordmark', size)
  return {
    heightPt: height,
    inkTopPt: sizing.wordmarkInkTopPt(size),
    at: (top, faceWidth) => {
      const placed = lines.map((line, index): CardLine => ({
        kind: 'line',
        role: 'wordmark',
        text: line,
        locale: null,
        style,
        topPt: top + index * size * pitchEm,
        heightPt: lineBox,
        widthPt: widthAt(line, size),
      }))
      const width = Math.max(0, ...placed.map((line) => line.widthPt))
      return {
        kind: 'wordmark',
        lines: placed,
        box: { x: (faceWidth - width) / 2, y: top, widthPt: width, heightPt: height },
      }
    },
  }
}

/** The brand's box at a sizing, and where its ink starts. */
export function planCardBrand(brand: CardBrandInput, sizing: BrandSizing): BrandPlan {
  return brand.kind === 'logo'
    ? logoPlan(brand, sizing)
    : wordmarkPlan(brand.text, sizing)
}
