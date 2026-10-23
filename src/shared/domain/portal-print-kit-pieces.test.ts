import { describe, expect, it } from 'vitest'
import { PRINT_KIT_PAPERS, PRINT_KIT_PIECES, PRINT_KIT_STYLES } from './portal-print-kit'
import {
  PRINT_KIT_PIECE_FACTS,
  PRINT_KIT_STYLE_FACTS,
  printKitHowToPrint,
  printKitPaperNote,
  printKitSubject,
  tight,
} from './portal-print-kit-pieces'

/** The words of a step as they read: a no-break space is a space to the eye. */
const words = (steps: ReturnType<typeof printKitHowToPrint>): string[] =>
  steps.map((step) => step.text.replaceAll(' ', ' '))

const plain = (text: string): string => text.replaceAll(' ', ' ')

describe('tight', () => {
  it('joins a measure to its unit, and the sides of a size, with no-break spaces', () => {
    expect(tight('4 × 6 in')).toBe('4 × 6 in')
    expect(tight('2 in (5.1 cm)')).toBe('2 in (5.1 cm)')
    expect(tight('160–200 g/m² matte')).toBe('160–200\u00A0g/m² matte')
    expect(tight('120 g/m² paper')).toBe('120 g/m² paper')
    expect(tight('65–110 lb cover')).toBe('65–110 lb cover')
  })

  it('leaves a word that merely starts like a unit alone', () => {
    expect(tight('2 inches')).toBe('2 inches')
  })
})

describe('the facts of each style', () => {
  it('names the two styles and says what each is for', () => {
    expect(PRINT_KIT_STYLE_FACTS.paper).toEqual({
      label: 'Paper',
      detail: 'Prints on any printer. Letter or A4, no bleed.',
    })
    expect(PRINT_KIT_STYLE_FACTS.immersive).toEqual({
      label: 'Immersive',
      detail: 'Dark, with your photo. Best from a print shop.',
    })
  })
})

