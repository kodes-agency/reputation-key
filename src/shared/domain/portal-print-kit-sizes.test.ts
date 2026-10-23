// The sizes vocabulary against the round-3 spec-delta tables: S1 (the ladder and
// its trims), S3 (the spacing system, the band, the plate), S4 (what each size
// drops) and S5 (the small tent's face). The numbers below are the spec-delta's,
// in the units it uses.

import { describe, expect, it } from 'vitest'
import {
  PRINT_KIT_PAPERS,
  PRINT_KIT_PIECES,
  PRINT_KIT_SIZES,
  type PrintKitSize,
} from './portal-print-kit'
import { CODE_TILE, codeTileHeightPt } from './portal-print-kit-code-tile'
import { CARD_GRID, inToPt, ptToIn, ptToMm } from './portal-print-kit-measures'
import {
  BAND,
  FACE_ELEMENTS,
  FACE_KINDS,
  FACE_SPACING,
  LOGO_PLATE_PADDING_PT,
  SIZE_TRIM_PT,
  TENT_SMALL_FACE,
  faceKindOf,
  type FaceKind,
} from './portal-print-kit-sizes'

const mm = (pt: number) => ptToMm(pt)

describe('the trims (spec-delta S1)', () => {
  it('makes Large 4 × 6 in or A6, the card the kit has always made', () => {
    expect(SIZE_TRIM_PT.large.letter).toEqual({
      widthPt: CARD_GRID.paper.letter.widthPt,
      heightPt: CARD_GRID.paper.letter.heightPt,
    })
    expect(SIZE_TRIM_PT.large.a4).toEqual({
      widthPt: CARD_GRID.paper.a4.widthPt,
      heightPt: CARD_GRID.paper.a4.heightPt,
    })
  })

  it('makes Table 3.5 × 5 in or 90 × 130 mm and Mini 2 × 3.5 in or 55 × 85 mm', () => {
    expect(SIZE_TRIM_PT.table.letter).toEqual({
      widthPt: inToPt(3.5),
      heightPt: inToPt(5),
    })
    expect(mm(SIZE_TRIM_PT.table.a4.widthPt)).toBeCloseTo(90, 10)
    expect(mm(SIZE_TRIM_PT.table.a4.heightPt)).toBeCloseTo(130, 10)
    expect(SIZE_TRIM_PT.mini.letter).toEqual({
      widthPt: inToPt(2),
      heightPt: inToPt(3.5),
    })
    expect(mm(SIZE_TRIM_PT.mini.a4.widthPt)).toBeCloseTo(55, 10)
    expect(mm(SIZE_TRIM_PT.mini.a4.heightPt)).toBeCloseTo(85, 10)
  })

  it('keeps every card portrait, and each size smaller than the one before it', () => {
    for (const paper of PRINT_KIT_PAPERS) {
      for (const size of PRINT_KIT_SIZES) {
        expect(SIZE_TRIM_PT[size][paper].heightPt).toBeGreaterThan(
          SIZE_TRIM_PT[size][paper].widthPt,
        )
      }
      expect(SIZE_TRIM_PT.table[paper].heightPt).toBeLessThan(
        SIZE_TRIM_PT.large[paper].heightPt,
      )
      expect(SIZE_TRIM_PT.mini[paper].heightPt).toBeLessThan(
        SIZE_TRIM_PT.table[paper].heightPt,
      )
    }
  })

  it('makes the Table card within 2.5 % of the 9 × 13 cm photo size in Europe', () => {
    const us = SIZE_TRIM_PT.table.letter
    const eu = SIZE_TRIM_PT.table.a4
    expect(Math.abs(eu.widthPt / us.widthPt - 1)).toBeLessThan(0.025)
    expect(Math.abs(eu.heightPt / us.heightPt - 1)).toBeLessThan(0.025)
  })
})

