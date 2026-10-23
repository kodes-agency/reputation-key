// How a Large card shares its height, and what gives when it is tight (round-3
// spec-delta S3 and S4, on the fit order of round-2 spec-delta "Fit order").
//
// A card is three groups (brand, message, code) with two flexible gaps between
// them. The gaps have a minimum and share any spare height equally; the photo
// band keeps its target and gives way only to its minimum. When even the band at
// its minimum leaves the gaps short, the card steps down, one step at a time and
// each only once the one before is used up:
//
//   1. the eyebrow, 10 to 9 pt;
//   2. the call to action, 28 to 24 pt on Immersive and 30 to 26 pt on Paper,
//      and from there to one line, down to 20 pt, where it would wrap;
//   3. the lead sub-line, 11 to 10 pt;
//   4. the logo, to Table's optical size;
//   5. the second call to action, 15 to 13 pt;
//   6. the name line under the logo, which the logo carries on its own.
//
// Round 2 ends its steps at a 24 pt call to action and a smaller logo; round 3
// keeps Paper 2 pt above Immersive on every size and gives Large no floor of its
// own for the logo, so its floor is the next size down. The name goes last of
// all, as the tent and Mini drop it (S4). A card that reaches the gaps' minimum
// stops at the first step that does. One that cannot takes every type step and
// lets its gaps go under the minimum, as the two-language Table board does,
// down to 2 mm, the least any gap between two groups is; only past that does it
// drop the name. With today's long address Large prints its 2 in tile, so its
// gaps are smaller than the boards' 1.75 in ones, and a two-language Immersive
// card with a logo and a two-line name drops the name until the address is short.

import type { PrintKitStyle } from './portal-print-kit'
import { FIT } from './portal-print-kit-measures'
import {
  FACE_TYPE_PT,
  LOGO_OPTICAL,
  type LogoOptical,
} from './portal-print-kit-size-type'
import type { CardMessageType } from './portal-print-kit-card-words'

export type CardFitStep = CardMessageType &
  Readonly<{
    /** The logo's optical size: the size's own, or its floor. */
    logo: LogoOptical
    /** Whether the name line under a logo prints. */
    name: boolean
  }>

/** The least the call to action is set at to keep one line, once it has stepped down. */
export const CARD_CTA_ONE_LINE_FLOOR_PT = 20

/** What the call to action steps down by, in points. */
const CTA_STEP_PT = 4

/** The steps a Large card tries, roomiest first. */
export function largeCardFitSteps(style: PrintKitStyle): readonly CardFitStep[] {
  const type = FACE_TYPE_PT.large
  const cta = style === 'immersive' ? type.ctaImmersive : type.ctaPaper
  const full: CardFitStep = {
    eyebrowPt: type.eyebrow ?? 0,
    ctaPt: cta,
    ctaOneLineFloorPt: null,
    subPt: type.sub,
    cta2Pt: type.cta2 ?? 0,
    logo: LOGO_OPTICAL.large[style],
    name: true,
  }
  const eyebrow = { ...full, eyebrowPt: 9 }
  const callToAction = {
    ...eyebrow,
    ctaPt: cta - CTA_STEP_PT,
    ctaOneLineFloorPt: CARD_CTA_ONE_LINE_FLOOR_PT,
  }
  const sub = { ...callToAction, subPt: type.sub - 1 }
  const logo = { ...sub, logo: LOGO_OPTICAL.table[style] }
  const second = { ...logo, cta2Pt: (type.cta2 ?? 0) - 2 }
  return [full, eyebrow, callToAction, sub, logo, second, { ...second, name: false }]
}

/** The photo band's target and minimum; null on Paper, which has none. */
export type CardBand = Readonly<{ targetPt: number; minPt: number }> | null

export type CardShare = Readonly<{
  /** The band's height; null with no band. */
  bandPt: number | null
  /** Each of the two gaps between the groups. */
  gapPt: number
}>

/**
 * The band and the two gaps of a face `heightPt` tall whose other parts take
 * `fixedPt`: the band at its target unless the gaps would fall under `gapMinPt`,
 * then shrinking to its minimum; the gaps take what is left, equally.
 */
export function shareCardHeight(
  input: Readonly<{ heightPt: number; fixedPt: number; band: CardBand }>,
  gapMinPt: number,
): CardShare {
  const free = input.heightPt - input.fixedPt
  if (input.band === null) return { bandPt: null, gapPt: free / 2 }
  const { targetPt, minPt } = input.band
  const bandPt = Math.min(targetPt, Math.max(minPt, free - 2 * gapMinPt))
  return { bandPt, gapPt: (free - bandPt) / 2 }
}

export type CardFitChoice<T> = CardShare &
  Readonly<{ step: CardFitStep; index: number; value: T }>

/**
 * The step a card prints at: the first whose gaps reach `gapMinPt`; else, every
 * type step taken, the gaps under their minimum but not under the 2 mm floor;
 * else the last step, without the name. `measure` lays the card out at a step
 * and says what its parts other than the band and the gaps take.
 */
export function chooseCardFit<T>(
  steps: readonly CardFitStep[],
  frame: Readonly<{ heightPt: number; band: CardBand; gapMinPt: number }>,
  measure: (step: CardFitStep) => Readonly<{ fixedPt: number; value: T }>,
): CardFitChoice<T> {
  const at = (index: number): CardFitChoice<T> | null => {
    const step = steps[index]
    if (step === undefined) return null
    const { fixedPt, value } = measure(step)
    const share = shareCardHeight(
      { heightPt: frame.heightPt, fixedPt, band: frame.band },
      frame.gapMinPt,
    )
    return { ...share, step, index, value }
  }
  const last = steps.length - 1
  let tightest: CardFitChoice<T> | null = null
  for (let index = 0; index < last; index += 1) {
    tightest = at(index)
    if (tightest !== null && tightest.gapPt >= frame.gapMinPt) return tightest
  }
  if (tightest !== null && tightest.gapPt >= FIT.gapPt.floor) return tightest
  const chosen = at(last) ?? tightest
  if (chosen === null) throw new Error('A card has at least one way to be set')
  return chosen
}
