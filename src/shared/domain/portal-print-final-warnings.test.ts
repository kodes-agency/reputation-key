import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES } from './guest-locale'
import { PRINT_FINAL_CALLS_TO_ACTION, PRINT_FINAL_COPY } from './portal-print-final-copy'
import {
  printFinalTextWarning,
  printFinalWordsOffer,
  printFinalWordsWarning,
} from './portal-print-final-warnings'

const say = (
  text: string,
  locale: Parameters<typeof printFinalTextWarning>[1] = 'en',
) => {
  const warning = printFinalTextWarning(text, locale)
  return warning === null ? null : `${warning.kind} ${warning.topic} ${warning.word}`
}

describe('the warning list (spec 5.8)', () => {
  it('blocks only clear offers', () => {
    expect(say('Get 10% off')).toBe('block offer 10 % off')
    expect(say('Free dessert with your review')).toBe('block offer Free dessert')
    expect(say('Review us for a coupon')).toBe('block offer coupon')
    expect(say('A chance to win a night')).toBe('block offer chance to win')
    expect(say('Opina y llévate un postre gratis', 'es')).toBe(
      'block offer postre gratis',
    )
    expect(say('20 % de remise', 'fr')).toBe('block offer 20 % de remise')
  })

  it('only asks about a lone "free", "gift" or "win", and lets the print go', () => {
    expect(say('Feel free to say how we did')).toBe('warn offer_word free')
    expect(say('It was a win-win')).toBe('warn offer_word win')
  })

  it('warns on mood, pressure and privacy words, and notes a time', () => {
    expect(say('Loved your stay? Review us!')).toBe('warn mood Loved')
    expect(say('Before you leave, how did we do?')).toBe('warn pressure Before you leave')
    expect(say('Tell us privately how we did')).toBe('warn privacy privately')
    expect(say('Wie war es? Bewerten Sie uns vertraulich', 'de')).toBe(
      'warn privacy vertraulich',
    )
    expect(say('Takes 20 seconds')).toBe('time time 20 seconds')
  })

  it('folds case and accents, and reads apostrophes either way', () => {
    expect(say('N’oubliez pas de noter', 'fr')).toBe("warn pressure N'oubliez pas")
    expect(say('Una reseña anónima', 'es')).toBe('warn privacy anónima')
  })

  it('finds no offer, mood, pressure or privacy word in any wording or sub-line, in any language', () => {
    for (const locale of GUEST_LOCALES) {
      for (const preset of PRINT_FINAL_CALLS_TO_ACTION) {
        const { headline, subline } = PRINT_FINAL_COPY[locale][preset]
        // Only the time the wordings promise is noted, and a wording as it stands raises nothing (below).
        for (const text of [headline, subline]) {
          expect(
            printFinalTextWarning(text, locale)?.kind ?? 'time',
            `${locale} ${text}`,
          ).toBe('time')
        }
      }
    }
  })
})

describe('printFinalWordsWarning', () => {
  it('says nothing about fields still holding the wording, the time note included', () => {
    expect(
      printFinalWordsWarning(
        {
          preset: 'how_did_we_do',
          custom: { en: { headline: 'How did we do?', subline: 'About 30 seconds' } },
        },
        'en',
      ),
    ).toBeNull()
    expect(
      printFinalWordsWarning(
        {
          preset: 'how_did_we_do',
          custom: { en: { headline: 'How was today?', subline: 'About 30 seconds' } },
        },
        'en',
      ),
    ).toBeNull()
  })

  it('blocks a print whose own words offer something, in any of its languages', () => {
    const words = {
      preset: 'how_did_we_do' as const,
      custom: { es: { headline: '¿Qué tal?', subline: 'Un 10 % de descuento' } },
    }
    expect(printFinalWordsOffer(words, ['en', 'es'])).toBe(true)
    expect(printFinalWordsOffer({ preset: 'how_did_we_do' }, ['en', 'es'])).toBe(false)
  })
})
