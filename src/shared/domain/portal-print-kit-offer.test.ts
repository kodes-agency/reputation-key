import { describe, expect, it } from 'vitest'
import {
  PRINT_KIT_OUTPUTS,
  PRINT_KIT_PAPERS,
  PRINT_KIT_PIECES,
  PRINT_KIT_SIZES,
  PRINT_KIT_STYLES,
} from './portal-print-kit'
import { printKitFormatProblem } from './portal-print-kit-formats'
import {
  PRINT_KIT_NAME_HINT,
  defaultPrintKitSize,
  printKitLanguageChoicesOf,
  printKitOutputLabel,
  printKitOutputsOf,
  printKitPieceCardFacts,
  printKitPiecesOf,
  printKitSizeNote,
  printKitSizeTitle,
  printKitSizedPaperNote,
  printKitTileText,
  printKitTrimText,
  settlePrintKitFormat,
} from './portal-print-kit-offer'

/** The words as they read: a no-break space is a space to the eye. */
const plain = (text: string): string => text.replaceAll('\u00A0', ' ')

describe('the sizes’ names', () => {
  it.each([
    ['large', 'letter', 'Large · 4 × 6 in'],
    ['large', 'a4', 'Large · A6'],
    ['table', 'letter', 'Table · 3.5 × 5 in'],
    ['table', 'a4', 'Table · 90 × 130 mm'],
    ['mini', 'letter', 'Mini · 2 × 3.5 in'],
    ['mini', 'a4', 'Mini · 55 × 85 mm'],
  ] as const)('titles %s on %s as "%s"', (size, paper, title) => {
    expect(plain(printKitSizeTitle(size, paper))).toBe(title)
  })

  it('says the code tile in the unit the paper is cut in', () => {
    expect(
      PRINT_KIT_SIZES.map((size) => plain(printKitTileText(size, 'letter'))),
    ).toEqual(['1.75 in', '1.4 in', '1.25 in'])
    expect(PRINT_KIT_SIZES.map((size) => plain(printKitTileText(size, 'a4')))).toEqual([
      '44 mm',
      '36 mm',
      '32 mm',
    ])
  })

  it('tells the manager the code shrinks with the size, as the board does', () => {
    expect(plain(printKitSizeNote('letter'))).toBe(
      'The code shrinks with the size: 1.75 in on Large, 1.4 in on Table, 1.25 in on Mini.',
    )
    expect(plain(printKitSizeNote('a4'))).toContain('36 mm on Table')
  })

  it('names a size’s trim on every paper', () => {
    for (const size of PRINT_KIT_SIZES) {
      for (const paper of PRINT_KIT_PAPERS) {
        expect(printKitTrimText(size, paper)).not.toBe('')
      }
    }
  })
})

describe('defaultPrintKitSize', () => {
  it('is Table once it is offered, and the first offered size until then', () => {
    expect(defaultPrintKitSize(['large', 'table', 'mini'])).toBe('table')
    expect(defaultPrintKitSize(['large', 'mini'])).toBe('large')
    expect(defaultPrintKitSize(['mini'])).toBe('mini')
    expect(defaultPrintKitSize([])).toBe('large')
  })
})

