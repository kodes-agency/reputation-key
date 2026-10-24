// The Large card's fit (round-3 spec-delta S3 and S4, round-2 "Fit order") and
// the words it sets (round-2 R2 and R5), measured with a stub so each rule is
// aimed at exactly.

import { describe, expect, it } from 'vitest'
import type { PrintTextBlock } from './portal-print-kit'
import {
  CARD_CTA_ONE_LINE_FLOOR_PT,
  chooseCardFit,
  largeCardFitSteps,
  shareCardHeight,
} from './portal-print-kit-card-fit'
import {
  layoutCardMessage,
  layoutCardName,
  type CardLine,
  type CardTextMeasure,
} from './portal-print-kit-card-words'
import { FIT } from './portal-print-kit-measures'
import { LOGO_OPTICAL } from './portal-print-kit-size-type'
import { BAND, FACE_SPACING } from './portal-print-kit-sizes'

/** Every character is half an em wide: easy to aim at a column. */
const halfEm: CardTextMeasure = (text, style) => [...text].length * 0.5 * style.sizePt

const block = (headline: string, kicker = 'Reception'): PrintTextBlock => ({
  locale: 'en',
  kicker,
  headline,
  subline: 'Private, about 30 seconds',
})

const linesOf = (items: readonly unknown[]) =>
  items.filter((item): item is CardLine => (item as CardLine).kind === 'line')

describe('largeCardFitSteps', () => {
  it('steps the eyebrow, the call to action, the sub-line, the logo and the second call to action, then takes the same steps again without the name', () => {
    const steps = largeCardFitSteps('immersive')
    expect(
      steps.map((step) => [
        step.eyebrowPt,
        step.ctaPt,
        step.subPt,
        step.cta2Pt,
        step.name,
      ]),
    ).toEqual([
      [10, 28, 11, 15, true],
      [9, 28, 11, 15, true],
      [9, 24, 11, 15, true],
      [9, 24, 10, 15, true],
      [9, 24, 10, 15, true],
      [9, 24, 10, 13, true],
      [10, 28, 11, 15, false],
      [9, 28, 11, 15, false],
      [9, 24, 11, 15, false],
      [9, 24, 10, 15, false],
      [9, 24, 10, 15, false],
      [9, 24, 10, 13, false],
    ])
    expect(steps[3]?.logo).toBe(LOGO_OPTICAL.large.immersive)
    expect(steps[4]?.logo).toBe(LOGO_OPTICAL.table.immersive)
    expect(steps[2]?.ctaOneLineFloorPt).toBe(CARD_CTA_ONE_LINE_FLOOR_PT)
  })

  it('keeps Paper’s call to action 2 pt above Immersive’s at every step', () => {
    const paper = largeCardFitSteps('paper').map((step) => step.ctaPt)
    const immersive = largeCardFitSteps('immersive').map((step) => step.ctaPt)
    expect(paper.map((pt, index) => pt - (immersive[index] ?? 0))).toEqual(
      Array(12).fill(2),
    )
  })
})

describe('shareCardHeight', () => {
  const band = BAND.large

  it('keeps the band at its target and gives the gaps the rest, equally', () => {
    expect(shareCardHeight({ heightPt: 432, fixedPt: 260, band }, 14)).toEqual({
      bandPt: band.targetPt,
      gapPt: (432 - 260 - band.targetPt) / 2,
    })
  })

  it('shrinks the band before the gaps go under their minimum, and never under its own', () => {
    const tight = shareCardHeight(
      { heightPt: 432, fixedPt: 432 - band.targetPt - 26, band },
      14,
    )
    expect(tight.bandPt).toBeCloseTo(band.targetPt - 2, 10)
    expect(tight.gapPt).toBeCloseTo(14, 10)
    const tighter = shareCardHeight({ heightPt: 432, fixedPt: 340, band }, 14)
    expect(tighter.bandPt).toBe(band.minPt)
    expect(tighter.gapPt).toBeLessThan(14)
  })

  it('splits all the spare height between the gaps on Paper', () => {
    expect(shareCardHeight({ heightPt: 432, fixedPt: 336, band: null }, 14)).toEqual({
      bandPt: null,
      gapPt: 48,
    })
  })
})

