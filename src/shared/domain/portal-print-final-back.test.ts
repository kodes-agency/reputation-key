import { describe, expect, it } from 'vitest'
import golden from './__fixtures__/portal-print-final-back-golden.json'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  type PrintFinalFace,
  type PrintFinalPiece,
} from './portal-print-final'
import {
  layoutPrintFinalBack,
  planPrintFinalBack,
  printFinalBackName,
  printFinalHasBack,
  type PrintFinalBackInput,
} from './portal-print-final-back'
import { printFinalLiveArea, mmPt, ptMm } from './portal-print-final-measures'
import type { PrintFinalTextMeasurer } from './portal-print-final-text'

// Every character advances half an em; ink rises 0.7 em and falls 0.2 em.
const measurer: PrintFinalTextMeasurer = {
  advancePt: (text, style) =>
    style.sizePt * (text.length * 0.5 + (text.length - 1) * style.trackingEm),
  ink: (text, style) => ({
    leftPt: 0,
    rightPt: style.sizePt * text.length * 0.5,
    ascentPt: 0.7 * style.sizePt,
    descentPt: 0.2 * style.sizePt,
  }),
}

const face = (over: Partial<PrintFinalFace> = {}): PrintFinalFace => ({
  piece: 'counter',
  orientation: 'upright',
  look: 'paper',
  region: 'us',
  ...over,
})

const LOGO = { kind: 'logo', inkWidth: 2, inkHeight: 1, onPlate: false } as const
const NAME = 'Harborline Inn Millbrook-Near The Arboretum'

const back = (f: PrintFinalFace, over: Partial<PrintFinalBackInput> = {}) =>
  layoutPrintFinalBack({
    face: f,
    brand: LOGO,
    propertyName: NAME,
    measurer,
    ...over,
  })

const CARDS = PRINT_FINAL_PIECES.filter(printFinalHasBack).flatMap((piece) =>
  PRINT_FINAL_ORIENTATIONS.flatMap((orientation) =>
    (['paper', 'immersive'] as const).flatMap((look) =>
      (['us', 'eu'] as const).map((region) => face({ piece, orientation, look, region })),
    ),
  ),
)

const nameOf = (f: PrintFinalFace) =>
  `${f.look} ${f.piece} ${f.orientation} (${f.region})`

describe('printFinalHasBack', () => {
  it('is for the Counter card and the Small card; a tent prints its front on both faces', () => {
    expect(PRINT_FINAL_PIECES.filter(printFinalHasBack)).toEqual(['counter', 'small'])
  })

  it('refuses to plan a tent’s back', () => {
    expect(() => back(face({ piece: 'tent' }))).toThrow(/no back page/u)
  })
})

describe('printFinalBackName', () => {
  it('is the property’s name under a logo', () => {
    expect(printFinalBackName(LOGO, '  Harborline Inn ')).toBe('Harborline Inn')
  })

  it('is left out where it only says again what the wordmark has set', () => {
    const wordmark = { kind: 'wordmark', text: 'HOTEL ELEGANCE' } as const
    expect(printFinalBackName(wordmark, 'Hotel  Elegance')).toBeNull()
    expect(printFinalBackName(wordmark, 'Hotel Elegance Lisbon')).toBe(
      'Hotel Elegance Lisbon',
    )
  })

  it('is left out when the property has no name', () => {
    expect(printFinalBackName(LOGO, '   ')).toBeNull()
  })
})

