import { describe, expect, it } from 'vitest'
import {
  PRINT_FINAL_DEFAULT_ORIENTATION,
  PRINT_FINAL_PIECES,
  printFinalLanguageMode,
  printFinalRegionOf,
  type PrintFinalFace,
} from './portal-print-final'
import {
  PRINT_FINAL_LONG_ADDRESS_COUNTER,
  PRINT_FINAL_MEASURES,
  PRINT_FINAL_TILE_STEP_UP_PT,
  inPt,
  mmPt,
  printFinalLiveArea,
  printFinalOutlinePt,
  ptMm,
} from './portal-print-final-measures'

const mm = (pt: number) => Number(ptMm(pt).toFixed(2))
const face = (over: Partial<PrintFinalFace>): PrintFinalFace => ({
  piece: 'counter',
  orientation: 'upright',
  look: 'paper',
  region: 'us',
  ...over,
})
const edgesMm = (f: PrintFinalFace) => {
  const area = printFinalLiveArea(f)
  return {
    side: mm(area.live.leftPt),
    top: mm(area.live.topPt),
    bottom: mm(area.heightPt - area.live.bottomPt),
  }
}

describe('the vocabulary', () => {
  it('names three pieces and selects the Counter card upright, the tent and the Small card wide first', () => {
    expect(PRINT_FINAL_PIECES).toEqual(['counter', 'tent', 'small'])
    expect(PRINT_FINAL_DEFAULT_ORIENTATION).toEqual({
      counter: 'upright',
      tent: 'wide',
      small: 'wide',
    })
  })

  it('prints the US pieces on Letter and the European ones on A4', () => {
    expect(printFinalRegionOf('letter')).toBe('us')
    expect(printFinalRegionOf('a4')).toBe('eu')
  })

  it('prints two languages in full, except as one small line on the upright tent and Small card', () => {
    expect(printFinalLanguageMode({ piece: 'counter', orientation: 'upright' }, 1)).toBe(
      'one',
    )
    expect(printFinalLanguageMode({ piece: 'counter', orientation: 'upright' }, 2)).toBe(
      'stack',
    )
    expect(printFinalLanguageMode({ piece: 'tent', orientation: 'wide' }, 2)).toBe(
      'stack',
    )
    expect(printFinalLanguageMode({ piece: 'small', orientation: 'wide' }, 2)).toBe(
      'stack',
    )
    expect(printFinalLanguageMode({ piece: 'tent', orientation: 'upright' }, 2)).toBe(
      'line',
    )
    expect(printFinalLanguageMode({ piece: 'small', orientation: 'upright' }, 2)).toBe(
      'line',
    )
  })
})

