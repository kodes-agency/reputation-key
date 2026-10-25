import { describe, expect, it } from 'vitest'
import type { PrintFinalFace } from './portal-print-final'
import { printFinalCodeBlock } from './portal-print-final-code'
import { PRINT_FINAL_MEASURES, inPt, mmPt, ptMm } from './portal-print-final-measures'
import { printFinalGapUnitsBefore, type PrintFinalPart } from './portal-print-final-parts'
import { planPrintFinalFace, printFinalTextColumn } from './portal-print-final-plan'
import { PRINT_FINAL_SPARE_TOP_SHARE } from './portal-print-final-planners'
import {
  printFinalPhotoBox,
  printFinalPhotoDpi,
  printFinalPhotoPixelsFor,
  printFinalPhotoTier,
} from './portal-print-final-photo'
import { choosePrintFinalHeadline } from './portal-print-final-type'

const face = (over: Partial<PrintFinalFace> = {}): PrintFinalFace => ({
  piece: 'counter',
  orientation: 'upright',
  look: 'immersive',
  region: 'us',
  ...over,
})
const part = (
  key: PrintFinalPart['key'],
  widthMm: number,
  heightMm: number,
): PrintFinalPart => ({
  key,
  widthPt: mmPt(widthMm),
  heightPt: mmPt(heightMm),
})
const SMALL_WORDS = [
  part('brand', 20, 10),
  part('kicker', 40, 2),
  part('headline', 50, 8),
  part('subline', 40, 3),
]

function plan(
  f: PrintFinalFace,
  parts: readonly PrintFinalPart[] = SMALL_WORDS,
  cueLines = 1,
) {
  const m = PRINT_FINAL_MEASURES[f.region][f.piece]
  return planPrintFinalFace({ face: f, parts, code: printFinalCodeBlock(f, m, cueLines) })
}

describe('the line caps (spec 3)', () => {
  const words = (
    headlineLines: number,
    sublineLines: number,
  ): readonly PrintFinalPart[] => [
    part('brand', 20, 10),
    part('kicker', 40, 2),
    { ...part('headline', 50, 8), lines: headlineLines },
    { ...part('subline', 40, 3), lines: sublineLines },
  ]

  it('allows a headline on 3 lines and a sub-line on 2', () => {
    const p = plan(face(), words(3, 2))
    expect(p.problems).toEqual([])
    expect(p.fits).toBe(true)
  })

  it('refuses a 4-line headline even where the gaps would hold', () => {
    const p = plan(face(), words(4, 1))
    expect(p.problems).toEqual(['headline_over_cap'])
    expect(p.fits).toBe(false)
  })

  it('refuses a 3-line sub-line', () => {
    const p = plan(face(), words(1, 3))
    expect(p.problems).toEqual(['subline_over_cap'])
    expect(p.fits).toBe(false)
  })

  it('does not hold the second language to the caps, nor parts that carry no line count', () => {
    const p = plan(face(), [
      ...words(1, 1),
      { ...part('headline2', 30, 4), lines: 6 },
      part('subline2', 40, 3),
    ])
    expect(p.problems).not.toContain('headline_over_cap')
    expect(plan(face()).problems).toEqual([])
  })
})

describe('the gaps inside a group', () => {
  it('are 1u, and 2u on each side of the rule before the second language', () => {
    expect(printFinalGapUnitsBefore(null, 'brand')).toBe(0)
    expect(printFinalGapUnitsBefore('kicker', 'headline')).toBe(1)
    expect(printFinalGapUnitsBefore('subline', 'rule')).toBe(2)
    expect(printFinalGapUnitsBefore('rule', 'headline2')).toBe(2)
    expect(printFinalGapUnitsBefore('headline2', 'subline2')).toBe(1)
  })

  it('stack the message parts by their ink with those gaps', () => {
    const p = plan(face(), [
      part('brand', 20, 10),
      part('headline', 50, 8),
      part('subline', 40, 3),
      part('rule', 8, 0.35),
      part('headline2', 30, 5),
    ])
    const [, head, sub, rule, head2] = p.parts
    const u = p.unitPt
    expect((sub?.yPt ?? 0) - ((head?.yPt ?? 0) + (head?.heightPt ?? 0))).toBeCloseTo(u, 6)
    expect((rule?.yPt ?? 0) - ((sub?.yPt ?? 0) + (sub?.heightPt ?? 0))).toBeCloseTo(
      2 * u,
      6,
    )
    expect((head2?.yPt ?? 0) - ((rule?.yPt ?? 0) + (rule?.heightPt ?? 0))).toBeCloseTo(
      2 * u,
      6,
    )
  })
})

