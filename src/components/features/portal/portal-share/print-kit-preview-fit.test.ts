import { describe, expect, it } from 'vitest'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { printKitFaces, type PrintKitWords } from '#/shared/domain/portal-print-kit'
import { scaleSizes } from '#/shared/domain/portal-print-kit-long-copy'
import { FIT, TENT_FACE, TYPE_FLOOR_PT } from '#/shared/domain/portal-print-kit-measures'
import {
  estimatedStackHeight,
  fittedSizes,
  previewPaperFit,
  tentCodeOffsetPt,
} from './print-kit-preview-fit'

const frontOf = (choice: PrintKitWords, titles: Readonly<Record<string, string>>) => {
  const [front] = printKitFaces(choice, titles, 'Portal')
  if (front === undefined) throw new Error('no face')
  return front
}

const card = (languages: PrintKitWords['languages']): PrintKitWords => ({
  piece: 'counter_card',
  languages,
  callToAction: 'rate',
})

const look = (logoUrl: string | null = null): PortalPrintKitView['look'] => ({
  wordmark: 'Avela',
  propertyName: 'Avela Beach Resort',
  accentColour: '#EAD6A8',
  fieldColour: '#16130E',
  heroUrl: null,
  heroFocal: null,
  logoUrl,
})

const LONG =
  'The rooftop terrace bar and lounge overlooking the old harbour, with the garden restaurant and the spa on the lower deck'

describe('previewPaperFit', () => {
  it('sets two languages at the full scale and a full brand when they fit, as the PDF does', () => {
    const face = frontOf(card(['en', 'es']), {
      en: 'Pool & Terrace',
      es: 'Piscina y terraza',
    })
    for (const geometry of ['card4x6', 'cardA6'] as const) {
      expect(previewPaperFit(face, geometry, look())).toMatchObject({
        scale: 'two',
        sizes: scaleSizes('two'),
        wordmarkPt: 16,
      })
    }
  })

  it('shrinks a logo to its floor before it steps the type down', () => {
    const face = frontOf(card(['en', 'es']), {
      en: 'The terrace bar by the pool',
      es: 'Piscina',
    })
    expect(previewPaperFit(face, 'card4x6', look('/logo.png'))).toMatchObject({
      scale: 'two',
      logoHeightPt: FIT.logoFloorPt,
    })
  })

  it('steps two languages down when the words would not leave the gaps their minimums', () => {
    const face = frontOf(card(['en', 'bg']), {
      en: 'Spa & Wellness Centre Reception, Lobby Bar and the Garden Terrace by the Pool',
      bg: 'Спа и уелнес център, рецепция, лоби бар и градинската тераса до басейна',
    })
    expect(previewPaperFit(face, 'cardA6', look())?.scale).toBe('twoTight')
  })

  it('takes the long-copy steps for a 120-character title: the second language first, then the place label', () => {
    const face = frontOf(card(['en', 'fr']), { en: LONG, fr: LONG })
    const fit = previewPaperFit(face, 'cardA6', look())
    expect(fit?.sizes).toMatchObject({ place2: 9, head2: 11.5, sub2: 9 })
    expect(fit?.sizes.place ?? 0).toBeLessThan(TYPE_FLOOR_PT.place)
  })

  it('sets one language alone, and the tent face in the tent scale', () => {
    expect(
      previewPaperFit(frontOf(card(['en']), { en: 'Chair 3' }), 'card4x6', look())?.scale,
    ).toBe('one')
    const tent = frontOf({ ...card(['en', 'es']), piece: 'table_tent' }, {})
    expect(previewPaperFit(tent, 'tentFaceLetter', look())).toMatchObject({
      scale: 'tent',
      sizes: scaleSizes('tent'),
    })
    expect(previewPaperFit(tent, 'tentPanel4x6', look())).toBeNull()
  })
})

describe('estimatedStackHeight', () => {
  it('grows with the words and shrinks with the long-copy sizes', () => {
    const face = frontOf(card(['en', 'fr']), { en: LONG, fr: LONG })
    const own = estimatedStackHeight(face, 'twoTight', 250)
    const floors = {
      ...scaleSizes('twoTight'),
      place: 9,
      place2: 9,
      head2: 11.5,
      sub2: 9,
    }
    expect(estimatedStackHeight(face, 'twoTight', 250, { sizes: floors })).toBeLessThan(
      own,
    )
  })
})

describe('fittedSizes', () => {
  it('keeps the scale’s own sizes when they fit, else the first step that does, else the last', () => {
    expect(fittedSizes('twoTight', () => true)).toEqual(scaleSizes('twoTight'))
    expect(fittedSizes('twoTight', (sizes) => sizes.place <= 21).place).toBe(21)
    expect(fittedSizes('twoTight', () => false).place).toBe(TYPE_FLOOR_PT.read)
  })
})

describe('tentCodeOffsetPt', () => {
  it('keeps the tile on the place label’s cap line as the label shrinks', () => {
    expect(tentCodeOffsetPt(40)).toBeCloseTo(TENT_FACE.codeTopOffsetPt, 10)
    expect(tentCodeOffsetPt(20)).toBeCloseTo(TENT_FACE.codeTopOffsetPt / 2, 10)
  })
})
