import { describe, expect, it } from 'vitest'
import { printKitHowToPrint } from './print-kit-how-to-print'

describe('printKitHowToPrint', () => {
  it('sends a table tent to a print shop, on scored card, and says how it folds', () => {
    expect(printKitHowToPrint({ piece: 'table_tent', languages: ['en', 'bg'] })).toEqual([
      'Take the PDF to a print shop: the sheet is taller than A4 or Letter.',
      'Ask for 300–350 g matte or uncoated card, scored at the fold.',
      'Fold at the dashed marks, with the print on the outside.',
    ])
  })

  it('tells the same for a table tent in one language: its sheet is the same', () => {
    expect(printKitHowToPrint({ piece: 'table_tent', languages: ['en'] })).toEqual(
      printKitHowToPrint({ piece: 'table_tent', languages: ['en', 'bg'] }),
    )
  })

  it('has a counter card printed at actual size, never fitted, on card for a shop or for home', () => {
    expect(printKitHowToPrint({ piece: 'counter_card', languages: ['en'] })).toEqual([
      'Print at 100% (actual size), never “fit to page”.',
      'At a print shop, use 300–350 g matte card. At home, use card of 200 g or more.',
    ])
  })

  it('has a two-language counter card printed double-sided, flipping on the long edge', () => {
    const steps = printKitHowToPrint({ piece: 'counter_card', languages: ['en', 'bg'] })

    expect(steps).toContain(
      'With two languages the card has two pages: print double-sided, flipping on the long edge.',
    )
    expect(steps[0]).toBe('Print at 100% (actual size), never “fit to page”.')
  })
})