describe('the small tent’s face (spec-delta S5)', () => {
  it('is 5 × 3.5 in landscape, 130 × 90 mm in Europe, the Table card turned on its side', () => {
    expect(TENT_SMALL_FACE.trimPt.letter).toEqual({
      widthPt: inToPt(5),
      heightPt: inToPt(3.5),
    })
    expect(mm(TENT_SMALL_FACE.trimPt.a4.widthPt)).toBeCloseTo(130, 10)
    expect(mm(TENT_SMALL_FACE.trimPt.a4.heightPt)).toBeCloseTo(90, 10)
    expect(TENT_SMALL_FACE.trimPt.letter.widthPt).toBe(SIZE_TRIM_PT.table.letter.heightPt)
    expect(TENT_SMALL_FACE.trimPt.letter.heightPt).toBe(SIZE_TRIM_PT.table.letter.widthPt)
  })

  it('has a 1.2 in photo panel and a 14 pt gap between the words and the code', () => {
    expect(ptToIn(TENT_SMALL_FACE.photoPanelPt)).toBeCloseTo(1.2, 10)
    expect(TENT_SMALL_FACE.rowGapPt).toBe(14)
  })

  it('centres a 1.4 in code block, so the fold clearance is 0.9 in and equals the foot', () => {
    const block = codeTileHeightPt(CODE_TILE.table.letter, 'one')
    const clearance = (TENT_SMALL_FACE.trimPt.letter.heightPt - block) / 2
    expect(ptToIn(clearance)).toBeCloseTo(0.9, 10)
    expect(clearance).toBeCloseTo(64.8, 10)
  })

  it('leaves the words room beside the photo panel and the 1.4 in code', () => {
    const face = TENT_SMALL_FACE.trimPt.letter.widthPt
    const side = FACE_SPACING.tent.sidePt.immersive
    const words =
      face -
      TENT_SMALL_FACE.photoPanelPt -
      2 * side -
      TENT_SMALL_FACE.rowGapPt -
      CODE_TILE.table.letter.tilePt
    expect(words).toBeGreaterThan(inToPt(1.5))
  })
})

describe('the spacing system (spec-delta S3)', () => {
  it('sets the side margins at 22, 18 and 14 pt, and 18 pt (22 on Paper) on the tent', () => {
    expect(FACE_SPACING.large.sidePt).toEqual({ immersive: 22, paper: 22 })
    expect(FACE_SPACING.table.sidePt).toEqual({ immersive: 18, paper: 18 })
    expect(FACE_SPACING.mini.sidePt).toEqual({ immersive: 14, paper: 14 })
    expect(FACE_SPACING.tent.sidePt).toEqual({ immersive: 18, paper: 22 })
  })

  it('sets the bottom margin, and the Paper top margin to ink, at 29, 22 and 14.4 pt', () => {
    expect(FACE_SPACING.large.edgePt).toBe(29)
    expect(FACE_SPACING.table.edgePt).toBe(22)
    expect(FACE_SPACING.mini.edgePt).toBe(14.4)
    // The tent row is centred, so its clearance is whatever the code block leaves.
    expect(FACE_SPACING.tent.edgePt).toBeNull()
  })

  it('names the margins in inches the spec rounds them to: 0.3, 0.25 and 0.2 in at the sides', () => {
    expect(ptToIn(FACE_SPACING.large.sidePt.paper)).toBeCloseTo(0.3, 1)
    expect(ptToIn(FACE_SPACING.table.sidePt.paper)).toBeCloseTo(0.25, 10)
    expect(ptToIn(FACE_SPACING.mini.sidePt.paper)).toBeCloseTo(0.2, 1)
    expect(ptToIn(FACE_SPACING.large.edgePt ?? 0)).toBeCloseTo(0.4, 1)
    expect(ptToIn(FACE_SPACING.table.edgePt ?? 0)).toBeCloseTo(0.3, 1)
    expect(ptToIn(FACE_SPACING.mini.edgePt ?? 0)).toBeCloseTo(0.2, 10)
  })

  it('sets logo to name at 6 and 5 pt, eyebrow to call to action at 4, 3.5 and 3.5 pt', () => {
    expect(FACE_SPACING.large.logoToNamePt).toBe(6)
    expect(FACE_SPACING.table.logoToNamePt).toBe(5)
    expect(FACE_SPACING.large.eyebrowToCtaPt).toBe(4)
    expect(FACE_SPACING.table.eyebrowToCtaPt).toBe(3.5)
    expect(FACE_SPACING.tent.eyebrowToCtaPt).toBe(3.5)
  })

  it('sets call to action to sub-line at 3, 2.5, 2.5 and 2 pt', () => {
    expect(FACE_SPACING.large.ctaToSubPt).toBe(3)
    expect(FACE_SPACING.table.ctaToSubPt).toBe(2.5)
    expect(FACE_SPACING.tent.ctaToSubPt).toBe(2.5)
    expect(FACE_SPACING.mini.ctaToSubPt).toBe(2)
  })

  it('sets message to second language at 9 then 4.5 pt on Large and 8 then 4 pt on Table', () => {
    expect(FACE_SPACING.large.secondLanguage).toEqual({ gapPt: 9, ruleToCtaPt: 4.5 })
    expect(FACE_SPACING.table.secondLanguage).toEqual({ gapPt: 8, ruleToCtaPt: 4 })
  })

  it('sets the minimum gap between groups at 14, 12 and 10 pt, and none on the tent, which stretches', () => {
    expect(FACE_SPACING.large.groupGapMinPt).toBe(14)
    expect(FACE_SPACING.table.groupGapMinPt).toBe(12)
    expect(FACE_SPACING.mini.groupGapMinPt).toBe(10)
    expect(FACE_SPACING.tent.groupGapMinPt).toBeNull()
  })

  it.each(FACE_KINDS)('keeps every gap inside a group at 6 pt or less on %s', (kind) => {
    const spacing = FACE_SPACING[kind]
    const within = [
      spacing.logoToNamePt,
      spacing.eyebrowToCtaPt,
      spacing.ctaToSubPt,
      spacing.secondLanguage?.ruleToCtaPt ?? null,
    ].filter((gap): gap is number => gap !== null)
    for (const gap of within) expect(gap).toBeLessThanOrEqual(6)
  })

  it.each(['large', 'table', 'mini'] as const)(
    'keeps the gap between groups on %s at least twice any gap inside one, and over the second-language gap',
    (kind) => {
      const spacing = FACE_SPACING[kind]
      const min = spacing.groupGapMinPt ?? 0
      const within = [
        spacing.logoToNamePt ?? 0,
        spacing.eyebrowToCtaPt ?? 0,
        spacing.ctaToSubPt,
        spacing.secondLanguage?.ruleToCtaPt ?? 0,
      ]
      expect(min).toBeGreaterThanOrEqual(2 * Math.max(...within))
      expect(min).toBeGreaterThan(spacing.secondLanguage?.gapPt ?? 0)
    },
  )

  it('never sets a bottom margin under the side margin', () => {
    for (const kind of ['large', 'table', 'mini'] as const) {
      const spacing = FACE_SPACING[kind]
      expect(spacing.edgePt ?? 0).toBeGreaterThanOrEqual(spacing.sidePt.paper)
    }
  })

  it('shrinks every margin and gap with the size', () => {
    const ladder = ['large', 'table', 'mini'] as const
    for (let step = 1; step < ladder.length; step += 1) {
      const bigger = FACE_SPACING[ladder[step - 1] as FaceKind]
      const smaller = FACE_SPACING[ladder[step] as FaceKind]
      expect(smaller.sidePt.paper).toBeLessThan(bigger.sidePt.paper)
      expect(smaller.edgePt ?? 0).toBeLessThan(bigger.edgePt ?? 0)
      expect(smaller.groupGapMinPt ?? 0).toBeLessThan(bigger.groupGapMinPt ?? 0)
      expect(smaller.ctaToSubPt).toBeLessThan(bigger.ctaToSubPt)
    }
  })
})

