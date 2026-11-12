import { describe, expect, it } from 'vitest'
import {
  PRINT_BACK_HELP,
  PRINT_BACK_LABEL,
  printBackCaption,
} from './portal-print-back-copy'
import {
  printFileName,
  printHowToSteps,
  printSheetCaption,
  printSheetHeading,
  printSummary,
  type PrintDescribed,
} from './portal-print-how-to'
import { PRINT_REFUSAL_COPY } from './portal-print-refusals'
import { printSides, printStockLine } from './portal-print-share'
import { inPt } from './portal-print-measures'

const cards: PrintDescribed = {
  piece: 'counter',
  orientation: 'upright',
  look: 'paper',
  paper: 'letter',
  printer: 'my_printer',
  languages: ['en'],
  backPage: true,
}

describe('the back page’s words', () => {
  it('names the option and what it prints, in the app’s words', () => {
    expect(PRINT_BACK_LABEL).toBe('Print a back page')
    expect(PRINT_BACK_HELP).toBe(
      'The logo and the property name on the back, for a holder guests see from both sides. No code on it.',
    )
  })

  it('says one side until a back page is asked for, then both', () => {
    expect(printSides(undefined)).toBe('one side')
    expect(printSides(false)).toBe('one side')
    expect(printSides(true)).toBe('both sides')
  })

  it('names the sides in the summary beside the download, a print shop’s two pages included', () => {
    expect(printSummary(cards, { sheets: 4, pieces: 10 })).toEqual({
      lead: '4 sheets',
      rest: '10 cards · upright · Letter · both sides · English',
    })
    expect(
      printSummary({ ...cards, backPage: false }, { sheets: 4, pieces: 10 }).rest,
    ).toContain('one side')
    expect(
      printSummary({ ...cards, printer: 'print_shop' }, { sheets: 1, pieces: 1 }),
    ).toEqual({
      lead: '2 pages',
      rest: 'one card per page · upright · 4 × 6 in · both sides · English',
    })
    expect(printSummary(cards, { sheets: 4, pieces: 10 }, true).rest).toBe(
      '10 cards · upright · Letter',
    )
  })

  it('says both sides in the stock line', () => {
    const input = {
      piece: 'counter',
      look: 'paper',
      paper: 'letter',
      countryPaper: 'letter',
      countryCode: 'US',
    } as const
    expect(printStockLine(input)).toContain('(176–216 g/m²), one side, through')
    expect(printStockLine({ ...input, backPage: true })).toContain(
      '(176–216 g/m²), both sides, through',
    )
  })

  it('adds the step that turns each sheet over, after the first and before the code check', () => {
    const steps = printHowToSteps(cards, inPt(1.5)).map((step) => step.text)
    expect(steps).toHaveLength(4)
    expect(steps[1]).toBe(
      'Print both sides, turning each sheet over like the page of a book; every back is the page after its front. Without a two-sided setting, print page 1, put the sheet back in turned over, then print page 2. Try plain paper first: if a back comes out upside down, flip on the other edge.',
    )
    expect(steps[2]).toMatch(/^Check one code/u)
    expect(printHowToSteps({ ...cards, backPage: false }, inPt(1.5))).toHaveLength(3)
  })

  it('asks a print shop for the front on page 1 and the back on page 2', () => {
    const [send] = printHowToSteps({ ...cards, printer: 'print_shop' }, inPt(1.5))
    expect(send?.text).toBe(
      'Send the PDF to a print shop and ask for it at Actual size (100%), one card per page, the front on page 1 and the back on page 2.',
    )
  })

  it('heads and captions the back of a sheet, with the cuts made from the front', () => {
    expect(printSheetHeading(cards, 4, true)).toBe('Letter · back of sheet 1 of 4')
    expect(printSheetHeading({ ...cards, orientation: 'wide' }, 4, true)).toBe(
      'Letter landscape · back of sheet 1 of 4',
    )
    expect(printSheetCaption(cards, 3, true)).toBe(
      '3 cards per sheet. Each back sits behind its front when the sheet is turned over like the page of a book. Cut from the front, on its marks.',
    )
    expect(printSheetCaption(cards, 3)).toBe('3 cards per sheet. Cut on the grey ticks.')
  })

  it('captions the back page: its size, its orientation and what is on it', () => {
    expect(printBackCaption(cards)).toEqual({
      lead: 'Counter card back · 4 × 6 in',
      rest: ', upright, shown smaller. The logo and the property name, with no code.',
    })
    expect(
      printBackCaption({ piece: 'small', orientation: 'wide', paper: 'a4' }).lead,
    ).toBe('Small card back · 85 × 54 mm')
  })

  it('does not share a file name with the one-sided print', () => {
    expect(printFileName('Reception', cards)).toBe(
      'reception-counter-cards-upright-en-back-letter.pdf',
    )
    expect(printFileName('Reception', { ...cards, backPage: false })).toBe(
      'reception-counter-cards-upright-en-letter.pdf',
    )
  })

  it('refuses a tent’s back page in words that point to a card', () => {
    expect(PRINT_REFUSAL_COPY.no_back_for_tents).toBe(
      'Tents print the front on both faces, so they have no back page. Choose a card for one.',
    )
  })
})
