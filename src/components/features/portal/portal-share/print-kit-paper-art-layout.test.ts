import { describe, expect, it } from 'vitest'
import { printKitFaces, type PrintKitWords } from '#/shared/domain/portal-print-kit'
import {
  previewPaperScale,
  printKitSheetLabel,
  ptToContainerWidth,
} from './print-kit-paper-art-layout'

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

describe('previewPaperScale', () => {
  it('sets two languages at the full scale when they fit, as the PDF does', () => {
    const face = frontOf(card(['en', 'es']), {
      en: 'Pool & Terrace',
      es: 'Piscina y terraza',
    })
    expect(previewPaperScale(face, 'card4x6')).toBe('two')
    expect(previewPaperScale(face, 'cardA6')).toBe('two')
  })

  it('steps two languages down once when the words would not leave the gaps their minimums', () => {
    const face = frontOf(card(['en', 'bg']), {
      en: 'Spa & Wellness Centre Reception, Lobby Bar and the Garden Terrace by the Pool',
      bg: 'Спа и уелнес център, рецепция, лоби бар и градинската тераса до басейна',
    })
    expect(previewPaperScale(face, 'cardA6')).toBe('twoTight')
  })

  it('sets one language alone, and the tent face in the tent scale', () => {
    expect(previewPaperScale(frontOf(card(['en']), { en: 'Chair 3' }), 'card4x6')).toBe(
      'one',
    )
    const tent = frontOf({ ...card(['en', 'es']), piece: 'table_tent' }, {})
    expect(previewPaperScale(tent, 'tentFaceLetter')).toBe('tent')
  })
})

describe('printKitSheetLabel', () => {
  it('says the sheet, the cards on it and the page, as the Share tab’s caption does', () => {
    expect(
      printKitSheetLabel('counter_card', 'letter', { index: 0, count: 2, faces: 2 }),
    ).toBe('Letter · two 4 × 6 in counter cards · page 1 of 2, fronts')
    expect(
      printKitSheetLabel('counter_card', 'a4', { index: 1, count: 2, faces: 4 }),
    ).toBe('A4 · four A6 counter cards · page 2 of 2, backs')
    expect(printKitSheetLabel('table_tent', 'a4', { index: 0, count: 1, faces: 2 })).toBe(
      'A4 · table tent, folded in half to two A5 faces',
    )
  })
})

describe('ptToContainerWidth', () => {
  it('turns points into a share of the face’s width', () => {
    expect(ptToContainerWidth(144, 288)).toBe('50cqw')
    expect(ptToContainerWidth(18, 612)).toBe('2.9412cqw')
  })
})