describe('the photo band (spec-delta S3)', () => {
  it('targets 1.3, 1.1 and 0.75 in, with minimums of 1.25, 0.95 and 0.65 in', () => {
    expect(ptToIn(BAND.large.targetPt)).toBeCloseTo(1.3, 10)
    expect(ptToIn(BAND.large.minPt)).toBeCloseTo(1.25, 10)
    expect(ptToIn(BAND.table.targetPt)).toBeCloseTo(1.1, 10)
    expect(ptToIn(BAND.table.minPt)).toBeCloseTo(0.95, 10)
    expect(ptToIn(BAND.mini.targetPt)).toBeCloseTo(0.75, 10)
    expect(ptToIn(BAND.mini.minPt)).toBeCloseTo(0.65, 10)
  })

  it('takes about 22 % of the card’s height on every size, the same on Letter and in Europe', () => {
    for (const size of PRINT_KIT_SIZES) {
      const share = BAND[size].targetPt / SIZE_TRIM_PT[size].letter.heightPt
      expect(share).toBeGreaterThan(0.21)
      expect(share).toBeLessThan(0.225)
    }
  })

  it('gives way to its minimum and never below it', () => {
    for (const size of PRINT_KIT_SIZES) {
      expect(BAND[size].minPt).toBeLessThan(BAND[size].targetPt)
    }
  })
})

