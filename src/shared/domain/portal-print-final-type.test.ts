import { describe, expect, it } from 'vitest'
import {
  PRINT_FINAL_PLATE,
  printFinalBrandBox,
  printFinalLogoOnPlate,
  printFinalLogoSize,
} from './portal-print-final-brand'
import { ptMm } from './portal-print-final-measures'
import {
  PRINT_FINAL_TYPE,
  PRINT_FINAL_TYPE_SETTINGS,
  choosePrintFinalHeadline,
  printFinalHeadlineFloorPt,
  printFinalHeadlineSteps,
  printFinalKickerTrackingEm,
  printFinalSublineWeight,
  printFinalTypeProblems,
} from './portal-print-final-type'

const mm = (pt: number) => Number(ptMm(pt).toFixed(2))
/** The stand-in logos' drawn pixels: the Harborline badge and the Oakmere mark. */
const HARBORLINE = { inkWidth: 22.8, inkHeight: 12.68 }
const OAKMERE = { inkWidth: 13.24, inkHeight: 12.99 }

describe('the type scale (spec 3)', () => {
  it('sets the headline 28 / 19 / 15 pt, the Small card in the sans', () => {
    expect(PRINT_FINAL_TYPE.counter.headlinePt).toBe(28)
    expect(PRINT_FINAL_TYPE.tent.headlinePt).toBe(19)
    expect(PRINT_FINAL_TYPE.small.headlinePt).toBe(15)
    expect(PRINT_FINAL_TYPE.small.headlineFamily).toBe('sans')
    expect(PRINT_FINAL_TYPE.counter.headlineFamily).toBe('serif')
  })

  it('gives the Small card no kicker', () => {
    expect(PRINT_FINAL_TYPE.small.kickerPt).toBeNull()
    expect(PRINT_FINAL_TYPE.counter.kickerPt).toBe(9.5)
    expect(PRINT_FINAL_TYPE.tent.kickerPt).toBe(8)
  })

  it('sets the small second line at the sub-line size', () => {
    for (const piece of ['counter', 'tent', 'small'] as const) {
      expect(PRINT_FINAL_TYPE[piece].secondLinePt).toBe(PRINT_FINAL_TYPE[piece].sublinePt)
    }
  })

  it('leads and tracks the shared roles as the design sets them', () => {
    expect(PRINT_FINAL_TYPE_SETTINGS.wordmark).toEqual({ leading: 1.15, trackingEm: 0.3 })
    expect(PRINT_FINAL_TYPE_SETTINGS.subline.leading).toBe(1.25)
    expect(PRINT_FINAL_TYPE_SETTINGS.cue).toEqual({ leading: 1.12, lineGapMm: 0.3 })
    expect(PRINT_FINAL_TYPE_SETTINGS.headlineToSubline).toBe(1.8)
    expect(PRINT_FINAL_TYPE_SETTINGS.secondHeadlineToSubline).toBe(1.25)
  })

  it('tracks the kicker 0.16 em on Paper and 0.30 / 0.24 em on Immersive', () => {
    expect(printFinalKickerTrackingEm('paper', 'upright')).toBe(0.16)
    expect(printFinalKickerTrackingEm('immersive', 'upright')).toBe(0.3)
    expect(printFinalKickerTrackingEm('immersive', 'wide')).toBe(0.24)
  })

  it('sets reversed sub-lines under 9 pt semibold: the Immersive Small card only', () => {
    expect(printFinalSublineWeight('small', 'immersive')).toBe(600)
    expect(printFinalSublineWeight('small', 'paper')).toBe(400)
    expect(printFinalSublineWeight('tent', 'immersive')).toBe(400)
  })
})

describe('long copy (spec 5.3)', () => {
  it('never steps the headline under 1.8 × the sub-line: 20, 16.5 and 14.5 pt', () => {
    expect(printFinalHeadlineFloorPt('counter')).toBe(20)
    expect(printFinalHeadlineFloorPt('tent')).toBe(16.5)
    expect(printFinalHeadlineFloorPt('small')).toBe(14.5)
  })

  it('steps 1 pt at a time, the floor last', () => {
    expect(printFinalHeadlineSteps('tent')).toEqual([19, 18, 17, 16.5])
    expect(printFinalHeadlineSteps('small')).toEqual([15, 14.5])
    expect(printFinalHeadlineSteps('counter')).toEqual([
      28, 27, 26, 25, 24, 23, 22, 21, 20,
    ])
  })

  it('keeps the size when the words fit, and never grows it', () => {
    expect(choosePrintFinalHeadline('counter', () => true)).toEqual({
      headlinePt: 28,
      overflows: false,
    })
  })

  it('takes the first size at which both orientations fit', () => {
    const asked: number[] = []
    const choice = choosePrintFinalHeadline('tent', (pt) => {
      asked.push(pt)
      return pt <= 18
    })
    expect(choice).toEqual({ headlinePt: 18, overflows: false })
    expect(asked).toEqual([19, 18])
  })

  it('stops at the floor and says the words overflow when nothing fits', () => {
    expect(choosePrintFinalHeadline('tent', () => false)).toEqual({
      headlinePt: 16.5,
      overflows: true,
    })
  })
})