describe('the pieces and outputs a size offers', () => {
  it('offers a card and a tent at Large and Table, and a card alone at Mini', () => {
    expect(printKitPiecesOf('large')).toEqual(['counter_card', 'table_tent'])
    expect(printKitPiecesOf('table')).toEqual(['counter_card', 'table_tent'])
    expect(printKitPiecesOf('mini')).toEqual(['counter_card'])
  })

  it.each([
    ['immersive', 'counter_card', 'large', ['print_shop', 'office']],
    ['immersive', 'counter_card', 'table', ['print_shop', 'office']],
    ['immersive', 'counter_card', 'mini', ['print_shop']],
    ['immersive', 'table_tent', 'large', ['print_shop']],
    ['immersive', 'table_tent', 'table', ['print_shop']],
    ['paper', 'counter_card', 'large', ['office']],
    ['paper', 'counter_card', 'table', ['office']],
    ['paper', 'counter_card', 'mini', ['office']],
    ['paper', 'table_tent', 'table', ['office']],
  ] as const)('offers %s %s at %s the outputs %j', (style, piece, size, outputs) => {
    expect(printKitOutputsOf({ style, piece, size })).toEqual(outputs)
  })

  it('offers only what the kit makes: every offer passes printKitFormatProblem', () => {
    for (const style of PRINT_KIT_STYLES) {
      for (const size of PRINT_KIT_SIZES) {
        for (const piece of printKitPiecesOf(size)) {
          const offered = printKitOutputsOf({ style, piece, size })
          expect(offered.length, `${style} ${piece} ${size}`).toBeGreaterThan(0)
          for (const output of PRINT_KIT_OUTPUTS) {
            const problem = printKitFormatProblem({
              style,
              piece,
              size,
              output,
              languageCount: 1,
            })
            expect(offered.includes(output)).toBe(problem === null)
          }
        }
      }
    }
  })

  it('offers no piece the kit refuses to make', () => {
    for (const size of PRINT_KIT_SIZES) {
      const offered = printKitPiecesOf(size)
      for (const piece of PRINT_KIT_PIECES) {
        const makes = PRINT_KIT_STYLES.some(
          (style) => printKitOutputsOf({ style, piece, size }).length > 0,
        )
        expect(offered.includes(piece)).toBe(makes)
      }
    }
  })
})

describe('printKitOutputLabel', () => {
  it('counts the cards on an Immersive office sheet, as the board does', () => {
    const table = { style: 'immersive', piece: 'counter_card', size: 'table' } as const
    expect(printKitOutputLabel('print_shop', table)).toBe(
      'For a print shop · 1 card per page with bleed',
    )
    expect(printKitOutputLabel('office', table)).toBe(
      'For my printer · 4 cards per sheet',
    )
    expect(printKitOutputLabel('office', { ...table, size: 'large' })).toBe(
      'For my printer · 2 cards per sheet',
    )
  })

  it('calls a tent a tent', () => {
    expect(
      printKitOutputLabel('print_shop', {
        style: 'immersive',
        piece: 'table_tent',
        size: 'table',
      }),
    ).toBe('For a print shop · 1 tent per page with bleed')
  })
})

describe('printKitLanguageChoicesOf', () => {
  const choices = [['en', 'bg'], ['en'], ['bg']] as const

  it('keeps every choice at Large and Table', () => {
    expect(printKitLanguageChoicesOf(choices, 'large')).toEqual(choices)
    expect(printKitLanguageChoicesOf(choices, 'table')).toEqual(choices)
  })

  it('offers a Mini card each language alone, since it prints one', () => {
    expect(printKitLanguageChoicesOf(choices, 'mini')).toEqual([['en'], ['bg']])
  })
})

