import { describe, expect, it } from 'vitest'
import {
  CARD_GRID,
  CODE_BLOCK,
  CODE_SYMBOL_MIN_PT,
  FIT,
  FIT_ORDER,
  IMMERSIVE_TENT_GRID,
  MARGIN,
  STACK,
  TENT_FACE_GRID,
  TYPE_FLOOR_PT,
  TYPE_PT,
  WINDOW,
  codeBlockHeightPt,
  codeSymbolPt,
  cueRoomPt,
  inToPt,
  mmToPt,
  ptToIn,
  ptToMm,
} from './portal-print-kit-measures'
import { PRINT_KIT_PAPERS, PRINT_KIT_STYLES } from './portal-print-kit'

describe('the units', () => {
  it('turns inches and millimetres into points in one place', () => {
    expect(inToPt(1)).toBe(72)
    expect(mmToPt(25.4)).toBeCloseTo(72, 10)
    expect(inToPt(0.4)).toBeCloseTo(mmToPt(10.16), 10)
  })

  it('turns points back into the same inches and millimetres', () => {
    expect(ptToIn(inToPt(4.75))).toBeCloseTo(4.75, 10)
    expect(ptToMm(mmToPt(148.5))).toBeCloseTo(148.5, 10)
  })
})

describe('the code block', () => {
  it('has a bar exactly 2.00 in wide, the size check, with a square tile of the same width', () => {
    expect(CODE_BLOCK.tilePt).toBe(144)
    expect(ptToIn(CODE_BLOCK.tilePt)).toBe(2)
    expect(ptToMm(CODE_BLOCK.tilePt)).toBeCloseTo(50.8, 6)
  })

  it('makes the bar 0.40 in for one cue line and 0.45 in for two', () => {
    expect(ptToIn(CODE_BLOCK.barPt.one)).toBeCloseTo(0.4, 10)
    expect(ptToIn(CODE_BLOCK.barPt.two)).toBeCloseTo(0.45, 10)
    expect(ptToMm(CODE_BLOCK.barPt.one)).toBeCloseTo(10.16, 6)
    expect(ptToMm(CODE_BLOCK.barPt.two)).toBeCloseTo(11.43, 6)
  })

  it('is 2.40 in tall with one cue line and 2.45 in with two', () => {
    expect(ptToIn(codeBlockHeightPt(CODE_BLOCK.barPt.one))).toBeCloseTo(2.4, 10)
    expect(ptToIn(codeBlockHeightPt(CODE_BLOCK.barPt.two))).toBeCloseTo(2.45, 10)
    expect(ptToMm(codeBlockHeightPt(CODE_BLOCK.barPt.two))).toBeCloseTo(62.2, 1)
  })

  it('has 1.55 in of room for text beside the pictogram on a two-language face', () => {
    expect(ptToIn(cueRoomPt('two'))).toBeCloseTo(1.55, 10)
    expect(ptToMm(cueRoomPt('two'))).toBeCloseTo(39.4, 1)
    expect(ptToIn(cueRoomPt('one'))).toBeCloseTo(1.56, 10)
  })

  it('never lets the cue go under 9 pt', () => {
    expect(CODE_BLOCK.cuePt.two).toBe(CODE_BLOCK.cueFloorPt)
    expect(CODE_BLOCK.cuePt.one).toBeGreaterThan(CODE_BLOCK.cueFloorPt)
    expect(CODE_BLOCK.cueFloorPt).toBe(TYPE_FLOOR_PT.read)
  })

  it('puts the symbol at 1.72 in, modules of 0.035 in, for a code of 49 modules', () => {
    // Version 8, which the portal's address gives: 57 modules with the quiet zone.
    expect(ptToIn(codeSymbolPt(49))).toBeCloseTo(1.72, 2)
    expect(ptToIn(CODE_BLOCK.tilePt / 57)).toBeCloseTo(0.035, 3)
    expect(ptToMm(CODE_BLOCK.tilePt / 57)).toBeCloseTo(0.89, 2)
  })

  it('keeps the symbol at least 1.6 in from a code of 33 modules up', () => {
    expect(codeSymbolPt(33)).toBeGreaterThanOrEqual(CODE_SYMBOL_MIN_PT)
    expect(codeSymbolPt(29)).toBeLessThan(CODE_SYMBOL_MIN_PT)
    expect(ptToIn(CODE_SYMBOL_MIN_PT)).toBeCloseTo(1.6, 10)
  })

  it('draws the corners at 0.10 in, inside the quiet zone of 0.14 in', () => {
    expect(ptToIn(CODE_BLOCK.radiusPt)).toBeCloseTo(0.1, 10)
    const quietZonePt = (CODE_BLOCK.tilePt / 57) * 4
    expect(quietZonePt).toBeGreaterThan(CODE_BLOCK.radiusPt)
    expect(ptToIn(quietZonePt)).toBeCloseTo(0.14, 2)
  })
})

