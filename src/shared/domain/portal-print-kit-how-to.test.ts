import { describe, expect, it } from 'vitest'
import {
  PRINT_KIT_PAPERS,
  PRINT_KIT_SIZES,
  PRINT_KIT_STYLES,
  type PrintKitPiece,
  type PrintKitSize,
} from './portal-print-kit'
import {
  printKitHowToSteps,
  printKitHowToTitle,
  type PrintKitHowToQuery,
} from './portal-print-kit-how-to'
import { printKitOutputsOf, printKitPiecesOf } from './portal-print-kit-offer'
import { printKitHowToPrint } from './portal-print-kit-pieces'

const BAR = '1.4 in (3.6 cm)'

const query = (rest: Partial<PrintKitHowToQuery>): PrintKitHowToQuery => ({
  style: 'paper',
  piece: 'counter_card',
  size: 'table',
  output: 'office',
  paper: 'letter',
  languageCount: 2,
  bar: BAR,
  ...rest,
})

/** The words of a step as they read: a no-break space is a space to the eye. */
const words = (q: PrintKitHowToQuery): string[] =>
  printKitHowToSteps(q).map((step) => step.text.replaceAll('\u00A0', ' '))

describe('printKitHowToSteps', () => {
  it('gives the Large card the steps it has always had, with the bar its tile makes', () => {
    const large = query({ size: 'large', bar: '1.75 in (4.4 cm)' })
    expect(printKitHowToSteps(large)).toEqual(
      printKitHowToPrint('paper', 'counter_card', 'letter', 2, '1.75 in (4.4 cm)'),
    )
    expect(words(large)[1]).toBe(
      'Check the size: the coloured bar under each code measures 1.75 in (4.4 cm).',
    )
  })

  it('has a Paper Table card checked on its 1.4 in bar, double-sided, cut 3 down and 3 across', () => {
    expect(words(query({}))).toEqual([
      'Print at Actual size (100%). Never “Fit to page”.',
      'Check the size: the coloured bar under each code measures 1.4 in (3.6 cm).',
      'Two languages print double-sided: flip on the long edge.',
      'Use 65–110 lb cover card stock if your printer takes it, or plain paper in a 3.5 × 5 in holder.',
      'Cut on the grey ticks: 3 cuts down, 3 across.',
    ])
  })

  it('leaves the double-sided step out of a one-language Table card', () => {
    expect(words(query({ languageCount: 1 }))).toHaveLength(4)
  })

  it('gives an A4 Table card its stock in grams and its holder in millimetres', () => {
    const [, , , stock] = words(query({ paper: 'a4', bar: '36 mm (3.6 cm)' }))
    expect(stock).toBe(
      'Use 160–200 g/m² matte card if your printer takes it, or 120 g/m² paper in a 90 × 130 mm holder.',
    )
  })

  it('has a Paper Mini card cut from a Letter sheet, 3 cuts down and 6 across', () => {
    const steps = words(
      query({ size: 'mini', languageCount: 1, bar: '1.25 in (3.2 cm)' }),
    )
    expect(steps).toEqual([
      'Print at Actual size (100%). Never “Fit to page”.',
      'Check the size: the coloured bar under each code measures 1.25 in (3.2 cm).',
      'Use 65–110 lb cover card stock if your printer takes it, or 3.5 × 2 in business-card stock.',
      'Cut on the grey ticks: 3 cuts down, 6 across.',
    ])
  })

  it('has a Paper small tent cut, scored and folded, with its height', () => {
    const steps = words(query({ piece: 'table_tent' }))
    expect(steps).toEqual([
      'Print at Actual size (100%). Never “Fit to page”.',
      'Check the size: the coloured bar under each code measures 1.4 in (3.6 cm).',
      'Use 80–100 lb cover card stock.',
      'Cut on the grey ticks, then score and fold on the dashed line. Each tent stands about 3.4 in tall.',
    ])
    expect(words(query({ piece: 'table_tent', paper: 'a4' })).at(-1)).toContain('8.7 cm')
  })

  it('sends an Immersive print-shop file to the print shop whatever its size', () => {
    for (const size of PRINT_KIT_SIZES) {
      const steps = words(query({ style: 'immersive', output: 'print_shop', size }))
      expect(steps[0], size).toBe('Made for a print shop. Send the PDF as it is.')
      expect(steps.join(' '), size).not.toMatch(/ticks|Actual size/u)
    }
  })

  it('has an Immersive Table card for my printer, as the board has it', () => {
    expect(words(query({ style: 'immersive' }))).toEqual([
      'Print at Actual size (100%). Never “Fit to page”.',
      'Check the size: the coloured bar under each code measures 1.4 in (3.6 cm).',
      'Use 100–110 lb cover on the manual feed if your printer takes it. Dark colour prints deepest from a print shop.',
      'Cut on the crop marks: 3 cuts down, 3 across. The colour runs 1/8 in past the outer edge.',
    ])
  })

  it('has an Immersive Large card for my printer, on a landscape sheet of two', () => {
    const steps = words(
      query({ style: 'immersive', size: 'large', bar: '1.75 in (4.4 cm)' }),
    )
    expect(steps.at(-1)).toBe(
      'Cut on the crop marks: the colour runs 1/8 in past them, so no white edge shows.',
    )
    expect(steps[2]).toContain('100–110 lb cover')
  })

  it('gives an A4 Immersive office sheet its bleed in millimetres', () => {
    expect(words(query({ style: 'immersive', paper: 'a4' })).at(-1)).toContain('3 mm')
    expect(words(query({ style: 'immersive', paper: 'a4' }))[2]).toContain('270–300 g/m²')
  })

  it('has steps for every print the kit makes', () => {
    for (const style of PRINT_KIT_STYLES) {
      for (const size of PRINT_KIT_SIZES) {
        for (const piece of printKitPiecesOf(size)) {
          for (const output of printKitOutputsOf({ style, piece, size })) {
            for (const paper of PRINT_KIT_PAPERS) {
              const steps = printKitHowToSteps(
                query({ style, piece, size, output, paper }),
              )
              expect(
                steps.length,
                `${style} ${piece} ${size} ${output} ${paper}`,
              ).toBeGreaterThan(2)
            }
          }
        }
      }
    }
  })
})

describe('printKitHowToTitle', () => {
  const title = (
    style: 'paper' | 'immersive',
    piece: PrintKitPiece,
    size: PrintKitSize,
    output: 'office' | 'print_shop',
  ) => printKitHowToTitle({ style, piece, size, output })

  it('names the Large card and tent as before', () => {
    expect(title('paper', 'counter_card', 'large', 'office')).toBe('Paper counter card')
    expect(title('paper', 'table_tent', 'large', 'office')).toBe('Paper table tent')
  })

  it('names the smaller cards for their size', () => {
    expect(title('paper', 'counter_card', 'table', 'office')).toBe('Paper Table card')
    expect(title('paper', 'counter_card', 'mini', 'office')).toBe('Paper Mini card')
  })

  it('names an Immersive card’s output, as the board does', () => {
    expect(title('immersive', 'counter_card', 'table', 'office')).toBe(
      'Immersive Table card · my printer',
    )
    expect(title('immersive', 'counter_card', 'large', 'print_shop')).toBe(
      'Immersive counter card · print shop',
    )
  })

  it('names an Immersive tent without an output, since it has one', () => {
    expect(title('immersive', 'table_tent', 'table', 'print_shop')).toBe(
      'Immersive table tent',
    )
  })
})
