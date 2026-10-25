import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES, type GuestLocale } from './guest-locale'
import { PRINT_FINAL_COPY } from './portal-print-final-copy'
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
  it('reads each call to action as the print says it, with no word about privacy', () => {
    expect(PRINT_FINAL_CALL_TO_ACTION_LABELS).toEqual({
      rate: 'How did we do? · About 30 seconds',
      tell: 'How was your visit? · About 30 seconds',
    })
  })
})

describe('PRINT_FINAL_COPY (spec 5.5)', () => {
  it('says "How did we do?" over "About 30 seconds" by default, in every language', () => {
    const say = (locale: GuestLocale) => {
      const { headline, subline } = PRINT_FINAL_COPY[locale].rate
      return `${headline} / ${subline}`
    }
    expect(GUEST_LOCALES.map((locale) => [locale, say(locale)])).toEqual([
      ['en', 'How did we do? / About 30 seconds'],
      ['es', '¿Cómo lo hicimos? / Unos 30 segundos'],
      ['it', 'Come siamo andati? / Circa 30 secondi'],
      ['fr', 'Votre avis sur nous\u00a0? / Environ 30 secondes'],
      ['de', 'Wie war es bei uns? / Etwa 30 Sekunden'],
      ['bg', 'Как беше при нас? / Около 30 секунди'],
    ])
  })

  it('keeps "How was your visit?" as the second wording, with the same sub-line', () => {
    expect(
      GUEST_LOCALES.map((locale) => [locale, PRINT_FINAL_COPY[locale].tell.headline]),
    ).toEqual([
      ['en', 'How was your visit?'],
      ['es', '¿Qué tal su visita?'],
      ['it', 'Com’è andata la sua visita?'],
      ['fr', 'Comment était votre visite\u00a0?'],
      ['de', 'Wie war Ihr Besuch?'],
      ['bg', 'Как мина посещението ви?'],
    ])
    for (const locale of GUEST_LOCALES) {
      expect(PRINT_FINAL_COPY[locale].tell.subline).toBe(
        PRINT_FINAL_COPY[locale].rate.subline,
      )
    }
  })

  it('never says "private" or "privately", in any language (rule NP)', () => {
    const words = GUEST_LOCALES.flatMap((locale) =>
      Object.values(PRINT_FINAL_COPY[locale]).flatMap((copy) => [
        copy.headline,
        copy.subline,
      ]),
    )
    for (const word of [...words, ...Object.values(PRINT_FINAL_CALL_TO_ACTION_LABELS)]) {
      expect(word).not.toMatch(/priv|vertraul|поверит|в частно/i)
    }
  })

  it('takes a no-break space before a French question mark, so no line starts with it', () => {
    for (const { headline } of Object.values(PRINT_FINAL_COPY.fr)) {
      expect(headline).toMatch(/\u00a0\?$/u)
      expect(headline).not.toMatch(/ \?/u)
    }
  })

  it('has a headline and a sub-line for every language and preset', () => {
    for (const locale of GUEST_LOCALES) {
      for (const copy of Object.values(PRINT_FINAL_COPY[locale])) {
        expect(copy.headline.trim()).not.toBe('')
        expect(copy.subline.trim()).not.toBe('')
      }
    }
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
        headline: 'How did we do?',
        subline: 'About 30 seconds',
      },
      {
        locale: 'es',
        kicker: 'Front desk',
        headline: '¿Cómo lo hicimos?',
        subline: 'Unos 30 segundos',
      },
    ])
  })
})
