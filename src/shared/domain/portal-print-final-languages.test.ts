import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES, type GuestLocale } from './guest-locale'
import {
  PRINT_FINAL_CALLS_TO_ACTION,
  PRINT_FINAL_COPY,
  PRINT_FINAL_DEFAULT_CALL_TO_ACTION,
  printFinalCopyStatus,
  printFinalHeldLanguage,
  type PrintFinalCallToAction,
} from './portal-print-final-copy'
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
  it('reads each wording as the print says it, in menu order, with no word about privacy', () => {
    expect(Object.entries(PRINT_FINAL_CALL_TO_ACTION_LABELS)).toEqual([
      ['how_did_we_do', 'How did we do? · About 30 seconds'],
      ['how_was_visit', 'How was your visit? · About 30 seconds'],
      ['how_was_stay', 'How was your stay? · Share your experience'],
      ['rate_visit', 'Rate your visit · About 30 seconds'],
      ['got_30_seconds', 'Got 30 seconds? · Tell us how it went'],
    ])
  })
})

describe('PRINT_FINAL_COPY (spec 5.5)', () => {
  const say = (locale: GuestLocale, callToAction: PrintFinalCallToAction) => {
    const { headline, subline } = PRINT_FINAL_COPY[locale][callToAction]
    return `${headline} / ${subline}`
  }

  it('says "How did we do?" over "About 30 seconds" by default, in every language', () => {
    expect(PRINT_FINAL_DEFAULT_CALL_TO_ACTION).toBe('how_did_we_do')
    expect(GUEST_LOCALES.map((locale) => [locale, say(locale, 'how_did_we_do')])).toEqual(
      [
        ['en', 'How did we do? / About 30 seconds'],
        ['es', '¿Cómo lo hicimos? / Unos 30 segundos'],
        ['it', 'Come siamo andati? / Circa 30 secondi'],
        ['fr', 'Votre avis sur nous\u00a0? / Environ 30 secondes'],
        ['de', 'Wie war es bei uns? / Etwa 30 Sekunden'],
        ['bg', 'Как беше при нас? / Около 30 секунди'],
      ],
    )
  })

  it('says the other four wordings as the spec’s table does', () => {
    const headlines = (callToAction: PrintFinalCallToAction) =>
      GUEST_LOCALES.map((locale) => PRINT_FINAL_COPY[locale][callToAction].headline)
    expect(headlines('how_was_visit')).toEqual([
      'How was your visit?',
      '¿Qué tal su visita?',
      'Com’è andata la sua visita?',
      'Comment était votre visite\u00a0?',
      'Wie war Ihr Besuch?',
      'Как мина посещението ви?',
    ])
    expect(headlines('how_was_stay')).toEqual([
      'How was your stay?',
      '¿Qué tal su estancia?',
      'Com’è stato il suo soggiorno?',
      'Comment était votre séjour\u00a0?',
      'Wie war Ihr Aufenthalt?',
      'Как мина престоят ви?',
    ])
    expect(
      GUEST_LOCALES.map((locale) => PRINT_FINAL_COPY[locale].how_was_stay.subline),
    ).toEqual([
      'Share your experience',
      'Comparta su experiencia',
      'Condivida la sua esperienza',
      'Partagez votre expérience',
      'Teilen Sie Ihre Erfahrung',
      'Споделете впечатленията си',
    ])
    expect(headlines('rate_visit')).toEqual([
      'Rate your visit',
      'Valore su visita',
      'Valuti la sua visita',
      'Évaluez votre visite',
      'Bewerten Sie Ihren Besuch',
      'Оценете посещението си',
    ])
    expect(GUEST_LOCALES.map((locale) => say(locale, 'got_30_seconds'))).toEqual([
      'Got 30 seconds? / Tell us how it went',
      '¿Tiene 30 segundos? / Cuéntenos qué tal le fue',
      'Ha 30 secondi? / Ci dica com’è andata',
      'Vous avez 30 secondes\u00a0? / Dites-nous comment c’était',
      'Haben Sie 30 Sekunden? / Sagen Sie uns, wie es war',
      'Имате ли 30 секунди? / Кажете ни как мина',
    ])
    for (const locale of GUEST_LOCALES) {
      expect(PRINT_FINAL_COPY[locale].how_was_visit.subline).toBe(
        PRINT_FINAL_COPY[locale].how_did_we_do.subline,
      )
      expect(PRINT_FINAL_COPY[locale].rate_visit.subline).toBe(
        PRINT_FINAL_COPY[locale].how_did_we_do.subline,
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
      expect(headline).not.toMatch(/ \?/u)
      if (headline.endsWith('?')) expect(headline).toMatch(/\u00a0\?$/u)
    }
  })

  it('has a headline and a sub-line for every language and wording', () => {
    for (const locale of GUEST_LOCALES) {
      for (const callToAction of PRINT_FINAL_CALLS_TO_ACTION) {
        const copy = PRINT_FINAL_COPY[locale][callToAction]
        expect(copy.headline.trim()).not.toBe('')
        expect(copy.subline.trim()).not.toBe('')
      }
    }
  })
})

describe('the copy rule F holds back (spec 5.5, the ‡ drafts)', () => {
  it('holds French "How was your visit?" and "Got 30 seconds?" and German "Got 30 seconds?", and nothing else', () => {
    const held = GUEST_LOCALES.flatMap((locale) =>
      PRINT_FINAL_CALLS_TO_ACTION.filter(
        (callToAction) => printFinalCopyStatus(locale, callToAction) === 'held',
      ).map((callToAction) => `${locale} ${callToAction}`),
    )
    expect(held).toEqual(['fr how_was_visit', 'fr got_30_seconds', 'de got_30_seconds'])
  })

  it('marks English checked and every other language a draft', () => {
    expect(printFinalCopyStatus('en', 'got_30_seconds')).toBe('checked')
    expect(printFinalCopyStatus('es', 'how_did_we_do')).toBe('draft')
  })

  it('names the first language on the print that holds a wording back', () => {
    expect(printFinalHeldLanguage('got_30_seconds', ['en', 'de'])).toBe('de')
    expect(printFinalHeldLanguage('got_30_seconds', ['en', 'es'])).toBeNull()
    expect(printFinalHeldLanguage('how_did_we_do', ['fr', 'de'])).toBeNull()
  })
})

describe('printFinalBlocks', () => {
  it('says the page’s title and the call to action in each language, the first leading', () => {
    expect(
      printFinalBlocks(
        ['en', 'es'],
        { preset: 'how_did_we_do' },
        { en: 'Reception' },
        'Front desk',
      ),
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

  it('prints the manager’s own words where they wrote them, normalised, and the wording elsewhere', () => {
    const blocks = printFinalBlocks(
      ['en', 'es'],
      {
        preset: 'rate_visit',
        custom: { en: { headline: '  Thanks for   staying\nwith us ', subline: '' } },
      },
      {},
      'Reception',
    )
    expect(blocks.map(({ headline, subline }) => [headline, subline])).toEqual([
      ['Thanks for staying with us', ''],
      ['Valore su visita', 'Unos 30 segundos'],
    ])
  })
})
