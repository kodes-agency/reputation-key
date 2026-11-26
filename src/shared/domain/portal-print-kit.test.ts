import { describe, expect, it } from 'vitest'
import {
  PRINT_KIT_LETTER_COUNTRIES,
  PRINT_KIT_PAPERS,
  defaultPrintKitPaper,
  isPrintKitLanguageChoice,
} from './portal-print-kit'

describe('printKitLanguageChoices', () => {
  it('accepts only the offered choices', () => {
    const locales = ['en', 'bg', 'es'] as const
    expect(isPrintKitLanguageChoice(locales, ['en', 'bg'])).toBe(true)
    expect(isPrintKitLanguageChoice(locales, ['bg'])).toBe(true)
    expect(isPrintKitLanguageChoice(locales, ['bg', 'es'])).toBe(true)
    expect(isPrintKitLanguageChoice(locales, ['en', 'en'])).toBe(false)
    expect(isPrintKitLanguageChoice(locales, ['fr'])).toBe(false)
    expect(isPrintKitLanguageChoice(locales, [])).toBe(false)
    expect(isPrintKitLanguageChoice(locales, ['en', 'bg', 'es'])).toBe(false)
  })
})
describe('the papers', () => {
  it('has two papers, Letter first', () => {
    expect(PRINT_KIT_PAPERS).toEqual(['letter', 'a4'])
  })
})

describe('defaultPrintKitPaper', () => {
  it.each(['US', 'CA', 'MX', 'PH'])('prints %s on Letter', (country) => {
    expect(defaultPrintKitPaper(country)).toBe('letter')
  })

  it.each(['GB', 'DE', 'BG', 'JP', 'AU'])('prints %s on A4', (country) => {
    expect(defaultPrintKitPaper(country)).toBe('a4')
  })

  it('prints on Letter when the country is unknown', () => {
    expect(defaultPrintKitPaper(null)).toBe('letter')
    expect(defaultPrintKitPaper('')).toBe('letter')
  })

  it('reads a code however it was typed', () => {
    expect(defaultPrintKitPaper(' us ')).toBe('letter')
    expect(defaultPrintKitPaper('gb')).toBe('a4')
  })

  it('knows every Letter country CLDR lists, each as two capitals', () => {
    expect(PRINT_KIT_LETTER_COUNTRIES).toHaveLength(14)
    for (const country of PRINT_KIT_LETTER_COUNTRIES) {
      expect(country).toMatch(/^[A-Z]{2}$/u)
      expect(defaultPrintKitPaper(country)).toBe('letter')
    }
  })
})
