import { describe, expect, it } from 'vitest'
import {
  PRINT_PLATE,
  printBrandBox,
  printLogoOnPlate,
  printLogoSize,
} from './portal-print-brand'
import { ptMm } from './portal-print-measures'
import {
  PRINT_TYPE,
  PRINT_TYPE_SETTINGS,
  choosePrintHeadline,
  printHeadlineFloorPt,
  printHeadlineSteps,
  printKickerTrackingEm,
  printSublineWeight,
} from './portal-print-type'

const mm = (pt: number) => Number(ptMm(pt).toFixed(2))
/** The stand-in logos' drawn pixels: the Harborline badge and the Oakmere mark. */
const HARBORLINE = { inkWidth: 22.8, inkHeight: 12.68 }
const OAKMERE = { inkWidth: 13.24, inkHeight: 12.99 }

describe('the type scale (spec 3)', () => {
  it('sets the headline 28 / 19 / 15 pt, the Small card in the sans', () => {
    expect(PRINT_TYPE.counter.headlinePt).toBe(28)
    expect(PRINT_TYPE.tent.headlinePt).toBe(19)
    expect(PRINT_TYPE.small.headlinePt).toBe(15)
    expect(PRINT_TYPE.small.headlineFamily).toBe('sans')
    expect(PRINT_TYPE.counter.headlineFamily).toBe('serif')
  })

  it('gives the Small card no kicker', () => {
    expect(PRINT_TYPE.small.kickerPt).toBeNull()
    expect(PRINT_TYPE.counter.kickerPt).toBe(9.5)
    expect(PRINT_TYPE.tent.kickerPt).toBe(8)
  })

  it('sets the small second line at the sub-line size', () => {
    for (const piece of ['counter', 'tent', 'small'] as const) {
      expect(PRINT_TYPE[piece].secondLinePt).toBe(PRINT_TYPE[piece].sublinePt)
    }
  })

  it('leads and tracks the shared roles as the design sets them', () => {
    expect(PRINT_TYPE_SETTINGS.wordmark).toEqual({ leading: 1.15, trackingEm: 0.3 })
    expect(PRINT_TYPE_SETTINGS.subline.leading).toBe(1.25)
    expect(PRINT_TYPE_SETTINGS.cue).toEqual({ leading: 1.12, lineGapMm: 0.3 })
    expect(PRINT_TYPE_SETTINGS.headlineToSubline).toBe(1.8)
    expect(PRINT_TYPE_SETTINGS.secondHeadlineToSubline).toBe(1.25)
  })

  it('tracks the kicker 0.16 em on Paper and 0.30 / 0.24 em on Immersive', () => {
    expect(printKickerTrackingEm('paper', 'upright')).toBe(0.16)
    expect(printKickerTrackingEm('immersive', 'upright')).toBe(0.3)
    expect(printKickerTrackingEm('immersive', 'wide')).toBe(0.24)
  })

  it('sets reversed sub-lines under 9 pt semibold: the Immersive Small card only', () => {
    expect(printSublineWeight('small', 'immersive')).toBe(600)
    expect(printSublineWeight('small', 'paper')).toBe(400)
    expect(printSublineWeight('tent', 'immersive')).toBe(400)
  })
})

describe('long copy (spec 5.3)', () => {
  it('never steps the headline under 1.8 × the sub-line: 20, 16.5 and 14.5 pt', () => {
    expect(printHeadlineFloorPt('counter')).toBe(20)
    expect(printHeadlineFloorPt('tent')).toBe(16.5)
    expect(printHeadlineFloorPt('small')).toBe(14.5)
  })

  it('steps 1 pt at a time, the floor last', () => {
    expect(printHeadlineSteps('tent')).toEqual([19, 18, 17, 16.5])
    expect(printHeadlineSteps('small')).toEqual([15, 14.5])
    expect(printHeadlineSteps('counter')).toEqual([28, 27, 26, 25, 24, 23, 22, 21, 20])
  })

  it('keeps the size when the words fit, and never grows it', () => {
    expect(choosePrintHeadline('counter', () => true)).toEqual({
      headlinePt: 28,
      overflows: false,
    })
  })

  it('takes the first size at which both orientations fit', () => {
    const asked: number[] = []
    const choice = choosePrintHeadline('tent', (pt) => {
      asked.push(pt)
      return pt <= 18
    })
    expect(choice).toEqual({ headlinePt: 18, overflows: false })
    expect(asked).toEqual([19, 18])
  })

  it('stops at the floor and says the words overflow when nothing fits', () => {
    expect(choosePrintHeadline('tent', () => false)).toEqual({
      headlinePt: 16.5,
      overflows: true,
    })
  })
})
describe('the logo (spec 4)', () => {
  it('sizes the Harborline badge on Paper 12.68 / 8.20 / 6.71 mm tall', () => {
    expect(mm(printLogoSize('counter', 'paper', HARBORLINE).heightPt)).toBe(12.68)
    expect(mm(printLogoSize('tent', 'paper', HARBORLINE).heightPt)).toBe(8.2)
    expect(mm(printLogoSize('small', 'paper', HARBORLINE).heightPt)).toBe(6.71)
  })

  it('caps the near-square Oakmere mark on Immersive at 13 / 8.5 / 7 mm', () => {
    expect(mm(printLogoSize('counter', 'immersive', OAKMERE).heightPt)).toBe(13)
    expect(mm(printLogoSize('tent', 'immersive', OAKMERE).heightPt)).toBe(8.5)
    expect(mm(printLogoSize('small', 'immersive', OAKMERE).heightPt)).toBe(7)
  })

  it('keeps a very wide logo within wMax and a very tall one at hMax', () => {
    const wide = printLogoSize('counter', 'paper', {
      inkWidth: 1000,
      inkHeight: 100,
    })
    expect(mm(wide.widthPt)).toBe(38)
    const tall = printLogoSize('counter', 'paper', { inkWidth: 100, inkHeight: 400 })
    expect(mm(tall.heightPt)).toBe(14)
  })

  it('puts any logo that is not light on the cream plate on Immersive, never on Paper', () => {
    expect(
      printLogoOnPlate('immersive', {
        medianInkLuminance: 0.09,
        ringContrast: 0.86,
      }),
    ).toBe(true)
    expect(
      printLogoOnPlate('immersive', { medianInkLuminance: 0.9, ringContrast: null }),
    ).toBe(true)
    expect(
      printLogoOnPlate('immersive', { medianInkLuminance: 0.9, ringContrast: 3.2 }),
    ).toBe(true)
    expect(
      printLogoOnPlate('immersive', { medianInkLuminance: 0.9, ringContrast: 6.1 }),
    ).toBe(false)
    expect(
      printLogoOnPlate('paper', { medianInkLuminance: 0.09, ringContrast: null }),
    ).toBe(false)
  })

  it('pads the plate 2 / 3 mm on the Counter card, 1.3 / 2 mm on the tent and 1 / 1.6 mm on the Small card', () => {
    const counter = printBrandBox('counter', 'immersive', OAKMERE, true)
    expect([mm(counter.widthPt), mm(counter.heightPt)]).toEqual([19.25, 17])
    const tent = printBrandBox('tent', 'immersive', OAKMERE, true)
    expect(mm(tent.heightPt)).toBe(11.1)
    const small = printBrandBox('small', 'immersive', OAKMERE, true)
    expect(mm(small.heightPt)).toBe(9)
    const bare = printBrandBox('counter', 'paper', HARBORLINE, false)
    expect(bare.paddingPt).toEqual({ v: 0, h: 0 })
    expect(mm(PRINT_PLATE.radiusPt)).toBe(1.4)
  })
})