describe('the upright stack', () => {
  it('grows the group gaps to 8u and splits the rest 44 : 56 into the margins', () => {
    const p = plan(face())
    expect(p.gapsPt.brandToMessage).toBeCloseTo(8 * p.unitPt, 6)
    expect(p.gapsPt.messageToCode).toBeCloseTo(8 * p.unitPt, 6)
    const top = (p.groups.brand?.topPt ?? 0) - p.live.topPt
    const bottom = p.live.bottomPt - p.code.bottomPt
    expect(top / (top + bottom)).toBeCloseTo(PRINT_FINAL_SPARE_TOP_SHARE, 6)
    expect(p.fits).toBe(true)
  })

  it('centres every part and the code block on one axis', () => {
    const p = plan(face())
    const axis = p.widthPt / 2
    for (const placed of p.parts)
      expect(placed.xPt + placed.widthPt / 2).toBeCloseTo(axis, 6)
    expect((p.code.leftPt + p.code.rightPt) / 2).toBeCloseTo(axis, 6)
  })

  it('shares less spare equally between the gaps and starts at the top margin', () => {
    const p = plan(face({ piece: 'tent' }), [
      part('brand', 12, 11),
      part('kicker', 30, 3),
      part('headline', 40, 12),
      part('subline', 40, 3),
    ])
    expect(p.gapsPt.brandToMessage).toBeCloseTo(p.gapsPt.messageToCode, 6)
    expect(p.gapsPt.messageToCode).toBeLessThan(8 * p.unitPt)
    expect(p.groups.brand?.topPt).toBeCloseTo(p.live.topPt, 6)
  })

  it('reports gaps under 4u: long copy then steps the headline down', () => {
    const p = plan(face({ piece: 'small' }), [
      part('brand', 12, 7),
      part('headline', 40, 25),
      part('subline', 40, 4),
    ])
    expect(p.problems).toContain('gap_under_4u')
    expect(p.fits).toBe(false)
  })
})

describe('the wide block', () => {
  it('puts the code block on the right margin and the words flush left in their column', () => {
    const f = face({ orientation: 'wide' })
    const p = plan(f)
    expect(p.code.rightPt).toBeCloseTo(p.live.rightPt, 6)
    for (const placed of p.parts) expect(placed.xPt).toBeCloseTo(p.live.leftPt, 6)
    expect(p.column).toEqual(printFinalTextColumn(f, inPt(1.5)))
    expect(ptMm(p.column.rightPt)).toBeCloseTo(152.4 - 9.525 - 38.1 - 9.525, 6)
  })

  it('keeps the brand 4u above the message and centres the block on the code block’s line', () => {
    const p = plan(face({ orientation: 'wide', look: 'paper' }))
    expect(p.gapsPt.brandToMessage).toBeCloseTo(4 * p.unitPt, 6)
    const block = ((p.groups.brand?.topPt ?? 0) + (p.groups.message?.bottomPt ?? 0)) / 2
    expect(block).toBeCloseTo((p.code.topPt + p.code.bottomPt) / 2, 6)
    const top = p.code.topPt - p.live.topPt
    const bottom = p.live.bottomPt - p.code.bottomPt
    expect(top / (top + bottom)).toBeCloseTo(PRINT_FINAL_SPARE_TOP_SHARE, 6)
  })

  it('lifts a tent’s block until the headline’s cap-top sits in the upper 54 %', () => {
    const p = plan(face({ piece: 'tent', orientation: 'wide' }), [
      part('brand', 12, 11),
      part('kicker', 30, 2),
      part('headline', 40, 6),
      part('subline', 40, 3),
    ])
    const headline = p.parts.find((placed) => placed.key === 'headline')
    expect((headline?.yPt ?? 0) / p.heightPt).toBeLessThanOrEqual(0.54 + 1e-9)
  })

  it('reports words taller than the live height', () => {
    const p = plan(face({ piece: 'small', orientation: 'wide' }), [
      part('brand', 12, 8),
      part('headline', 30, 30),
      part('subline', 30, 4),
    ])
    expect(p.problems).toContain('taller_than_live')
  })
})

