import { describe, expect, it } from 'vitest'
import type { GuestLocale } from './guest-locale'
import type { PrintTextBlock } from './portal-print-kit'
import { printFinalBlocks } from './portal-print-final-languages'
import type { PrintFinalFace } from './portal-print-final'
import { choosePrintFinalTile } from './portal-print-final-code'
import {
  layoutPrintFinalFace,
  type PrintFinalBrandInput,
  type PrintFinalFaceLayout,
} from './portal-print-final-face'
import { inPt } from './portal-print-final-measures'
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
  printFinalBlocks(
    languages,
    { preset: 'how_did_we_do' },
    { en: 'Review us on Google', es: 'Reseñe en Google', de: 'Bewerten Sie uns' },
    'Reception',
  )

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
  it('starts the message with the kicker (no stars on any piece), and has no kicker on the Small card', () => {
    expect(keysOf(layout(face()))).toEqual(['brand', 'kicker', 'headline', 'subline'])
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

  it('leaves the kicker out when the headline repeats it, and keeps every other part', () => {
    const [block] = blocksOf(['en'])
    if (block === undefined) throw new Error('one block')
    const repeated = [{ ...block, kicker: 'How did we do', headline: 'How did we do?' }]
    expect(keysOf(layout(face(), ['en'], { blocks: repeated }))).toEqual([
      'brand',
      'headline',
      'subline',
    ])
    expect(keysOf(layout(face({ piece: 'tent' }), ['en'], { blocks: repeated }))).toEqual(
      ['brand', 'headline', 'subline'],
    )
  })

  it('re-centres the message when the kicker is left out, with the gaps still 4u to 8u', () => {
    const [block] = blocksOf(['en'])
    if (block === undefined) throw new Error('one block')
    const kept = layout(face())
    const hidden = layout(face(), ['en'], {
      blocks: [{ ...block, kicker: block.headline }],
    })
    expect(hidden.plan.fits).toBe(true)
    const gap = (laid: PrintFinalFaceLayout) => laid.plan.gapsPt.brandToMessage ?? NaN
    const unit = kept.plan.unitPt
    expect(gap(hidden)).toBeGreaterThanOrEqual(4 * unit)
    expect(gap(hidden)).toBeLessThanOrEqual(8 * unit + 1e-6)
    // The message group is shorter by the kicker and its 1u, so the gaps grow.
    expect(hidden.plan.groups.message?.bottomPt).toBeLessThan(
      kept.plan.groups.message?.bottomPt ?? NaN,
    )
  })

  it('prints two languages in full under a rule on the Counter card and the wide pieces', () => {
    for (const f of [face(), face({ piece: 'tent', orientation: 'wide' })]) {
      const laid = layout(f, ['en', 'es'])
      expect(keysOf(laid).slice(-4)).toEqual(['subline', 'rule', 'headline2', 'subline2'])
      expect(laid.cues.map(({ text, locale }) => ({ text, locale }))).toEqual([
        { text: 'Scan with your camera', locale: 'en' },
        { text: 'Escanee con la cámara', locale: 'es' },
      ])
    }
  })

  it('centres the cue lines in the bar by their ink', () => {
    for (const languages of [['en'], ['en', 'es']] as const) {
      const laid = layout(face(), languages)
      const [first, ...rest] = laid.cues
      const last = rest.at(-1) ?? first
      // The test measurer's ink rises 0.7 em and falls 0.2 em from the baseline.
      const cuePt = 9
      const above = (first?.baselinePt ?? NaN) - 0.7 * cuePt
      const below = laid.code.barPt - ((last?.baselinePt ?? NaN) + 0.2 * cuePt)
      expect(above).toBeCloseTo(below, 6)
      expect(above).toBeGreaterThan(0)
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

  it('steps a headline that would take 4 lines down until it takes 3', () => {
    const [block] = blocksOf(['en'])
    if (block === undefined) throw new Error('one block')
    const long = [
      { ...block, headline: 'Tell us how your stay with us went today in a few taps' },
    ]
    const laid = layout(face(), ['en'], { blocks: long })
    const headline = laid.plan.parts.find((part) => part.key === 'headline')
    expect(headline?.lines).toBeLessThanOrEqual(3)
    expect(laid.headlinePt).toBeLessThan(28)
    expect(laid.headlinePt).toBeGreaterThanOrEqual(20)
    expect(laid.overflows).toBe(false)
  })

  it('refuses words the floor cannot hold: the headline stays at the floor and overflows', () => {
    const [block] = blocksOf(['en'])
    if (block === undefined) throw new Error('one block')
    const absurd = [{ ...block, headline: 'Tell us how your stay went today '.repeat(5) }]
    const laid = layout(face(), ['en'], { blocks: absurd })
    expect(laid.headlinePt).toBe(20)
    expect(laid.overflows).toBe(true)
    expect(laid.plan.problems.length).toBeGreaterThan(0)
  })

  it('refuses a sub-line on 3 lines, even where the gaps hold', () => {
    const [block] = blocksOf(['en'])
    if (block === undefined) throw new Error('one block')
    const wordy = [{ ...block, subline: 'About thirty seconds of your time '.repeat(3) }]
    const laid = layout(face(), ['en'], { blocks: wordy })
    expect(laid.plan.problems).toContain('subline_over_cap')
    expect(laid.overflows).toBe(true)
  })

  it('refuses only the orientation that misses at the floor: the other one still prints at the shared size', () => {
    const [block] = blocksOf(['en'])
    if (block === undefined) throw new Error('one block')
    const words = (n: number) => [
      { ...block, headline: Array.from({ length: n }, () => 'word').join(' ') },
    ]
    const only = Array.from({ length: 40 }, (_, i) => i + 3).find((n) => {
      const upright = layout(face({ piece: 'tent' }), ['en'], { blocks: words(n) })
      const wide = layout(face({ piece: 'tent', orientation: 'wide' }), ['en'], {
        blocks: words(n),
      })
      return upright.overflows && !wide.overflows
    })
    expect(only).toBeDefined()
    const upright = layout(face({ piece: 'tent' }), ['en'], { blocks: words(only ?? 0) })
    const wide = layout(face({ piece: 'tent', orientation: 'wide' }), ['en'], {
      blocks: words(only ?? 0),
    })
    // Both print at the floor, the size the tighter orientation needs.
    expect(wide.headlinePt).toBe(upright.headlinePt)
    expect(wide.headlinePt).toBe(16.5)
  })

  it('wraps a cue the measurer finds too wide into the two-line bar', () => {
    // This measurer sets every character half an em wide, wider than the font: English no longer fits the Small card.
    const laid = layout(face({ piece: 'small', orientation: 'wide' }), ['en'])
    expect(laid.cues.map(({ text, locale }) => ({ text, locale }))).toEqual([
      { text: 'Scan with', locale: 'en' },
      { text: 'your camera', locale: 'en' },
    ])
    expect(laid.code.barPt).toBeCloseTo(inPt(0.3))
  })

  it('keeps every language’s cue on one line on the tent, measured as the font sets it', () => {
    const laid = layout(face({ piece: 'tent', orientation: 'wide' }), ['de'])
    expect(laid.cues).toHaveLength(1)
    expect(laid.cues[0]?.text).toBe('Mit Kamera scannen')
    expect(laid.code.barPt).toBeCloseTo(inPt(0.3))
  })
})