describe('settlePrintKitFormat', () => {
  const base = {
    style: 'paper',
    size: 'large',
    piece: 'counter_card',
    output: 'office',
    languages: ['en', 'bg'],
  } as const
  const all = ['large', 'table', 'mini'] as const

  it('returns the very same choice when nothing needs to change', () => {
    expect(settlePrintKitFormat(base, all)).toBe(base)
  })

  it('falls back to the default size when the size is not offered', () => {
    expect(settlePrintKitFormat({ ...base, size: 'mini' }, ['large']).size).toBe('large')
    expect(settlePrintKitFormat(base, ['table', 'mini']).size).toBe('table')
  })

  it('turns a tent at Mini into a card, because Mini has no tent', () => {
    const settled = settlePrintKitFormat(
      { ...base, size: 'mini', piece: 'table_tent', languages: ['en'] },
      all,
    )
    expect(settled.piece).toBe('counter_card')
  })

  it('gives an output the print cannot take its style’s own', () => {
    expect(
      settlePrintKitFormat(
        { ...base, style: 'immersive', size: 'mini', output: 'office' },
        all,
      ).output,
    ).toBe('print_shop')
    expect(settlePrintKitFormat({ ...base, output: 'print_shop' }, all).output).toBe(
      'office',
    )
  })

  it('keeps an output the style offers', () => {
    const chosen = { ...base, style: 'immersive', output: 'office' } as const
    expect(settlePrintKitFormat(chosen, all)).toBe(chosen)
  })

  it('drops a Mini card’s second language, keeping the larger one', () => {
    expect(settlePrintKitFormat({ ...base, size: 'mini' }, all).languages).toEqual(['en'])
  })

  it('always settles on a print the kit makes', () => {
    for (const style of PRINT_KIT_STYLES) {
      for (const size of PRINT_KIT_SIZES) {
        for (const piece of PRINT_KIT_PIECES) {
          for (const output of PRINT_KIT_OUTPUTS) {
            const settled = settlePrintKitFormat(
              { style, size, piece, output, languages: ['en', 'bg'] as const },
              all,
            )
            expect(
              printKitFormatProblem({
                ...settled,
                languageCount: settled.languages.length,
              }),
              `${style} ${size} ${piece} ${output}`,
            ).toBeNull()
          }
        }
      }
    }
  })
})

describe('printKitSizedPaperNote', () => {
  it('leaves Large to the notes it has always had', () => {
    expect(printKitSizedPaperNote('counter_card', 'large')).toBeNull()
    expect(printKitSizedPaperNote('table_tent', 'large')).toBeNull()
  })

  it('says what each paper makes of the smaller sizes', () => {
    expect(plain(printKitSizedPaperNote('counter_card', 'table') ?? '')).toBe(
      'Letter makes 3.5 × 5 in Table cards. A4 makes 90 × 130 mm cards.',
    )
    expect(plain(printKitSizedPaperNote('counter_card', 'mini') ?? '')).toBe(
      'Letter makes 2 × 3.5 in Mini cards. A4 makes 55 × 85 mm cards.',
    )
    expect(plain(printKitSizedPaperNote('table_tent', 'table') ?? '')).toBe(
      'Letter makes 5 × 3.5 in tent faces. A4 makes 130 × 90 mm faces.',
    )
  })
})

describe('the name hint', () => {
  it('says where the name is printed, as D12 words it', () => {
    expect(PRINT_KIT_NAME_HINT).toBe(
      'Large and Table cards. The tent and Mini show the logo alone.',
    )
  })
})

describe('printKitPieceCardFacts', () => {
  it('keeps the Large card and the Letter-half tent as they have always read', () => {
    const large = printKitPieceCardFacts('paper', 'counter_card', 'letter', 'large')
    expect(large.label).toBe('Counter card')
    expect(plain(large.detail)).toBe('4 × 6 in · 2 on a Letter sheet')
  })

  it('names a Table card for its holder, and the small tent for its faces, as the board does', () => {
    const card = printKitPieceCardFacts('immersive', 'counter_card', 'letter', 'table')
    expect(card.label).toBe('Card')
    expect(plain(card.detail)).toBe('3.5 × 5 in, for a holder')
    const tent = printKitPieceCardFacts('immersive', 'table_tent', 'letter', 'table')
    expect(tent.label).toBe('Table tent')
    expect(plain(tent.detail)).toBe('Stands on its own, 5 × 3.5 in faces')
  })

  it('reads the A4 trims in millimetres', () => {
    expect(
      plain(printKitPieceCardFacts('paper', 'counter_card', 'a4', 'table').detail),
    ).toBe('90 × 130 mm, for a holder')
    expect(
      plain(printKitPieceCardFacts('paper', 'table_tent', 'a4', 'table').detail),
    ).toBe('Stands on its own, 130 × 90 mm faces')
    expect(
      plain(printKitPieceCardFacts('paper', 'counter_card', 'a4', 'mini').detail),
    ).toBe('55 × 85 mm, for key-card sleeves')
  })
})