describe('long copy over both orientations', () => {
  it('steps the headline until the upright and the wide face both keep 4u', () => {
    const fitsAt = (pt: number) =>
      (['upright', 'wide'] as const).every(
        (orientation) =>
          plan(face({ piece: 'tent', orientation }), [
            part('brand', 12, 8),
            part('kicker', 30, 3),
            part('headline', 40, pt * 0.95),
            part('subline', 40, 3),
          ]).fits,
      )
    const choice = choosePrintFinalHeadline('tent', fitsAt)
    expect(choice).toEqual({ headlinePt: 18, overflows: false })
    expect(fitsAt(19)).toBe(false)
  })
})

describe('the photo (spec 6.2)', () => {
  it('covers its box plus the bleed on each trim edge it touches', () => {
    const inches = (f: PrintFinalFace) => {
      const box = printFinalPhotoBox(plan(f))
      return [
        Number((box.coverWidthPt / 72).toFixed(3)),
        Number((box.coverHeightPt / 72).toFixed(3)),
      ]
    }
    expect(inches(face({ orientation: 'wide' }))).toEqual([4.25, 4.25])
    expect(inches(face({ piece: 'tent', orientation: 'wide' }))).toEqual([2.725, 2.775])
    expect(inches(face({ piece: 'small', orientation: 'wide' }))).toEqual([2.188, 2.25])
    const upright = printFinalPhotoBox(plan(face()))
    expect(upright.coverWidthPt).toBeCloseTo(inPt(4.25), 6)
    expect(upright.box.bottomPt).toBeCloseTo(plan(face()).code.topPt - inPt(0.12), 6)
  })

  it('gives a tent photo no top bleed: its top is the fold strip', () => {
    const p = plan(face({ piece: 'tent' }))
    const box = printFinalPhotoBox(p)
    expect(box.box.topPt).toBe(inPt(0.1))
    expect(box.coverHeightPt).toBeCloseTo(box.box.bottomPt - inPt(0.1), 6)
  })

  it('floors the dpi, divides it by the zoom, and never refuses', () => {
    const wide = printFinalPhotoBox(plan(face({ orientation: 'wide' })))
    expect(printFinalPhotoDpi({ widthPx: 1195, heightPx: 669 }, wide)).toBe(157)
    expect(printFinalPhotoDpi({ widthPx: 1043, heightPx: 584 }, wide)).toBe(137)
    expect(printFinalPhotoDpi({ widthPx: 1195, heightPx: 669 }, wide, 1.35)).toBe(116)
    expect(printFinalPhotoTier(137)).toBe('will_look_soft')
    expect(printFinalPhotoTier(150)).toBe('may_look_soft')
    expect(printFinalPhotoTier(199)).toBe('may_look_soft')
    expect(printFinalPhotoTier(200)).toBe('sharp')
  })

  it('names the least photo that prints sharp in the box', () => {
    const wide = printFinalPhotoBox(plan(face({ orientation: 'wide' })))
    expect(printFinalPhotoPixelsFor(wide, 200)).toEqual({ widthPx: 850, heightPx: 850 })
    expect(printFinalPhotoPixelsFor(wide, 150).heightPx).toBe(638)
  })
})