describe('the measures table (spec 2.1)', () => {
  it('holds the US trims, margins, bottoms, units and tiles', () => {
    const { counter, tent, small } = PRINT_FINAL_MEASURES.us
    expect([counter.shortPt, counter.longPt]).toEqual([inPt(4), inPt(6)])
    expect([tent.shortPt, tent.longPt]).toEqual([inPt(2.75), inPt(4.25)])
    expect([small.shortPt, small.longPt]).toEqual([inPt(2), inPt(3.5)])
    expect([mm(counter.marginPt), mm(counter.bottomPt), mm(counter.unitPt)]).toEqual([
      9.52, 11.91, 2.38,
    ])
    expect([mm(tent.marginPt), mm(tent.unitPt)]).toEqual([6.35, 1.59])
    expect([mm(small.marginPt), mm(small.bottomPt), mm(small.unitPt)]).toEqual([
      4.76, 5.95, 1.19,
    ])
    expect([counter.tilePt, tent.tilePt, small.tilePt]).toEqual([
      inPt(1.5),
      inPt(1.4),
      inPt(1.25),
    ])
  })

  it('holds the European trims, margins, bottoms and tiles in millimetres', () => {
    const { counter, tent, small } = PRINT_FINAL_MEASURES.eu
    expect([mm(counter.shortPt), mm(counter.longPt), mm(counter.tilePt)]).toEqual([
      105, 148, 38,
    ])
    expect([mm(tent.shortPt), mm(tent.longPt), mm(tent.tilePt)]).toEqual([74.25, 105, 36])
    expect([mm(small.shortPt), mm(small.longPt), mm(small.tilePt)]).toEqual([54, 85, 32])
    expect([mm(counter.marginPt), mm(counter.bottomPt)]).toEqual([9.5, 12])
    expect([mm(tent.unitPt), mm(small.unitPt)]).toEqual([1.62, 1.25])
  })

  it('keeps the bars, cues and floors per piece in both regions', () => {
    for (const region of ['us', 'eu'] as const) {
      const { counter, tent, small } = PRINT_FINAL_MEASURES[region]
      expect(counter.bars).toEqual({ onePt: inPt(0.36), twoPt: inPt(0.46) })
      expect(tent.bars).toEqual({ onePt: inPt(0.3), twoPt: inPt(0.38) })
      expect(small.bars).toEqual({ onePt: inPt(0.27), twoPt: inPt(0.3) })
      expect([counter.cuePt, tent.cuePt, small.cuePt]).toEqual([9, 9, 8])
      expect([counter.typeFloorPt, tent.typeFloorPt, small.typeFloorPt]).toEqual([
        9, 8, 8,
      ])
    }
  })

  it('keeps the long-address Counter tile and the step-up ladder as data', () => {
    expect(PRINT_FINAL_LONG_ADDRESS_COUNTER.tilePt).toBe(inPt(2.1))
    expect(PRINT_FINAL_LONG_ADDRESS_COUNTER.bars).toEqual({
      onePt: inPt(0.4),
      twoPt: inPt(0.5),
    })
    expect(PRINT_FINAL_TILE_STEP_UP_PT).toEqual({
      counter: inPt(1.75),
      tent: inPt(1.5),
      small: inPt(1.4),
    })
  })

  it('puts the Paper outline outside the tile, and none on Immersive', () => {
    expect(printFinalOutlinePt('paper')).toBeCloseTo(mmPt(0.35), 10)
    expect(printFinalOutlinePt('immersive')).toBe(0)
  })
})

describe('the live area (spec 2.2)', () => {
  it('turns the trim a quarter for wide and keeps the same margins', () => {
    const upright = printFinalLiveArea(face({ orientation: 'upright' }))
    const wide = printFinalLiveArea(face({ orientation: 'wide' }))
    expect([upright.widthPt, upright.heightPt]).toEqual([inPt(4), inPt(6)])
    expect([wide.widthPt, wide.heightPt]).toEqual([inPt(6), inPt(4)])
    expect(edgesMm(face({ orientation: 'wide' }))).toEqual({
      side: 9.52,
      top: 9.52,
      bottom: 11.91,
    })
  })

  it('starts an Immersive tent below its fold strip and raises its base to 0.35 in', () => {
    const f = face({ piece: 'tent', look: 'immersive', orientation: 'wide' })
    expect(edgesMm(f)).toEqual({ side: 6.35, top: 8.89, bottom: 8.89 })
    expect(printFinalLiveArea(f).foldStripPt).toBe(inPt(0.1))
    expect(edgesMm({ ...f, region: 'eu' }).top).toBe(9.04)
  })

  it('builds the office-sheet guard into the Paper tent face', () => {
    expect(edgesMm(face({ piece: 'tent', orientation: 'wide' }))).toEqual({
      side: 8.64,
      top: 6.35,
      bottom: 12.7,
    })
    expect(edgesMm(face({ piece: 'tent', orientation: 'upright' }))).toEqual({
      side: 12.7,
      top: 6.35,
      bottom: 12.7,
    })
    expect(printFinalLiveArea(face({ piece: 'tent' })).foldStripPt).toBe(0)
  })

  it('keeps the Paper A6 card 12.7 mm off the edges that meet an A4 sheet edge', () => {
    expect(edgesMm(face({ region: 'eu', orientation: 'upright' }))).toEqual({
      side: 9.5,
      top: 12.7,
      bottom: 12.7,
    })
    expect(edgesMm(face({ region: 'eu', orientation: 'wide' }))).toEqual({
      side: 12.7,
      top: 9.5,
      bottom: 12,
    })
    expect(edgesMm(face({ region: 'eu', look: 'immersive' }))).toEqual({
      side: 9.5,
      top: 9.5,
      bottom: 12,
    })
  })

  it('clears the holder zone with the bottom margin on the Counter and Small cards', () => {
    for (const piece of ['counter', 'small'] as const) {
      const area = printFinalLiveArea(face({ piece }))
      expect(area.heightPt - area.live.bottomPt).toBeGreaterThanOrEqual(area.holderPt)
    }
  })
})