describe('the type scales', () => {
  const scales = Object.entries(TYPE_PT)

  it.each(scales)('sets the place label largest on the %s face', (_name, scale) => {
    const { place, ...rest } = scale
    for (const size of Object.values(rest)) expect(place).toBeGreaterThan(size)
  })

  it.each(scales)(
    'sets nothing a guest reads under 9 pt on the %s face',
    (_name, scale) => {
      for (const size of Object.values(scale)) {
        expect(size).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.read)
      }
    },
  )

  it('sets the lead call to action at 18 pt or more, and 17 pt only on the stepped-down face', () => {
    expect(TYPE_PT.two.head).toBe(18)
    expect(TYPE_PT.one.head).toBeGreaterThanOrEqual(18)
    expect(TYPE_PT.tent.head).toBeGreaterThanOrEqual(18)
    expect(TYPE_PT.twoTight.head).toBe(17)
  })

  it('steps the two-language type down to its floors and no further', () => {
    expect(TYPE_PT.twoTight.place).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.place)
    expect(TYPE_PT.twoTight.head).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.head)
    expect(TYPE_PT.twoTight.head2).toBeGreaterThanOrEqual(TYPE_FLOOR_PT.head2)
    expect(TYPE_PT.twoTight.sub2).toBe(TYPE_PT.two.sub2)
    expect(TYPE_PT.twoTight.place2).toBe(TYPE_PT.two.place2)
  })

  it('gives the same sizes to a 4 × 6 in card and an A6 card, apart from fit step (c)', () => {
    expect(TYPE_PT.two.place).toBe(24)
    expect(TYPE_PT.one.place).toBe(32)
    expect(TYPE_PT.tent.place).toBe(40)
  })

  it('tightens the gap between place label and call to action from 3.4 mm to 2.4 mm, never under 2 mm', () => {
    expect(ptToMm(STACK.gapsPt.two.placeToHead)).toBeCloseTo(3.4, 6)
    expect(ptToMm(STACK.gapsPt.twoTight.placeToHead)).toBeCloseTo(2.4, 6)
    expect(STACK.gapsPt.twoTight.placeToHead).toBeGreaterThanOrEqual(FIT.gapPt.floor)
    expect(STACK.gapsPt.twoTight.rule).toBeGreaterThanOrEqual(FIT.gapPt.floor)
  })
})

describe('the margins', () => {
  const grids = PRINT_KIT_STYLES.flatMap((style) =>
    PRINT_KIT_PAPERS.map((paper) => [style, paper, CARD_GRID[style][paper]] as const),
  )

  it.each(grids)(
    'keeps %s %s cards at 0.4 in or 10 mm, top and bottom',
    (_style, paper, grid) => {
      expect(grid.marginPt).toBe(paper === 'letter' ? inToPt(0.4) : mmToPt(10))
      expect(grid.marginPt).toBeGreaterThanOrEqual(
        paper === 'letter' ? MARGIN.floorLetterPt : MARGIN.floorA4Pt,
      )
    },
  )

  it('keeps the side margins at 0.30 in on 4 × 6 in pieces and 7.5 mm on A6', () => {
    expect(CARD_GRID.paper.letter.sidePt).toBe(inToPt(0.3))
    expect(CARD_GRID.immersive.letter.sidePt).toBe(inToPt(0.3))
    expect(CARD_GRID.paper.a4.sidePt).toBe(mmToPt(7.5))
    expect(CARD_GRID.immersive.a4.sidePt).toBe(mmToPt(7.5))
  })

  it('keeps the margin floor at 0.35 in on Letter and 9 mm on A4', () => {
    expect(ptToIn(MARGIN.floorLetterPt)).toBeCloseTo(0.35, 10)
    expect(ptToMm(MARGIN.floorA4Pt)).toBeCloseTo(9, 10)
  })

  it('measures the optical offsets the boards correct for', () => {
    expect(ptToMm(MARGIN.optical.wordmarkCapPt)).toBeCloseTo(0.3, 10)
    expect(ptToMm(MARGIN.optical.logoEdgePt)).toBeCloseTo(1.2, 10)
    expect(ptToMm(MARGIN.optical.outlinePt)).toBeCloseTo(0.35, 10)
  })
})