describe('the facts of each piece', () => {
  it('has facts for every style, piece and paper', () => {
    for (const style of PRINT_KIT_STYLES) {
      for (const piece of PRINT_KIT_PIECES) {
        for (const paper of PRINT_KIT_PAPERS) {
          const facts = PRINT_KIT_PIECE_FACTS[style][piece][paper]
          expect(facts.label, `${style} ${piece} ${paper}`).not.toBe('')
          expect(facts.howToPrint.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it.each([
    ['paper', 'counter_card', 'letter', 'Counter card', '4 × 6 in · 2 on a Letter sheet'],
    ['paper', 'table_tent', 'letter', 'Table tent', 'Letter, folded in half'],
    ['paper', 'counter_card', 'a4', 'Counter card', 'A6 · 4 on an A4 sheet'],
    ['paper', 'table_tent', 'a4', 'Table tent', 'A4, folded in half'],
    ['immersive', 'counter_card', 'letter', 'Counter card', '4 × 6 in · print shop'],
    ['immersive', 'table_tent', 'letter', 'Table tent', '4 × 6 in, folded · print shop'],
    ['immersive', 'counter_card', 'a4', 'Counter card', 'A6 · print shop'],
    ['immersive', 'table_tent', 'a4', 'Table tent', 'A6, folded · print shop'],
  ] as const)(
    'calls the %s %s on %s “%s”, over “%s”',
    (style, piece, paper, label, detail) => {
      const facts = PRINT_KIT_PIECE_FACTS[style][piece][paper]
      expect(facts.label).toBe(label)
      expect(plain(facts.detail)).toBe(detail)
    },
  )

  it('keeps the piece’s noun the same in every style and paper, for the file name and captions', () => {
    for (const style of PRINT_KIT_STYLES) {
      for (const paper of PRINT_KIT_PAPERS) {
        expect(PRINT_KIT_PIECE_FACTS[style].table_tent[paper].noun).toBe('table tent')
        expect(PRINT_KIT_PIECE_FACTS[style].counter_card[paper].noun).toBe('counter card')
      }
    }
  })
})

describe('printKitHowToPrint', () => {
  it('has a Letter Paper counter card printed at Actual size, checked on the bar, double-sided, on card or in a holder, and cut on the ticks', () => {
    expect(words(printKitHowToPrint('paper', 'counter_card', 'letter', 2))).toEqual([
      'Print at Actual size (100%). Never “Fit to page”.',
      'Check the size: the coloured bar under each code measures 2 in (5.1 cm).',
      'Two languages print double-sided: flip on the long edge.',
      'Use 65–110 lb cover card stock if your printer takes it, or plain paper in a 4 × 6 in sign holder.',
      'Cut down on the three grey ticks, then across 6 in from the top edge.',
    ])
  })

  it('stresses Actual size, as the board does', () => {
    const [first] = printKitHowToPrint('paper', 'counter_card', 'letter', 2)
    expect(first?.strong).toBe('Actual size (100%)')
    expect(first?.text).toContain('Actual size (100%)')
  })

  it('leaves the double-sided step out for one language: a card with one language has no back', () => {
    const steps = words(printKitHowToPrint('paper', 'counter_card', 'letter', 1))
    expect(steps).toHaveLength(4)
    expect(steps.join(' ')).not.toMatch(/double-sided/u)
  })

  it('has an A4 Paper counter card on 160–200 g/m² card, cut once across and once down', () => {
    const steps = words(printKitHowToPrint('paper', 'counter_card', 'a4', 2))
    expect(steps.slice(0, 3)).toEqual(
      words(printKitHowToPrint('paper', 'counter_card', 'letter', 2)).slice(0, 3),
    )
    expect(steps.slice(3)).toEqual([
      'Use 160–200 g/m² matte card if your printer takes it, or 120 g/m² paper in an A6 stand.',
      'Cut once across and once down, on the grey ticks.',
    ])
  })

  it('has a Paper table tent folded on the ticks, its fold line blank', () => {
    expect(words(printKitHowToPrint('paper', 'table_tent', 'letter', 2))).toEqual([
      'Print at Actual size (100%). Never “Fit to page”.',
      'Check the size: the coloured bar under each code measures 2 in (5.1 cm).',
      'Use 65–110 lb cover card stock if your printer takes it, or plain paper in an 8.5 × 5.5 in holder.',
      'Fold on the grey ticks; the fold line stays blank.',
    ])
    expect(words(printKitHowToPrint('paper', 'table_tent', 'a4', 2))[2]).toBe(
      'Use 160–200 g/m² matte card if your printer takes it, or 120 g/m² paper in an A5-landscape holder.',
    )
  })

  it('sends an Immersive print to a print shop as it is, with the stock and the shop line', () => {
    expect(words(printKitHowToPrint('immersive', 'counter_card', 'letter', 2))).toEqual([
      'Made for a print shop. Send the PDF as it is.',
      'Cards 100–130 lb cover, matte or uncoated; tents 80–100 lb cover, scored, grain along the fold; no gloss.',
      'Convert to CMYK with your profile. Field as a warm rich black, at most 280% total ink. Code modules as 100K.',
    ])
  })

  it('gives an A4 Immersive print its weights in grams', () => {
    const [, stock] = words(printKitHowToPrint('immersive', 'table_tent', 'a4', 1))
    expect(stock).toBe(
      'Cards 350 g/m², matte or uncoated; tents 300–350 g/m², scored, grain along the fold; no gloss.',
    )
  })

  it('never tells an Immersive print to be cut on grey ticks: it has crop marks', () => {
    for (const piece of PRINT_KIT_PIECES) {
      for (const paper of PRINT_KIT_PAPERS) {
        expect(
          words(printKitHowToPrint('immersive', piece, paper, 2)).join(' '),
        ).not.toMatch(/ticks|Actual size/u)
      }
    }
  })
})

describe('printKitPaperNote', () => {
  it('says what each paper makes of a Paper card and tent', () => {
    expect(plain(printKitPaperNote('paper', 'counter_card'))).toBe(
      'Letter prints two 4 × 6 in cards per sheet. A4 prints four A6 cards.',
    )
    expect(plain(printKitPaperNote('paper', 'table_tent'))).toBe(
      'Letter folds into two 8.5 × 5.5 in faces. A4 folds into two A5 faces.',
    )
  })

  it('reads the paper as a size family for Immersive', () => {
    for (const piece of PRINT_KIT_PIECES) {
      expect(plain(printKitPaperNote('immersive', piece))).toBe(
        'Letter makes 4 × 6 in pieces. A4 makes A6 pieces.',
      )
    }
  })
})

describe('printKitSubject', () => {
  it('names the style, the piece and the paper as a manager reads them', () => {
    expect(printKitSubject('paper', 'counter_card', 'letter')).toBe(
      'Print kit: Paper style, counter card, US Letter',
    )
    expect(printKitSubject('paper', 'table_tent', 'a4')).toBe(
      'Print kit: Paper style, table tent, A4',
    )
  })

  it('names the piece’s size for a print shop, not a sheet', () => {
    expect(printKitSubject('immersive', 'table_tent', 'a4')).toBe(
      'Print kit: Immersive style, table tent, A6',
    )
    expect(printKitSubject('immersive', 'counter_card', 'letter')).toBe(
      'Print kit: Immersive style, counter card, 4 × 6 in',
    )
  })
})