describe('layoutPrintFinalBack', () => {
  it.each(CARDS.map((f) => [nameOf(f), f] as const))(
    '%s: the logo and the name, 2u apart, in the middle of the live area, 44 : 56',
    (_, f) => {
      const { plan } = back(f)
      const area = printFinalLiveArea(f)
      const [brand, name] = plan.parts
      expect(plan.parts.map((part) => part.key)).toEqual(['brand', 'name'])
      expect((name?.yPt ?? 0) - ((brand?.yPt ?? 0) + (brand?.heightPt ?? 0))).toBeCloseTo(
        2 * area.unitPt,
        6,
      )
      const spare =
        area.live.bottomPt -
        area.live.topPt -
        ((name?.yPt ?? 0) + (name?.heightPt ?? 0) - (brand?.yPt ?? 0))
      expect((brand?.yPt ?? 0) - area.live.topPt).toBeCloseTo(0.44 * spare, 6)
      const axis = area.widthPt / 2
      for (const part of plan.parts) {
        expect(part.xPt + part.widthPt / 2).toBeCloseTo(axis, 6)
      }
      expect(plan.fits).toBe(true)
    },
  )

  it.each(CARDS.map((f) => [nameOf(f), f] as const))(
    '%s: keeps inside the margins the front keeps',
    (_, f) => {
      const { plan } = back(f)
      const { live } = printFinalLiveArea(f)
      for (const part of plan.parts) {
        expect(part.xPt).toBeGreaterThanOrEqual(live.leftPt)
        expect(part.xPt + part.widthPt).toBeLessThanOrEqual(live.rightPt + 1e-6)
        expect(part.yPt).toBeGreaterThanOrEqual(live.topPt)
        expect(part.yPt + part.heightPt).toBeLessThanOrEqual(live.bottomPt + 1e-6)
      }
    },
  )

  it('wraps the name no wider than 80 % of an upright trim and 62 % of a wide one', () => {
    const long = 'The Grand Harborline Inn and Suites Millbrook Near The Old Arboretum'
    const upright = back(face(), { propertyName: long })
    const wide = back(face({ orientation: 'wide' }), { propertyName: long })
    const widthOf = (layout: ReturnType<typeof back>) =>
      layout.plan.parts.find((part) => part.key === 'name')?.widthPt ?? Infinity
    expect(widthOf(upright)).toBeLessThanOrEqual(0.8 * printFinalLiveArea(face()).widthPt)
    expect(widthOf(wide)).toBeLessThanOrEqual(
      0.62 * printFinalLiveArea(face({ orientation: 'wide' })).widthPt,
    )
    const nameLines = upright.contents.find((content) => content.kind === 'name')
    expect(nameLines?.kind === 'name' ? nameLines.set.lines.length : 0).toBeGreaterThan(1)
  })

  it('sets the name in Ysabeau Office 600 capitals, tracked 0.08 em, at the piece’s name size', () => {
    const sizes = { counter: 9, small: 8 } as const
    for (const piece of ['counter', 'small'] as const) {
      const set = back(face({ piece })).contents.find((c) => c.kind === 'name')
      expect(set?.kind === 'name' ? set.set.style : null).toMatchObject({
        family: 'sans',
        weight: 600,
        italic: false,
        caps: true,
        trackingEm: 0.08,
        sizePt: sizes[piece],
      })
    }
  })

  it('sets the wordmark where there is no logo, and the name below it when it says something else', () => {
    const both = back(face(), {
      brand: { kind: 'wordmark', text: 'Elegance' },
      propertyName: 'Hotel Elegance Lisbon',
    })
    expect(both.contents.map((content) => content.kind)).toEqual(['wordmark', 'name'])
    const once = back(face(), {
      brand: { kind: 'wordmark', text: 'Hotel Elegance' },
      propertyName: 'Hotel Elegance',
    })
    expect(once.contents.map((content) => content.kind)).toEqual(['wordmark'])
  })

  it('puts the logo on its plate where the front does', () => {
    const plated = back(face({ look: 'immersive' }), {
      brand: { ...LOGO, onPlate: true },
    })
    const logo = plated.contents[0]
    expect(logo?.kind === 'logo' ? logo.box.paddingPt.h : 0).toBeGreaterThan(0)
  })

  it('keeps the Europe Paper A6 card’s guard: the same live area as its front', () => {
    const eu = face({ region: 'eu' })
    const { plan } = back(eu)
    expect(plan.live).toEqual(printFinalLiveArea(eu).live)
    expect(ptMm(plan.live.topPt)).toBeCloseTo(12.7, 1)
  })

  it('says it does not fit when the block is taller than the live area', () => {
    const tall = back(face({ piece: 'small' }), {
      propertyName: 'Hotel '.repeat(200).trim(),
    })
    expect(tall.plan.fits).toBe(false)
    expect(tall.plan.parts[0]?.yPt).toBeCloseTo(tall.plan.live.topPt, 6)
  })

  it('has nothing to place without a brand or a name', () => {
    const none = back(face(), {
      brand: { kind: 'wordmark', text: ' ' },
      propertyName: '',
    })
    expect(none.plan.parts).toEqual([])
    expect(none.plan.block).toBeNull()
    expect(none.contents).toEqual([])
  })
})

describe('planPrintFinalBack against the back-side board', () => {
  const mm = (value: number) => mmPt(value)
  const TOLERANCE_MM = 0.25
  // The board centred the boxes of the logo and of the name's lines; the final
  // design says to place by ink, which sits the block 0.35 mm lower on every
  // card of the board. The split stays the board's 0.44.
  const BLOCK_TOLERANCE_MM = 0.5

  it.each(golden.backs.map((card) => [card.label, card] as const))(
    '%s: the ink margins and the split are the board’s',
    (_, card) => {
      const f = face({
        piece: card.piece as PrintFinalPiece,
        orientation: card.orientation as PrintFinalFace['orientation'],
        look: card.look as PrintFinalFace['look'],
      })
      const plan = planPrintFinalBack(f, [
        { key: 'brand', widthPt: mm(card.brand.w), heightPt: mm(card.brand.h) },
        { key: 'name', widthPt: mm(card.name.w), heightPt: mm(card.name.h) },
      ])
      const block = plan.block
      if (block === null) throw new Error('a back with a brand has a block')
      const margins = {
        L: ptMm(block.leftPt),
        R: ptMm(plan.widthPt - block.rightPt),
        T: ptMm(block.topPt),
        B: ptMm(plan.heightPt - block.bottomPt),
      }
      expect(Math.abs(margins.L - card.margins.L)).toBeLessThanOrEqual(TOLERANCE_MM)
      expect(Math.abs(margins.R - card.margins.R)).toBeLessThanOrEqual(TOLERANCE_MM)
      expect(Math.abs(margins.T - card.margins.T)).toBeLessThanOrEqual(BLOCK_TOLERANCE_MM)
      expect(Math.abs(margins.B - card.margins.B)).toBeLessThanOrEqual(BLOCK_TOLERANCE_MM)
      expect(margins.T / (margins.T + margins.B)).toBeCloseTo(card.spareSplitTop, 1)
    },
  )
})
