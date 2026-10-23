import { describe, expect, it } from 'vitest'
import { FIT, STACK, inToPt } from '#/shared/domain/portal-print-kit-measures'
import { immersiveFitSteps } from '#/shared/domain/portal-print-kit-immersive'
import {
  shareImmersiveHeight,
  sharedWithoutWindow,
  type MeasuredFit,
} from './print-kit-immersive-fit'

const RANGE = { minPt: inToPt(0.55), maxPt: inToPt(1.2), framePt: 4 }
const HEIGHT = inToPt(6)

const fit = (value: string, fixedPt: number, gapPt = FIT.gapPt.immersive) =>
  ({ value, gapPt, fixedPt }) satisfies MeasuredFit<string>

/** The face's height left for the window when the three gaps are at `gap` and the frame is drawn. */
const roomFor = (fixedPt: number, gapPt = FIT.gapPt.immersive) =>
  HEIGHT - fixedPt - 3 * gapPt - RANGE.framePt

describe('immersiveFitSteps', () => {
  it('tightens the gaps, then steps the type down, the brand shrinking first at each scale, for two languages on a card', () => {
    const tightPlace = STACK.gapsPt.twoTight.placeToHead
    expect(immersiveFitSteps(2, false)).toEqual([
      { gapPt: FIT.gapPt.immersive, scale: 'two', brand: 'full' },
      { gapPt: FIT.gapPt.tight, scale: 'two', placeToHeadPt: tightPlace, brand: 'full' },
      { gapPt: FIT.gapPt.tight, scale: 'two', placeToHeadPt: tightPlace, brand: 'floor' },
      { gapPt: FIT.gapPt.tight, scale: 'twoTight', brand: 'full' },
      { gapPt: FIT.gapPt.tight, scale: 'twoTight', brand: 'floor' },
    ])
  })

  it('starts a tent panel’s gaps at 3 mm, and has no type step for one language', () => {
    const steps = immersiveFitSteps(1, true)
    expect(steps.map((step) => step.gapPt)).toEqual([
      FIT.gapPt.tent,
      FIT.gapPt.tight,
      FIT.gapPt.tight,
    ])
    expect(steps.every((step) => step.scale === 'one')).toBe(true)
  })

  it('never takes a gap under 2 mm', () => {
    for (const step of [...immersiveFitSteps(2, true), ...immersiveFitSteps(1, false)]) {
      expect(step.gapPt).toBeGreaterThanOrEqual(FIT.gapPt.floor)
    }
  })
})

describe('shareImmersiveHeight', () => {
  it('grows the window to its cap first, then shares what is left between the two gaps', () => {
    const fixed = 200
    const shared = shareImmersiveHeight([fit('roomy', fixed)], HEIGHT, RANGE)
    expect(shared?.picturePt).toBe(RANGE.maxPt)
    const spare = (roomFor(fixed) - RANGE.maxPt) / 2
    expect(shared?.abovePt).toBeCloseTo(FIT.gapPt.immersive + spare, 10)
    expect(shared?.belowPt).toBeCloseTo(FIT.gapPt.immersive + spare, 10)
  })

  it('gives the window everything over the gaps’ minimum when it is under its cap (fit step a)', () => {
    const fixed = 330
    const shared = shareImmersiveHeight([fit('roomy', fixed)], HEIGHT, RANGE)
    expect(shared?.picturePt).toBeCloseTo(roomFor(fixed), 10)
    expect(shared?.abovePt).toBe(FIT.gapPt.immersive)
  })

  it('takes the first step that keeps the window at its floor', () => {
    // At 2.2 mm the window is a little under its floor; at 2 mm it reaches it.
    const fixed = HEIGHT - 3 * FIT.gapPt.tight - RANGE.framePt - RANGE.minPt - 0.1
    const shared = shareImmersiveHeight(
      [fit('roomy', fixed), fit('tight', fixed, FIT.gapPt.tight)],
      HEIGHT,
      RANGE,
    )
    expect(shared?.value).toBe('tight')
    expect(shared?.picturePt).toBeGreaterThanOrEqual(RANGE.minPt)
  })

  it('drops the window when no step reaches its floor, and sets the words at the roomiest step that fits', () => {
    const shared = shareImmersiveHeight(
      [fit('roomy', 390), fit('tight', 385, FIT.gapPt.tight)],
      HEIGHT,
      RANGE,
    )
    expect(shared?.picturePt).toBeNull()
    expect(shared?.value).toBe('roomy')
    expect(shared?.abovePt).toBeCloseTo((HEIGHT - 390) / 2, 10)
  })

  it('prints without a window when the face has none to give (decision D4)', () => {
    const shared = shareImmersiveHeight([fit('roomy', 200)], HEIGHT, null)
    expect(shared?.picturePt).toBeNull()
  })

  it('says nothing fits when not even the tightest step leaves the gaps their minimum', () => {
    expect(shareImmersiveHeight([fit('roomy', HEIGHT)], HEIGHT, RANGE)).toBeNull()
    expect(sharedWithoutWindow(fit('roomy', HEIGHT), HEIGHT).abovePt).toBe(
      FIT.gapPt.immersive,
    )
  })
})