describe('the ratio rules (spec 3)', () => {
  it('passes every piece at its own sizes, one language and two', () => {
    for (const piece of ['counter', 'tent', 'small'] as const) {
      const scale = PRINT_FINAL_TYPE[piece]
      expect(printFinalTypeProblems(piece, scale.headlinePt, null)).toEqual([])
      expect(
        printFinalTypeProblems(piece, scale.headlinePt, scale.secondHeadlinePt),
      ).toEqual([])
      expect(
        printFinalTypeProblems(
          piece,
          printFinalHeadlineFloorPt(piece),
          scale.secondHeadlinePt,
        ),
      ).toEqual([])
    }
  })

  it('holds the second headline to 1.25 × its sub-line and under the first', () => {
    expect(printFinalTypeProblems('small', 15, 9.5)).toEqual([
      'second_headline_too_small',
    ])
    expect(printFinalTypeProblems('tent', 16.5, 16.5)).toEqual([
      'second_headline_not_smaller',
    ])
    expect(printFinalTypeProblems('counter', 19, null)).toEqual(['headline_under_floor'])
  })
})

describe('the logo (spec 4)', () => {
  it('sizes the Harborline badge on Paper 12.68 / 8.20 / 6.71 mm tall', () => {
    expect(mm(printFinalLogoSize('counter', 'paper', HARBORLINE).heightPt)).toBe(12.68)
    expect(mm(printFinalLogoSize('tent', 'paper', HARBORLINE).heightPt)).toBe(8.2)
    expect(mm(printFinalLogoSize('small', 'paper', HARBORLINE).heightPt)).toBe(6.71)
  })

  it('caps the near-square Oakmere mark on Immersive at 13 / 8.5 / 7 mm', () => {
    expect(mm(printFinalLogoSize('counter', 'immersive', OAKMERE).heightPt)).toBe(13)
    expect(mm(printFinalLogoSize('tent', 'immersive', OAKMERE).heightPt)).toBe(8.5)
    expect(mm(printFinalLogoSize('small', 'immersive', OAKMERE).heightPt)).toBe(7)
  })

  it('keeps a very wide logo within wMax and a very tall one at hMax', () => {
    const wide = printFinalLogoSize('counter', 'paper', {
      inkWidth: 1000,
      inkHeight: 100,
    })
    expect(mm(wide.widthPt)).toBe(38)
    const tall = printFinalLogoSize('counter', 'paper', { inkWidth: 100, inkHeight: 400 })
    expect(mm(tall.heightPt)).toBe(14)
  })

  it('puts any logo that is not light on the cream plate on Immersive, never on Paper', () => {
    expect(
      printFinalLogoOnPlate('immersive', {
        medianInkLuminance: 0.09,
        ringContrast: 0.86,
      }),
    ).toBe(true)
    expect(
      printFinalLogoOnPlate('immersive', { medianInkLuminance: 0.9, ringContrast: null }),
    ).toBe(true)
    expect(
      printFinalLogoOnPlate('immersive', { medianInkLuminance: 0.9, ringContrast: 3.2 }),
    ).toBe(true)
    expect(
      printFinalLogoOnPlate('immersive', { medianInkLuminance: 0.9, ringContrast: 6.1 }),
    ).toBe(false)
    expect(
      printFinalLogoOnPlate('paper', { medianInkLuminance: 0.09, ringContrast: null }),
    ).toBe(false)
  })

  it('pads the plate 2 / 3 mm on the Counter card, 1.3 / 2 mm on the tent and 1 / 1.6 mm on the Small card', () => {
    const counter = printFinalBrandBox('counter', 'immersive', OAKMERE, true)
    expect([mm(counter.widthPt), mm(counter.heightPt)]).toEqual([19.25, 17])
    const tent = printFinalBrandBox('tent', 'immersive', OAKMERE, true)
    expect(mm(tent.heightPt)).toBe(11.1)
    const small = printFinalBrandBox('small', 'immersive', OAKMERE, true)
    expect(mm(small.heightPt)).toBe(9)
    const bare = printFinalBrandBox('counter', 'paper', HARBORLINE, false)
    expect(bare.paddingPt).toEqual({ v: 0, h: 0 })
    expect(mm(PRINT_FINAL_PLATE.radiusPt)).toBe(1.4)
  })
})
