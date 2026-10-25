import { describe, expect, it } from 'vitest'
import {
  PRINT_FINAL_CUSTOM_MAX_CHARACTERS,
  normalisePrintFinalText,
  printFinalCopyOf,
  printFinalCustomProblem,
  printFinalIsOwnCopy,
  printFinalStoredCustom,
  printFinalWordsHeldLanguage,
  tidyPrintFinalTyping,
} from './portal-print-final-custom'

describe('the own words as typed (spec 5.6)', () => {
  it('turns line breaks into spaces, closes up runs of spaces and drops a leading one, leaving the end to type on', () => {
    expect(tidyPrintFinalTyping('  How was\n\nyour   stay ')).toBe('How was your stay ')
    expect(normalisePrintFinalText('  How was\r\nyour   stay ')).toBe('How was your stay')
  })

  it('keeps typographic quotes and apostrophes as typed', () => {
    expect(normalisePrintFinalText('Com’è andata? “Bene”')).toBe('Com’è andata? “Bene”')
  })
})

describe('printFinalCustomProblem', () => {
  const words = (headline: string, subline = '') => ({ en: { headline, subline } })

  it('takes a headline with an empty sub-line', () => {
    expect(printFinalCustomProblem(words('How was today?'), ['en'])).toBeNull()
  })

  it('refuses an empty headline, a field past 60 characters and a control character', () => {
    expect(printFinalCustomProblem(words('   '), ['en'])).toBe('empty_headline')
    expect(
      printFinalCustomProblem(words('a'.repeat(PRINT_FINAL_CUSTOM_MAX_CHARACTERS + 1)), [
        'en',
      ]),
    ).toBe('too_long')
    expect(printFinalCustomProblem(words('How\u0007 was it'), ['en'])).toBe(
      'control_characters',
    )
  })

  it('refuses words in a language that is not on the print', () => {
    expect(
      printFinalCustomProblem({ es: { headline: '¿Qué tal hoy?', subline: '' } }, ['en']),
    ).toBe('language_not_on_print')
  })
})

describe('the words a print resolves to', () => {
  it('reads a language without own words from the wording', () => {
    expect(printFinalCopyOf({ preset: 'got_30_seconds' }, 'en')).toEqual({
      headline: 'Got 30 seconds?',
      subline: 'Tell us how it went',
    })
  })

  it('counts words as the manager’s own only when they differ from the wording', () => {
    const prefilled = {
      preset: 'how_did_we_do' as const,
      custom: { en: { headline: 'How did we do? ', subline: 'About 30 seconds' } },
    }
    expect(printFinalIsOwnCopy(prefilled, 'en')).toBe(false)
    expect(
      printFinalIsOwnCopy(
        { ...prefilled, custom: { en: { headline: 'How was today?', subline: '' } } },
        'en',
      ),
    ).toBe(true)
  })

  it('stores the own words normalised, only for the print’s languages, and nothing without them', () => {
    expect(
      printFinalStoredCustom(
        {
          preset: 'how_did_we_do',
          custom: {
            en: { headline: ' How was today? ', subline: '' },
            de: { headline: 'Wie war es?', subline: '' },
          },
        },
        ['en'],
      ),
    ).toEqual({ en: { headline: 'How was today?', subline: '' } })
    expect(printFinalStoredCustom({ preset: 'how_did_we_do' }, ['en'])).toBeNull()
  })

  it('holds a wording back only where a language would print its held copy', () => {
    expect(printFinalWordsHeldLanguage({ preset: 'got_30_seconds' }, ['en', 'de'])).toBe(
      'de',
    )
    expect(
      printFinalWordsHeldLanguage(
        {
          preset: 'got_30_seconds',
          custom: { de: { headline: 'Wie war es?', subline: '' } },
        },
        ['en', 'de'],
      ),
    ).toBeNull()
  })
})
