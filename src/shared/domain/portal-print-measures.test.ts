import { describe, expect, it } from 'vitest'
import {
  PRINT_DEFAULT_ORIENTATION,
  PRINT_LOOKS,
  PRINT_ORIENTATIONS,
  PRINT_PIECES,
  PRINT_PRINTERS,
  printLanguageMode,
  printRegionOf,
  type PrintFace,
} from './portal-print'
import {
  PRINT_LONG_ADDRESS_COUNTER,
  PRINT_MEASURES,
  PRINT_RULE_LENGTH_PT,
  PRINT_TILE_STEP_UP_PT,
  inPt,
  mmPt,
  printLiveArea,
  printBoxFits,
  printOutlinePt,
  ptMm,
} from './portal-print-measures'

const mm = (pt: number) => Number(ptMm(pt).toFixed(2))
const face = (over: Partial<PrintFace>): PrintFace => ({
  piece: 'counter',
  orientation: 'upright',
  look: 'paper',
  region: 'us',
  ...over,
})
const edgesMm = (f: PrintFace) => {
  const area = printLiveArea(f)
  return {
    side: mm(area.live.leftPt),
    top: mm(area.live.topPt),
    bottom: mm(area.heightPt - area.live.bottomPt),
  }
}

describe('the vocabulary', () => {
  it('names three pieces and selects the Counter card upright, the tent and the Small card wide first', () => {
    expect(PRINT_PIECES).toEqual(['counter', 'tent', 'small'])
    expect(PRINT_DEFAULT_ORIENTATION).toEqual({
      counter: 'upright',
      tent: 'wide',
      small: 'wide',
    })
  })

  it('names both orientations, both looks and both printers, the manager’s own printer first', () => {
    expect(PRINT_ORIENTATIONS).toEqual(['upright', 'wide'])
    expect(PRINT_LOOKS).toEqual(['paper', 'immersive'])
    expect(PRINT_PRINTERS).toEqual(['my_printer', 'print_shop'])
  })

  it('prints the US pieces on Letter and the European ones on A4', () => {
    expect(printRegionOf('letter')).toBe('us')
    expect(printRegionOf('a4')).toBe('eu')
  })

  it('prints two languages in full, except as one small line on the upright tent and Small card', () => {
    expect(printLanguageMode({ piece: 'counter', orientation: 'upright' }, 1)).toBe('one')
    expect(printLanguageMode({ piece: 'counter', orientation: 'upright' }, 2)).toBe(
      'stack',
    )
    expect(printLanguageMode({ piece: 'tent', orientation: 'wide' }, 2)).toBe('stack')
    expect(printLanguageMode({ piece: 'small', orientation: 'wide' }, 2)).toBe('stack')
    expect(printLanguageMode({ piece: 'tent', orientation: 'upright' }, 2)).toBe('line')
    expect(printLanguageMode({ piece: 'small', orientation: 'upright' }, 2)).toBe('line')
  })
})

describe('the measures table (spec 2.1)', () => {
  it('holds the US trims, margins, bottoms, units and tiles', () => {
    const { counter, tent, small } = PRINT_MEASURES.us
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
    const { counter, tent, small } = PRINT_MEASURES.eu
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
      const { counter, tent, small } = PRINT_MEASURES[region]
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
    expect(PRINT_LONG_ADDRESS_COUNTER.tilePt).toBe(inPt(2.1))
    expect(PRINT_LONG_ADDRESS_COUNTER.bars).toEqual({
      onePt: inPt(0.4),
      twoPt: inPt(0.5),
    })
    expect(PRINT_TILE_STEP_UP_PT).toEqual({
      counter: inPt(1.75),
      tent: inPt(1.5),
      small: inPt(1.4),
    })
  })

  it('draws the language rule 8 / 6 / 5 mm long', () => {
    expect(PRINT_RULE_LENGTH_PT).toEqual({
      counter: mmPt(8),
      tent: mmPt(6),
      small: mmPt(5),
    })
  })

  it('puts the Paper outline outside the tile, and none on Immersive', () => {
    expect(printOutlinePt('paper')).toBeCloseTo(mmPt(0.35), 10)
    expect(printOutlinePt('immersive')).toBe(0)
  })
})

describe('the live area (spec 2.2)', () => {
  it('turns the trim a quarter for wide and keeps the same margins', () => {
    const upright = printLiveArea(face({ orientation: 'upright' }))
    const wide = printLiveArea(face({ orientation: 'wide' }))
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
    expect(printLiveArea(f).foldStripPt).toBe(inPt(0.1))
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
    expect(printLiveArea(face({ piece: 'tent' })).foldStripPt).toBe(0)
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
      const area = printLiveArea(face({ piece }))
      expect(area.heightPt - area.live.bottomPt).toBeGreaterThanOrEqual(area.holderPt)
    }
  })
})

describe('ink and code box containment', () => {
  const live = { leftPt: 10, topPt: 20, rightPt: 110, bottomPt: 220 }
  it('allows ink on each live edge', () => {
    expect(printBoxFits(live, live)).toBe(true)
  })
  it.each([
    ['left edge', { leftPt: 9 }],
    ['top edge', { topPt: 19 }],
    ['right edge', { rightPt: 111 }],
    ['bottom edge', { bottomPt: 221 }],
    ['inverted width', { leftPt: 111 }],
    ['inverted height', { topPt: 221 }],
    ['unknown edge', { leftPt: Number.NaN }],
    ['unbounded edge', { bottomPt: Number.POSITIVE_INFINITY }],
  ] as const)('refuses an invalid %s', (_, over) => {
    expect(printBoxFits({ ...live, ...over }, live)).toBe(false)
  })
})
