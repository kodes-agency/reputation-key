import { describe, expect, it } from 'vitest'
import {
  normalisePrintText,
  printCopyOf,
  printIsOwnCopy,
  printOwnWordsToSend,
  printWordsHeldLanguage,
  tidyPrintTyping,
} from './portal-print-custom'

describe('the own words as typed (spec 5.6)', () => {
  it('turns line breaks into spaces, closes up runs of spaces and drops a leading one, leaving the end to type on', () => {
    expect(tidyPrintTyping('  How was\n\nyour   stay ')).toBe('How was your stay ')
    expect(normalisePrintText('  How was\r\nyour   stay ')).toBe('How was your stay')
  })

  it('keeps typographic quotes and apostrophes as typed', () => {
    expect(normalisePrintText('Com’è andata? “Bene”')).toBe('Com’è andata? “Bene”')
  })
})
describe('the words a print resolves to', () => {
  it('reads a language without own words from the wording', () => {
    expect(printCopyOf({ preset: 'got_30_seconds' }, 'en')).toEqual({
      headline: 'Got 30 seconds?',
      subline: 'Tell us how it went',
    })
  })

  it('counts words as the manager’s own only when they differ from the wording', () => {
    const prefilled = {
      preset: 'how_did_we_do' as const,
      custom: { en: { headline: 'How did we do? ', subline: 'About 30 seconds' } },
    }
    expect(printIsOwnCopy(prefilled, 'en')).toBe(false)
    expect(
      printIsOwnCopy(
        { ...prefilled, custom: { en: { headline: 'How was today?', subline: '' } } },
        'en',
      ),
    ).toBe(true)
  })

  it('sends the own words normalised, only for the print’s languages that changed, and nothing without them', () => {
    expect(
      printOwnWordsToSend(
        {
          preset: 'how_did_we_do',
          custom: {
            en: { headline: ' How was today? ', subline: '' },
            de: { headline: 'Wie war es?', subline: '' },
            es: { headline: '¿Cómo lo hicimos?', subline: 'Unos 30 segundos' },
          },
        },
        ['en', 'es'],
      ),
    ).toEqual({ en: { headline: 'How was today?', subline: '' } })
    expect(printOwnWordsToSend({ preset: 'how_did_we_do' }, ['en'])).toBeNull()
  })

  it('holds a wording back only where a language would print its held copy', () => {
    expect(printWordsHeldLanguage({ preset: 'got_30_seconds' }, ['en', 'de'])).toBe('de')
    expect(
      printWordsHeldLanguage(
        {
          preset: 'got_30_seconds',
          custom: { de: { headline: 'Wie war es?', subline: '' } },
        },
        ['en', 'de'],
      ),
    ).toBeNull()
  })
})
