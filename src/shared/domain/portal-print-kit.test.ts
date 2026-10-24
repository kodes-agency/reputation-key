import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES } from './guest-locale'
import {
  PRINT_KIT_CALLS_TO_ACTION,
  PRINT_KIT_COPY,
  PRINT_KIT_LETTER_COUNTRIES,
  PRINT_KIT_PAPERS,
  PRINT_KIT_PIECES,
  PRINT_KIT_SCAN_CUE,
  PRINT_KIT_SELECTABLE_SIZES,
  PRINT_KIT_SIZES,
  PRINT_KIT_STYLES,
  defaultPrintKitPaper,
  isPrintKitLanguageChoice,
  isSelectablePrintKitSize,
  printKitPieceNoun,
  printKitFaces,
  printKitFileName,
  printKitLanguageChoices,
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

describe('the pieces', () => {
  it('knows its pieces', () => {
    expect(PRINT_KIT_PIECES).toEqual(['table_tent', 'counter_card'])
  })
})

describe('the styles and the papers', () => {
  it('has two styles, Paper first, and two papers, Letter first', () => {
    expect(PRINT_KIT_STYLES).toEqual(['paper', 'immersive'])
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

describe('PRINT_KIT_SCAN_CUE', () => {
  it('has a cue for every guest language', () => {
    expect(Object.keys(PRINT_KIT_SCAN_CUE).sort()).toEqual([...GUEST_LOCALES].sort())
    for (const locale of GUEST_LOCALES) {
      expect(PRINT_KIT_SCAN_CUE[locale].trim(), locale).not.toBe('')
    }
  })

  it('says it in the spec’s words', () => {
    expect(PRINT_KIT_SCAN_CUE.en).toBe('Scan with your camera')
    expect(PRINT_KIT_SCAN_CUE.bg).toBe('Сканирайте с камерата')
  })
})

const LETTER = { style: 'paper', paper: 'letter' } as const

describe('printKitFileName', () => {
  it('names the file after the portal, the piece, the languages and the paper', () => {
    expect(printKitFileName('Pool & Terrace', 'table_tent', ['en', 'bg'], LETTER)).toBe(
      'pool-terrace-table-tent-en-bg-letter.pdf',
    )
    expect(printKitFileName('!!!', 'counter_card', ['de'], LETTER)).toBe(
      'portal-counter-card-de-letter.pdf',
    )
  })

  it('says one language with one code', () => {
    expect(printKitFileName('Pool & Terrace', 'table_tent', ['en'], LETTER)).toBe(
      'pool-terrace-table-tent-en-letter.pdf',
    )
  })

  it('gives different choices for one portal different names', () => {
    const a4 = { style: 'paper', paper: 'a4' } as const
    const immersive = { style: 'immersive', paper: 'letter' } as const
    const names = [
      printKitFileName('Pool & Terrace', 'table_tent', ['en', 'bg'], LETTER),
      printKitFileName('Pool & Terrace', 'table_tent', ['en'], LETTER),
      printKitFileName('Pool & Terrace', 'table_tent', ['bg', 'en'], LETTER),
      printKitFileName('Pool & Terrace', 'counter_card', ['en', 'bg'], LETTER),
      printKitFileName('Pool & Terrace', 'table_tent', ['en', 'bg'], a4),
      printKitFileName('Pool & Terrace', 'table_tent', ['en', 'bg'], immersive),
    ]
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps the letters of any script, so a Cyrillic name is not lost', () => {
    expect(printKitFileName('Хотел Рила', 'table_tent', ['bg'], LETTER)).toBe(
      'хотел-рила-table-tent-bg-letter.pdf',
    )
    expect(printKitFileName('Café Müller', 'counter_card', ['en', 'de'], LETTER)).toBe(
      'café-müller-counter-card-en-de-letter.pdf',
    )
  })

  it('ends a print with its paper, and names Immersive before it', () => {
    expect(printKitFileName('Pool & Terrace', 'counter_card', ['en', 'es'], LETTER)).toBe(
      'pool-terrace-counter-card-en-es-letter.pdf',
    )
    expect(
      printKitFileName('Pool & Terrace', 'table_tent', ['en'], {
        style: 'paper',
        paper: 'a4',
      }),
    ).toBe('pool-terrace-table-tent-en-a4.pdf')
    expect(
      printKitFileName('Pool & Terrace', 'counter_card', ['en', 'es'], {
        style: 'immersive',
        paper: 'letter',
      }),
    ).toBe('pool-terrace-counter-card-en-es-immersive-letter.pdf')
  })

  it('never lets a name break out of a file name', () => {
    expect(printKitFileName('../../etc/passwd', 'table_tent', ['en'], LETTER)).toBe(
      'etc-passwd-table-tent-en-letter.pdf',
    )
    expect(printKitFileName('a'.repeat(200), 'table_tent', ['en'], LETTER)).toHaveLength(
      60 + '-table-tent-en-letter.pdf'.length,
    )
  })
})

describe('the sizes', () => {
  it('are Large, Table and Mini, Large first', () => {
    expect(PRINT_KIT_SIZES).toEqual(['large', 'table', 'mini'])
  })

  it('offer only Large until the short print address and the phone tests allow the rest', () => {
    expect(PRINT_KIT_SELECTABLE_SIZES).toEqual(['large'])
    expect(isSelectablePrintKitSize('large')).toBe(true)
    expect(isSelectablePrintKitSize('table')).toBe(false)
    expect(isSelectablePrintKitSize('mini')).toBe(false)
  })

  it('only ever offer a size the vocabulary has', () => {
    for (const size of PRINT_KIT_SELECTABLE_SIZES) {
      expect(PRINT_KIT_SIZES).toContain(size)
    }
  })
})

describe('printKitFileName at a size and output', () => {
  it('names the smaller cards for their size and an office sheet for how many it holds', () => {
    const name = (format: Parameters<typeof printKitFileName>[3]) =>
      printKitFileName('Oakmere Reception', 'counter_card', ['en'], format)
    expect(
      name({ style: 'immersive', paper: 'letter', size: 'table', output: 'office' }),
    ).toBe('oakmere-reception-table-card-en-immersive-4up-letter.pdf')
    expect(name({ style: 'paper', paper: 'a4', size: 'mini', output: 'office' })).toBe(
      'oakmere-reception-mini-card-en-10up-a4.pdf',
    )
    expect(
      name({ style: 'immersive', paper: 'letter', size: 'table', output: 'print_shop' }),
    ).toBe('oakmere-reception-table-card-en-immersive-letter.pdf')
    expect(
      name({ style: 'immersive', paper: 'letter', size: 'large', output: 'office' }),
    ).toBe('oakmere-reception-counter-card-en-immersive-2up-letter.pdf')
  })

  it('keeps the Large Paper sheets’ and the print-shop files’ names as they shipped', () => {
    expect(
      printKitFileName('Oakmere', 'counter_card', ['en'], {
        style: 'paper',
        paper: 'letter',
        size: 'large',
      }),
    ).toBe('oakmere-counter-card-en-letter.pdf')
    expect(
      printKitFileName('Oakmere', 'counter_card', ['en'], {
        style: 'immersive',
        paper: 'a4',
      }),
    ).toBe('oakmere-counter-card-en-immersive-a4.pdf')
  })

  it('calls the smaller cards by their size, and the Large card and the tent as before', () => {
    expect(printKitPieceNoun('counter_card', 'table')).toBe('table card')
    expect(printKitPieceNoun('counter_card', 'mini')).toBe('mini card')
    expect(printKitPieceNoun('counter_card', 'large')).toBe('counter card')
    expect(printKitPieceNoun('table_tent', 'large')).toBe('table tent')
  })
})
