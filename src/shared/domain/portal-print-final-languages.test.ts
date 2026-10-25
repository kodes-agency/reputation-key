import { describe, expect, it } from 'vitest'
import {
  PRINT_FINAL_CALL_TO_ACTION_LABELS,
  printFinalBlocks,
  printFinalLanguageChoiceLabel,
  printFinalLanguageChoices,
  printFinalLanguageValue,
} from './portal-print-final-languages'

describe('printFinalLanguageChoices', () => {
  it('offers every ordered pair, each language followed by itself alone, the primary first', () => {
    expect(printFinalLanguageChoices(['en', 'es', 'de'])).toEqual([
      ['en', 'es'],
      ['en', 'de'],
      ['en'],
      ['es', 'en'],
      ['es', 'de'],
      ['es'],
      ['de', 'en'],
      ['de', 'es'],
      ['de'],
    ])
  })

  it('offers one language alone when the portal has one', () => {
    expect(printFinalLanguageChoices(['bg'])).toEqual([['bg']])
  })
})

describe('the language labels', () => {
  it('reads as the board: the first language, then the second, each in its own words', () => {
    expect(printFinalLanguageChoiceLabel(['en', 'es'])).toBe('English, then Español')
    expect(printFinalLanguageChoiceLabel(['bg'])).toBe('Български')
    expect(printFinalLanguageValue(['en', 'es'])).toBe('en+es')
  })
})

describe('PRINT_FINAL_CALL_TO_ACTION_LABELS', () => {
  it('reads each call to action as the print says it', () => {
    expect(PRINT_FINAL_CALL_TO_ACTION_LABELS).toEqual({
      rate: 'Rate your visit · Private, about 30 seconds',
      tell: 'How was your visit? · About 30 seconds',
    })
  })
})

describe('printFinalBlocks', () => {
  it('says the page’s title and the call to action in each language, the first leading', () => {
    expect(
      printFinalBlocks(['en', 'es'], 'rate', { en: 'Reception' }, 'Front desk'),
    ).toEqual([
      {
        locale: 'en',
        kicker: 'Reception',
        headline: 'Rate your visit',
        subline: 'Private, about 30 seconds',
      },
      {
        locale: 'es',
        kicker: 'Front desk',
        headline: 'Valore su visita',
        subline: 'En privado, unos 30 segundos',
      },
    ])
  })
})
