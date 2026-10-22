import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES } from './guest-locale'
import {
  PRINT_KIT_BLEED_MM,
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_COPY,
  PRINT_KIT_PIECES,
  isPrintKitLanguageChoice,
  printKitFaces,
  printKitFileName,
  printKitLanguageChoices,
  printKitSheets,
} from './portal-print-kit'

const TITLES = { en: 'Pool & Terrace', bg: 'Басейн и тераса' } as const

describe('print kit copy', () => {
  it('has a call to action and a line under it for every language', () => {
    for (const locale of GUEST_LOCALES) {
      for (const callToAction of PRINT_KIT_CALLS_TO_ACTION) {
        const copy = PRINT_KIT_COPY[locale][callToAction]
        expect(copy.headline.length).toBeGreaterThan(0)
        expect(copy.subline.length).toBeGreaterThan(0)
      }
    }
  })

  it('is industry-neutral: it says visit and never stay', () => {
    const everything = GUEST_LOCALES.flatMap((locale) =>
      PRINT_KIT_CALLS_TO_ACTION.flatMap((callToAction) => {
        const copy = PRINT_KIT_COPY[locale][callToAction]
        return [copy.headline, copy.subline]
      }),
    ).join(' ')
    expect(everything).not.toMatch(/\bstay\b|estancia|séjour|Aufenthalt|престоя/iu)
    expect(PRINT_KIT_COPY.en.rate.headline).toBe('Rate your visit')
    expect(PRINT_KIT_COPY.en.rate.subline).toBe('Private, about 30 seconds')
  })
})

describe('printKitLanguageChoices', () => {
  it('offers the primary language with each other one, then each language alone', () => {
    expect(printKitLanguageChoices(['en', 'bg'])).toEqual([['en', 'bg'], ['en'], ['bg']])
  })

  it('offers a single language alone when the portal has one', () => {
    expect(printKitLanguageChoices(['de'])).toEqual([['de']])
  })

  it('pairs the primary with every other language of a larger set', () => {
    expect(printKitLanguageChoices(['en', 'es', 'fr'])).toEqual([
      ['en', 'es'],
      ['en', 'fr'],
      ['en'],
      ['es'],
      ['fr'],
    ])
  })

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

describe('printKitFaces', () => {
  it('puts the second language under the first on the front and swaps them on the back', () => {
    const faces = printKitFaces(
      { piece: 'table_tent', languages: ['en', 'bg'], callToAction: 'rate' },
      TITLES,
      'Pool',
    )
    expect(faces.map((face) => face.side)).toEqual(['front', 'back'])
    expect(faces[0]?.blocks.map((block) => block.locale)).toEqual(['en', 'bg'])
    expect(faces[1]?.blocks.map((block) => block.locale)).toEqual(['bg', 'en'])
    expect(faces[0]?.blocks[0]).toEqual({
      locale: 'en',
      kicker: 'Pool & Terrace',
      headline: 'Rate your visit',
      subline: 'Private, about 30 seconds',
    })
    expect(faces[0]?.blocks[1]?.kicker).toBe('Басейн и тераса')
  })

  it('shows one language on both panels of a table tent', () => {
    const faces = printKitFaces(
      { piece: 'table_tent', languages: ['bg'], callToAction: 'tell' },
      TITLES,
      'Pool',
    )
    expect(faces).toHaveLength(2)
    expect(faces.every((face) => face.blocks.length === 1)).toBe(true)
    expect(faces[1]?.blocks[0]?.headline).toBe('Как мина посещението ви?')
  })

  it('makes a one-sided counter card when there is one language', () => {
    const faces = printKitFaces(
      { piece: 'counter_card', languages: ['en'], callToAction: 'rate' },
      TITLES,
      'Pool',
    )
    expect(faces.map((face) => face.side)).toEqual(['front'])
  })

  it('makes a two-sided counter card when there are two languages', () => {
    const faces = printKitFaces(
      { piece: 'counter_card', languages: ['en', 'bg'], callToAction: 'rate' },
      TITLES,
      'Pool',
    )
    expect(faces.map((face) => face.side)).toEqual(['front', 'back'])
  })

  it('reads the portal name where a language has no title', () => {
    const faces = printKitFaces(
      { piece: 'counter_card', languages: ['de'], callToAction: 'rate' },
      TITLES,
      'Pool & Terrace',
    )
    expect(faces[0]?.blocks[0]?.kicker).toBe('Pool & Terrace')
  })
})

describe('printKitSheets', () => {
  it('lays a table tent out as one folded sheet of two A6 panels, the back upside down', () => {
    const [sheet, ...others] = printKitSheets('table_tent', 2)
    expect(others).toEqual([])
    expect(sheet).toEqual({
      trimWidthMm: 105,
      trimHeightMm: 296,
      panels: [
        { side: 'back', topMm: 0, rotated: true },
        { side: 'front', topMm: 148, rotated: false },
      ],
      foldAtMm: 148,
    })
  })

  it('gives a counter card one A6 page per face', () => {
    const sheets = printKitSheets('counter_card', 2)
    expect(sheets).toHaveLength(2)
    expect(sheets.map((sheet) => [sheet.trimWidthMm, sheet.trimHeightMm])).toEqual([
      [105, 148],
      [105, 148],
    ])
    expect(sheets.map((sheet) => sheet.panels[0]?.side)).toEqual(['front', 'back'])
    expect(sheets.every((sheet) => sheet.foldAtMm === null)).toBe(true)
  })

  it('gives a one-sided counter card one page', () => {
    expect(printKitSheets('counter_card', 1)).toHaveLength(1)
  })

  it('knows its pieces and the bleed', () => {
    expect(PRINT_KIT_PIECES).toEqual(['table_tent', 'counter_card'])
    expect(PRINT_KIT_BLEED_MM).toBe(3)
  })
})

describe('printKitFileName', () => {
  it('names the file after the portal, the piece and the languages', () => {
    expect(printKitFileName('Pool & Terrace', 'table_tent', ['en', 'bg'])).toBe(
      'pool-terrace-table-tent-en-bg.pdf',
    )
    expect(printKitFileName('!!!', 'counter_card', ['de'])).toBe(
      'portal-counter-card-de.pdf',
    )
  })

  it('says one language with one code', () => {
    expect(printKitFileName('Pool & Terrace', 'table_tent', ['en'])).toBe(
      'pool-terrace-table-tent-en.pdf',
    )
  })

  it('gives different choices for one portal different names', () => {
    const names = [
      printKitFileName('Pool & Terrace', 'table_tent', ['en', 'bg']),
      printKitFileName('Pool & Terrace', 'table_tent', ['en']),
      printKitFileName('Pool & Terrace', 'table_tent', ['bg', 'en']),
      printKitFileName('Pool & Terrace', 'counter_card', ['en', 'bg']),
    ]
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps the letters of any script, so a Cyrillic name is not lost', () => {
    expect(printKitFileName('Хотел Рила', 'table_tent', ['bg'])).toBe(
      'хотел-рила-table-tent-bg.pdf',
    )
    expect(printKitFileName('Café Müller', 'counter_card', ['en', 'de'])).toBe(
      'café-müller-counter-card-en-de.pdf',
    )
  })

  it('never lets a name break out of a file name', () => {
    expect(printKitFileName('../../etc/passwd', 'table_tent', ['en'])).toBe(
      'etc-passwd-table-tent-en.pdf',
    )
    expect(printKitFileName('a'.repeat(200), 'table_tent', ['en'])).toHaveLength(
      60 + '-table-tent-en.pdf'.length,
    )
  })
})