describe('the grids', () => {
  it('makes the 4 × 6 in card 3.4 mm narrower and 4.4 mm taller than A6', () => {
    const letter = CARD_GRID.paper.letter
    const a4 = CARD_GRID.paper.a4
    expect(ptToMm(a4.widthPt - letter.widthPt)).toBeCloseTo(3.4, 6)
    expect(ptToMm(letter.heightPt - a4.heightPt)).toBeCloseTo(4.4, 6)
  })

  it('gives Paper no bleed and Immersive 1/8 in on Letter and 3 mm on A4', () => {
    expect(CARD_GRID.paper.letter.bleedPt).toBe(0)
    expect(CARD_GRID.paper.a4.bleedPt).toBe(0)
    expect(CARD_GRID.immersive.letter.bleedPt).toBe(9)
    expect(CARD_GRID.immersive.a4.bleedPt).toBeCloseTo(8.5, 1)
  })

  it('makes the Immersive card page 4.75 × 6.75 in on Letter and 125 × 168 mm on A4', () => {
    const letter = CARD_GRID.immersive.letter
    expect(ptToIn(letter.widthPt + 2 * letter.trimOriginPt)).toBeCloseTo(4.75, 10)
    expect(ptToIn(letter.heightPt + 2 * letter.trimOriginPt)).toBeCloseTo(6.75, 10)
    const a4 = CARD_GRID.immersive.a4
    expect(ptToMm(a4.widthPt + 2 * a4.trimOriginPt)).toBeCloseTo(125, 8)
    expect(ptToMm(a4.heightPt + 2 * a4.trimOriginPt)).toBeCloseTo(168, 8)
  })

  it('makes the Immersive tent page 4.75 × 12.75 in on Letter', () => {
    const grid = IMMERSIVE_TENT_GRID.letter
    expect(ptToIn(grid.widthPt + 2 * grid.trimOriginPt)).toBeCloseTo(4.75, 10)
    expect(ptToIn(2 * grid.heightPt + 2 * grid.trimOriginPt)).toBeCloseTo(12.75, 10)
    expect(ptToIn(grid.ridgePt)).toBeCloseTo(0.18, 10)
    expect(ptToMm(IMMERSIVE_TENT_GRID.a4.ridgePt)).toBeCloseTo(4.5, 10)
  })

  it('makes the Paper tent faces 8.5 × 5.5 in and A5 landscape, with their fold clearance', () => {
    expect(ptToIn(TENT_FACE_GRID.letter.widthPt)).toBeCloseTo(8.5, 10)
    expect(ptToIn(TENT_FACE_GRID.letter.heightPt)).toBeCloseTo(5.5, 10)
    expect(ptToIn(TENT_FACE_GRID.letter.foldClearancePt)).toBeCloseTo(0.45, 10)
    expect(ptToMm(TENT_FACE_GRID.a4.widthPt)).toBeCloseTo(210, 10)
    expect(ptToMm(TENT_FACE_GRID.a4.heightPt)).toBeCloseTo(148.5, 10)
    expect(ptToMm(TENT_FACE_GRID.a4.foldClearancePt)).toBeCloseTo(11, 10)
  })
})

describe('the photo window', () => {
  it('grows from 0.55 in to 1.2 in, and to 1.35 in on a tent', () => {
    expect(ptToIn(WINDOW.minPt)).toBeCloseTo(0.55, 10)
    expect(ptToMm(WINDOW.minPt)).toBeCloseTo(14, 0)
    expect(ptToIn(WINDOW.maxPt)).toBeCloseTo(1.2, 10)
    expect(ptToIn(WINDOW.tentMaxPt)).toBeCloseTo(1.35, 10)
  })
})

describe('the fit order', () => {
  it('shrinks the window, then tightens the gaps, then steps the type down, then falls back to the monogram', () => {
    expect(FIT_ORDER).toEqual(['window', 'gaps', 'type', 'monogram'])
  })

  it('never lets a gap between two groups go under 2 mm', () => {
    expect(ptToMm(FIT.gapPt.floor)).toBeCloseTo(2, 10)
    for (const gap of Object.values(FIT.gapPt)) {
      expect(gap).toBeGreaterThanOrEqual(FIT.gapPt.floor)
    }
  })
})
