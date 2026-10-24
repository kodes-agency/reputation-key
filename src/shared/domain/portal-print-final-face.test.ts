import { describe, expect, it } from 'vitest'
import type { GuestLocale } from './guest-locale'
import { printKitFaces, type PrintTextBlock } from './portal-print-kit'
import type { PrintFinalFace } from './portal-print-final'
import { choosePrintFinalTile } from './portal-print-final-code'
import {
  layoutPrintFinalFace,
  type PrintFinalBrandInput,
  type PrintFinalFaceLayout,
} from './portal-print-final-face'
import { printFinalStars } from './portal-print-final-marks'
import { inPt, ptMm } from './portal-print-final-measures'
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

const LOGO: PrintFinalBrandInput = {
  kind: 'logo',
  inkWidth: 2,
  inkHeight: 1,
  onPlate: false,
}

const face = (over: Partial<PrintFinalFace> = {}): PrintFinalFace => ({
  piece: 'counter',
  orientation: 'upright',
  look: 'paper',
  region: 'us',
  ...over,
})

const blocksOf = (languages: readonly GuestLocale[]): readonly PrintTextBlock[] =>
  printKitFaces(
    { piece: 'counter_card', languages, callToAction: 'rate' },
    { en: 'Review us on Google', es: 'Reseñe en Google', de: 'Bewerten Sie uns' },
    'Reception',
  )[0]?.blocks ?? []

function layout(
  f: PrintFinalFace,
  languages: readonly GuestLocale[] = ['en'],
  over: Partial<{ brand: PrintFinalBrandInput; blocks: readonly PrintTextBlock[] }> = {},
): PrintFinalFaceLayout {
  const tile = choosePrintFinalTile({ ...f, address: 'short', symbolModules: 29 })
  return layoutPrintFinalFace({
    face: f,
    blocks: over.blocks ?? blocksOf(languages),
    brand: over.brand ?? LOGO,
    tile: tile._unsafeUnwrap(),
    measurer,
  })
}

const keysOf = (laid: PrintFinalFaceLayout) => laid.plan.parts.map((part) => part.key)

describe('layoutPrintFinalFace', () => {
  it('puts the stars above the kicker on the Counter card, and neither stars nor kicker on the Small card', () => {
    expect(keysOf(layout(face()))).toEqual([
      'brand',
      'stars',
      'kicker',
      'headline',
      'subline',
    ])
    expect(keysOf(layout(face({ piece: 'tent' })))).toEqual([
      'brand',
      'kicker',
      'headline',
      'subline',
    ])
    expect(keysOf(layout(face({ piece: 'small', orientation: 'wide' })))).toEqual([
      'brand',
      'headline',
      'subline',
    ])
  })

  it('measures the stars by their outlines: the board’s 21.1 × 2.7 mm row', () => {
    const stars = printFinalStars()
    expect(ptMm(stars.widthPt)).toBeCloseTo(21.1, 0)
    expect(ptMm(stars.heightPt)).toBeCloseTo(2.7, 1)
    expect(stars.origins).toHaveLength(5)
  })

  it('prints two languages in full under a rule on the Counter card and the wide pieces', () => {
    for (const f of [face(), face({ piece: 'tent', orientation: 'wide' })]) {
      const laid = layout(f, ['en', 'es'])
      expect(keysOf(laid).slice(-4)).toEqual(['subline', 'rule', 'headline2', 'subline2'])
      expect(laid.cues).toEqual([
        { text: 'Scan with your camera', locale: 'en' },
        { text: 'Escanee con la cámara', locale: 'es' },
      ])
    }
  })

  it('turns the second language into one small italic line on the upright tent and Small card', () => {
    for (const piece of ['tent', 'small'] as const) {
      const laid = layout(face({ piece }), ['en', 'es'])
      expect(keysOf(laid).at(-1)).toBe('secondLine')
      const line = laid.contents.at(-1)
      expect(line?.kind === 'words' && line.set.style.italic).toBe(true)
      expect(line?.kind === 'words' && line.locale).toBe('es')
    }
  })

  it('sets the wordmark in tracked capitals when there is no logo', () => {
    const laid = layout(face(), ['en'], {
      brand: { kind: 'wordmark', text: 'Hotel Elegance' },
    })
    const brand = laid.contents[0]
    expect(brand?.kind).toBe('wordmark')
    expect(brand?.kind === 'wordmark' && brand.set.lines[0]?.text).toBe('HOTEL ELEGANCE')
  })

  it('keeps the full headline when the words fit, and the planner’s gaps at 4u or more', () => {
    const laid = layout(face())
    expect(laid.headlinePt).toBe(28)
    expect(laid.overflows).toBe(false)
    expect(laid.plan.fits).toBe(true)
  })

  it('steps a long headline down the same in both orientations, never under the floor', () => {
    const [block] = blocksOf(['en'])
    if (block === undefined) throw new Error('one block')
    const long = [{ ...block, headline: 'Tell us how your stay at the hotel went today' }]
    const upright = layout(face({ piece: 'tent' }), ['en'], { blocks: long })
    const wide = layout(face({ piece: 'tent', orientation: 'wide' }), ['en'], {
      blocks: long,
    })
    expect(upright.headlinePt).toBeLessThan(19)
    expect(upright.headlinePt).toBe(wide.headlinePt)
    expect(upright.headlinePt).toBeGreaterThanOrEqual(16.5)
  })

  it('wraps a long cue into the two-line bar', () => {
    const laid = layout(face({ piece: 'tent', orientation: 'wide' }), ['de'])
    expect(laid.cues).toEqual([
      { text: 'Mit der Kamera', locale: 'de' },
      { text: 'scannen', locale: 'de' },
    ])
    expect(laid.code.barPt).toBeCloseTo(inPt(0.38))
  })
})