describe('chooseCardFit', () => {
  const steps = largeCardFitSteps('immersive')
  const frame = { heightPt: 432, band: BAND.large, gapMinPt: 14 }
  /** A card whose parts take `fixed[i]` at step i. */
  const card = (fixed: readonly number[]) => (step: (typeof steps)[number]) => ({
    fixedPt: fixed[steps.indexOf(step)] ?? 0,
    value: steps.indexOf(step),
  })
  const room = (gap: number) => 432 - BAND.large.minPt - 2 * gap

  it('stops at the first step whose gaps reach the minimum', () => {
    const choice = chooseCardFit(
      steps,
      frame,
      card([room(10), room(12), room(15), 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    )
    expect(choice.index).toBe(2)
  })

  it('takes every type step and keeps the name when its gaps stay at 2 mm or more', () => {
    const fixed = [
      room(3),
      room(4),
      room(5),
      room(6),
      room(7),
      room(FIT.gapPt.floor + 0.5),
      ...Array<number>(6).fill(room(30)),
    ]
    const choice = chooseCardFit(steps, frame, card(fixed))
    expect(choice.index).toBe(5)
    expect(choice.step.name).toBe(true)
  })

  it('drops the name only when every type step leaves the gaps under 2 mm, then sets the rest from the roomiest step that fits', () => {
    const named = [room(1), room(1), room(2), room(2), room(3), room(4)]
    const nameless = [room(9), room(16), room(20), room(20), room(20), room(20)]
    const choice = chooseCardFit(steps, frame, card([...named, ...nameless]))
    expect(choice.index).toBe(7)
    expect(choice.step.name).toBe(false)
    expect(choice.step.ctaPt).toBe(28)
  })

  it('takes the tightest step without the name when none reaches the minimum', () => {
    const fixed = [...Array<number>(6).fill(room(1)), ...Array<number>(6).fill(room(8))]
    expect(chooseCardFit(steps, frame, card(fixed)).index).toBe(11)
  })
})

describe('layoutCardName', () => {
  it('balances a long name into two lines of capitals at 8.5 pt', () => {
    const name = layoutCardName(
      'Oakmere by Larkspur Hotel Houston Hobby Airport',
      8.5,
      150,
      halfEm,
    )
    expect(name.items.map((line) => (line as CardLine).text)).toEqual([
      'OAKMERE BY LARKSPUR HOTEL',
      'HOUSTON HOBBY AIRPORT',
    ])
    expect(name.heightPt).toBeCloseTo(2 * 8.5 * 1.22, 10)
  })

  it('breaks after a hyphen when that balances the lines better, as the boards do', () => {
    const name = layoutCardName(
      'Harborline Inn Houston-Near The Galleria',
      8.5,
      150,
      halfEm,
    )
    expect(name.items.map((line) => (line as CardLine).text)).toEqual([
      'HARBORLINE INN HOUSTON-',
      'NEAR THE GALLERIA',
    ])
  })

  it('shrinks toward 7 pt only when two lines would not hold it', () => {
    const name = layoutCardName(
      'A'.repeat(20).split('').join(' ') + ' WORDS',
      8.5,
      30,
      halfEm,
    )
    const sizes = new Set(linesOf(name.items).map((line) => line.style.sizePt))
    expect([...sizes]).toEqual([7])
  })
})

describe('layoutCardMessage', () => {
  const spacing = FACE_SPACING.large
  const type = {
    eyebrowPt: 10,
    ctaPt: 28,
    ctaOneLineFloorPt: null,
    subPt: 11,
    cta2Pt: 15,
  }

  it('prints a translated title once on the eyebrow line, after a middle dot, and an untranslated one alone', () => {
    const second = { ...block('Valore su visita', 'Recepción'), locale: 'es' } as const
    const two = layoutCardMessage({
      blocks: [block('Rate your visit'), second],
      type,
      spacing,
      widthPt: 300,
      eyebrow: true,
      measure: halfEm,
    })
    expect(linesOf(two.items)[0]?.text).toBe('RECEPTION · RECEPCIÓN')
    const same = { ...second, kicker: 'Reception' }
    const once = layoutCardMessage({
      blocks: [block('Rate your visit'), same],
      type,
      spacing,
      widthPt: 300,
      eyebrow: true,
      measure: halfEm,
    })
    expect(linesOf(once.items)[0]?.text).toBe('RECEPTION')
  })

  it('stacks the eyebrow, the call to action and the sub-line on the size’s ties, then the rule and the second call to action', () => {
    const second = { ...block('Valore su visita'), locale: 'es' } as const
    const words = layoutCardMessage({
      blocks: [block('Rate your visit'), second],
      type,
      spacing,
      widthPt: 300,
      eyebrow: true,
      measure: halfEm,
    })
    const [eyebrow, cta, sub, rule, cta2] = words.items
    expect(cta?.topPt).toBeCloseTo((eyebrow as CardLine).heightPt + 4, 10)
    expect(sub?.topPt).toBeCloseTo((cta?.topPt ?? 0) + 28 + 3, 10)
    expect(rule?.kind).toBe('rule')
    expect(rule?.topPt).toBeCloseTo((sub?.topPt ?? 0) + 11 * 1.25 + 9, 10)
    expect((cta2 as CardLine).role).toBe('cta2')
    expect(words.items).toHaveLength(5)
  })

  it('shrinks an eyebrow to 9 pt before it wraps', () => {
    const kicker = 'A long portal title'
    const fits = layoutCardMessage({
      blocks: [block('Rate', kicker)],
      type,
      spacing,
      widthPt: kicker.length * 4.6,
      eyebrow: true,
      measure: halfEm,
    })
    expect(linesOf(fits.items)[0]?.style.sizePt).toBeLessThan(10)
    expect(linesOf(fits.items).filter((line) => line.role === 'eyebrow')).toHaveLength(1)
    const wraps = layoutCardMessage({
      blocks: [block('Rate', kicker)],
      type,
      spacing,
      widthPt: 40,
      eyebrow: true,
      measure: halfEm,
    })
    const eyebrows = linesOf(wraps.items).filter((line) => line.role === 'eyebrow')
    expect(eyebrows.length).toBeGreaterThan(1)
    expect(eyebrows[0]?.style.sizePt).toBe(9)
  })

  it('holds a stepped call to action on one line down to 20 pt, and balances it over two where it cannot', () => {
    const stepped = { ...type, ctaPt: 24, ctaOneLineFloorPt: 20 }
    const headline = 'Rate your stay'
    const one = layoutCardMessage({
      blocks: [block(headline)],
      type: stepped,
      spacing,
      widthPt: headline.length * 10.5,
      eyebrow: false,
      measure: halfEm,
    })
    const [cta] = linesOf(one.items)
    expect(cta?.style.sizePt).toBeLessThan(24)
    expect(cta?.style.sizePt).toBeGreaterThanOrEqual(20)
    const two = layoutCardMessage({
      blocks: [block(headline)],
      type: stepped,
      spacing,
      widthPt: 120,
      eyebrow: false,
      measure: halfEm,
    })
    const ctas = linesOf(two.items).filter((line) => line.role === 'cta')
    expect(ctas).toHaveLength(2)
    expect(ctas[0]?.style.sizePt).toBe(24)
  })
})