describe('the logo plate (spec-delta S3)', () => {
  it('pads 2 × 3 mm on Large, 1.7 × 2.6 mm on Table and the tent, and 1.4 × 2.2 mm on Mini', () => {
    const padded = (kind: FaceKind) => ({
      y: mm(LOGO_PLATE_PADDING_PT[kind].yPt),
      x: mm(LOGO_PLATE_PADDING_PT[kind].xPt),
    })
    expect(padded('large').y).toBeCloseTo(2, 10)
    expect(padded('large').x).toBeCloseTo(3, 10)
    expect(padded('table').y).toBeCloseTo(1.7, 10)
    expect(padded('table').x).toBeCloseTo(2.6, 10)
    expect(LOGO_PLATE_PADDING_PT.tent).toEqual(LOGO_PLATE_PADDING_PT.table)
    expect(padded('mini').y).toBeCloseTo(1.4, 10)
    expect(padded('mini').x).toBeCloseTo(2.2, 10)
  })

  it('is deeper across than down on every size', () => {
    for (const kind of FACE_KINDS) {
      expect(LOGO_PLATE_PADDING_PT[kind].xPt).toBeGreaterThan(
        LOGO_PLATE_PADDING_PT[kind].yPt,
      )
    }
  })
})

describe('what each size drops (spec-delta S4)', () => {
  it('keeps the band on Large, Table and Mini and puts it down the left of the tent face', () => {
    expect(FACE_ELEMENTS.large.photo).toBe('band')
    expect(FACE_ELEMENTS.table.photo).toBe('band')
    expect(FACE_ELEMENTS.mini.photo).toBe('band')
    expect(FACE_ELEMENTS.tent.photo).toBe('panel')
  })

  it('drops the property name on the tent and Mini, which let the logo carry it', () => {
    expect(FACE_ELEMENTS.large.name).toBe(true)
    expect(FACE_ELEMENTS.table.name).toBe(true)
    expect(FACE_ELEMENTS.tent.name).toBe(false)
    expect(FACE_ELEMENTS.mini.name).toBe(false)
  })

  it('drops the eyebrow on Mini only', () => {
    expect(FACE_ELEMENTS.large.eyebrow).toBe(true)
    expect(FACE_ELEMENTS.table.eyebrow).toBe(true)
    expect(FACE_ELEMENTS.tent.eyebrow).toBe(true)
    expect(FACE_ELEMENTS.mini.eyebrow).toBe(false)
  })

  it('keeps the second language’s call to action on Large and Table, moves it to the other face on the tent, and drops it on Mini', () => {
    expect(FACE_ELEMENTS.large.secondLanguage).toBe('headline')
    expect(FACE_ELEMENTS.table.secondLanguage).toBe('headline')
    expect(FACE_ELEMENTS.tent.secondLanguage).toBe('other-face')
    expect(FACE_ELEMENTS.mini.secondLanguage).toBe('dropped')
  })

  it('carries one cue line on the tent and Mini and up to two on Large and Table', () => {
    expect(FACE_ELEMENTS.large.cueLines).toBe(2)
    expect(FACE_ELEMENTS.table.cueLines).toBe(2)
    expect(FACE_ELEMENTS.tent.cueLines).toBe(1)
    expect(FACE_ELEMENTS.mini.cueLines).toBe(1)
  })

  it('has no spacing for an element the size drops', () => {
    for (const kind of FACE_KINDS) {
      const elements = FACE_ELEMENTS[kind]
      const spacing = FACE_SPACING[kind]
      expect(spacing.logoToNamePt === null).toBe(!elements.name)
      expect(spacing.eyebrowToCtaPt === null).toBe(!elements.eyebrow)
      expect(spacing.secondLanguage === null).toBe(elements.secondLanguage !== 'headline')
    }
  })
})

describe('faceKindOf', () => {
  it('takes a card at any size as that size', () => {
    for (const size of PRINT_KIT_SIZES) {
      expect(faceKindOf('counter_card', size)).toBe(size)
    }
  })

  it('takes the table tent at size Table as the small tent', () => {
    expect(faceKindOf('table_tent', 'table')).toBe('tent')
  })

  it('leaves today’s Letter-half tent (the table tent at size Large) and a Mini tent unsized', () => {
    expect(faceKindOf('table_tent', 'large')).toBeNull()
    expect(faceKindOf('table_tent', 'mini')).toBeNull()
  })

  it('answers every piece and size with a kind the vocabulary has, or null', () => {
    for (const piece of PRINT_KIT_PIECES) {
      for (const size of PRINT_KIT_SIZES as readonly PrintKitSize[]) {
        const kind = faceKindOf(piece, size)
        expect(kind === null || FACE_KINDS.includes(kind)).toBe(true)
      }
    }
  })
})
