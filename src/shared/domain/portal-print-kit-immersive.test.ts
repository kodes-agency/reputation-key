import { describe, expect, it } from 'vitest'
import {
  PRINT_SHOP_MARK,
  isImmersiveGeometry,
  monogramLetter,
  photoDim,
  printShopMarks,
  printShopSlugLines,
  windowPictureRangePt,
  windowWidthPt,
} from './portal-print-kit-immersive'
import { inToPt, mmToPt, ptToIn, ptToMm } from './portal-print-kit-measures'
import { printKitPages, type PrintKitPage } from './portal-print-kit-sheets'

const pageOf = (pages: readonly PrintKitPage[]): PrintKitPage => {
  const [page] = pages
  if (page === undefined) throw new Error('no page')
  return page
}

describe('the photo window', () => {
  it('spans the face between its side margins: 3.4 in on 4 × 6 in, 90 mm on A6', () => {
    expect(ptToIn(windowWidthPt('card4x6'))).toBeCloseTo(3.4, 10)
    expect(ptToIn(windowWidthPt('tentPanel4x6'))).toBeCloseTo(3.4, 10)
    expect(ptToMm(windowWidthPt('cardA6'))).toBeCloseTo(90, 10)
    expect(ptToMm(windowWidthPt('tentPanelA6'))).toBeCloseTo(90, 10)
  })

  it('grows from 0.55 in to 1.2 in on a card and to 1.35 in on a tent panel', () => {
    expect(windowPictureRangePt('card4x6')).toEqual({
      minPt: inToPt(0.55),
      maxPt: inToPt(1.2),
    })
    expect(windowPictureRangePt('tentPanelA6').maxPt).toBeCloseTo(inToPt(1.35), 10)
  })

  it('belongs to the Immersive shapes only', () => {
    expect(isImmersiveGeometry('cardA6')).toBe(true)
    expect(isImmersiveGeometry('tentPanel4x6')).toBe(true)
    expect(isImmersiveGeometry('tentFaceLetter')).toBe(false)
  })
})

describe('monogramLetter', () => {
  it.each([
    ['Avela', 'A'],
    ['kadife barbers', 'K'],
    ['  Trattoria Nonna', 'T'],
    ['Éclair', 'É'],
    // A letter and its combining accent are one grapheme.
    ['éte', 'É'],
    ['Хотел 1923', 'Х'],
    ['', ''],
  ])('takes the first grapheme of %j in capitals', (wordmark, letter) => {
    expect(monogramLetter(wordmark)).toBe(letter)
  })
})

describe('photoDim', () => {
  it('leaves a dark crop alone and dims a light one, never past 0.45', () => {
    expect(photoDim(0.1)).toBe(0)
    expect(photoDim(0.3)).toBe(0)
    expect(photoDim(0.5)).toBeCloseTo(0.22, 10)
    expect(photoDim(0.95)).toBe(0.45)
  })
})

describe('printShopMarks', () => {
  it('starts every crop mark outside the bleed, on both papers', () => {
    for (const paper of ['letter', 'a4'] as const) {
      for (const piece of ['counter_card', 'table_tent'] as const) {
        const page = pageOf(printKitPages(piece, 2, 'immersive', paper))
        const { trim } = page
        const marks = printShopMarks(page, paper)
        expect(marks.crop).toHaveLength(8)
        const right = trim.leftPt + trim.widthPt
        const bottom = trim.topPt + trim.heightPt
        for (const line of marks.crop) {
          // A line runs away from the trim along one axis: its inner end is how far off the trim it starts.
          const along = line.y1 === line.y2 ? [line.x1, line.x2] : [line.y1, line.y2]
          const edges = line.y1 === line.y2 ? [trim.leftPt, right] : [trim.topPt, bottom]
          const start = Math.min(
            ...along.flatMap((value) => edges.map((edge) => Math.abs(value - edge))),
          )
          expect(start).toBeGreaterThan(page.bleedPt)
        }
      }
    }
  })

  it('runs the Letter marks 0.175 to 0.355 in off the trim and the A4 marks 4 to 9 mm', () => {
    const letter = pageOf(printKitPages('counter_card', 1, 'immersive', 'letter'))
    const [across] = printShopMarks(letter, 'letter').crop
    expect(ptToIn(letter.trim.leftPt - (across?.x1 ?? 0))).toBeCloseTo(0.175, 10)
    expect(ptToIn(letter.trim.leftPt - (across?.x2 ?? 0))).toBeCloseTo(0.355, 10)
    expect(ptToIn(letter.trim.leftPt - (across?.x1 ?? 0))).toBeGreaterThan(
      ptToIn(letter.bleedPt),
    )
    const a4 = pageOf(printKitPages('counter_card', 1, 'immersive', 'a4'))
    const [first] = printShopMarks(a4, 'a4').crop
    expect(ptToMm(a4.trim.leftPt - (first?.x1 ?? 0))).toBeCloseTo(4, 10)
    expect(ptToMm(a4.trim.leftPt - (first?.x1 ?? 0))).toBeGreaterThan(ptToMm(a4.bleedPt))
  })

  it('puts the fold marks on the tent’s fold in both side slugs, and none on a card', () => {
    const tent = pageOf(printKitPages('table_tent', 2, 'immersive', 'letter'))
    const marks = printShopMarks(tent, 'letter')
    expect(marks.fold).toHaveLength(2)
    for (const line of marks.fold) {
      expect(ptToIn(line.y1)).toBeCloseTo(6.375, 10)
      expect(ptToIn(Math.abs(line.x2 - line.x1))).toBeCloseTo(0.18, 10)
    }
    const card = pageOf(printKitPages('counter_card', 1, 'immersive', 'letter'))
    expect(printShopMarks(card, 'letter').fold).toEqual([])
  })

  it('sets the slug line under the trim, between the bottom marks', () => {
    const tent = pageOf(printKitPages('table_tent', 2, 'immersive', 'letter'))
    const { slug } = printShopMarks(tent, 'letter')
    expect(ptToIn(slug.topPt)).toBeCloseTo(12.565, 10)
    expect(ptToIn(slug.centreXPt)).toBeCloseTo(2.375, 10)
    expect(slug.widthPt).toBeLessThan(tent.trim.widthPt)
    expect(PRINT_SHOP_MARK.slug.sizePt).toBe(5)
    expect(PRINT_SHOP_MARK.weightPt).toBeCloseTo(mmToPt(0.2), 10)
  })
})

describe('printShopSlugLines', () => {
  it('names the piece, its trim, bleed and fold, as the board’s slug does', () => {
    const [full] = printShopSlugLines('table_tent', 'letter', {
      brand: 'Avela',
      place: 'Pool & Terrace',
      side: null,
    })
    expect(full).toBe(
      'Avela · Pool & Terrace · table tent · trim 4 × 12 in · bleed 1/8 in · fold 6 in · score',
    )
  })

  it('says which face a card page is, in millimetres on A4, and drops the names before the facts', () => {
    const lines = printShopSlugLines('counter_card', 'a4', {
      brand: 'Avela',
      place: 'Pool & Terrace',
      side: 'back',
    })
    expect(lines).toEqual([
      'Avela · Pool & Terrace · counter card, back · trim 105 × 148 mm · bleed 3 mm',
      'Avela · counter card, back · trim 105 × 148 mm · bleed 3 mm',
      'counter card, back · trim 105 × 148 mm · bleed 3 mm',
    ])
  })
})
