import { describe, expect, it } from 'vitest'
import {
  printCountryName,
  printLookFacts,
  printOrientationNote,
  printPieceCardDetail,
  printSheetCutCount,
  printSparesNote,
  printStockLine,
  printTrimLabel,
} from './portal-print-share'

describe('printTrimLabel', () => {
  it('names each piece in its orientation, in inches in the US', () => {
    expect(printTrimLabel('counter', 'upright', 'us')).toBe('4 × 6 in')
    expect(printTrimLabel('counter', 'wide', 'us')).toBe('6 × 4 in')
    expect(printTrimLabel('tent', 'wide', 'us')).toBe('4.25 × 2.75 in')
    expect(printTrimLabel('small', 'wide', 'us')).toBe('3.5 × 2 in')
  })

  it('names them in millimetres in Europe', () => {
    expect(printTrimLabel('counter', 'upright', 'eu')).toBe('105 × 148 mm')
    expect(printTrimLabel('tent', 'wide', 'eu')).toBe('105 × 74.25 mm')
    expect(printTrimLabel('small', 'upright', 'eu')).toBe('54 × 85 mm')
  })
})

describe('printPieceCardDetail', () => {
  const card = {
    orientation: 'wide',
    look: 'paper',
    paper: 'letter',
    printer: 'my_printer',
  } as const

  it('says where each piece goes, its size and how many fit a sheet, as the board does', () => {
    expect(printPieceCardDetail({ ...card, piece: 'tent' })).toBe(
      'Tables and nightstands · 4.25 × 2.75 in faces · 4 per sheet',
    )
    expect(
      printPieceCardDetail({ ...card, piece: 'counter', orientation: 'upright' }),
    ).toBe('Reception or the bar, in a holder · 4 × 6 in · 3 per sheet')
    expect(printPieceCardDetail({ ...card, piece: 'small' })).toBe(
      'Key-card sleeves, check folders · 3.5 × 2 in · 10 per sheet',
    )
  })

  it('counts the chosen look and paper', () => {
    expect(
      printPieceCardDetail({
        ...card,
        piece: 'small',
        look: 'immersive',
        paper: 'a4',
      }),
    ).toBe('Key-card sleeves, check folders · 85 × 54 mm · 9 per sheet')
  })

  it('says a print shop gets one per page, and a tent only prints at the office', () => {
    const shop = { ...card, printer: 'print_shop' } as const
    expect(printPieceCardDetail({ ...shop, piece: 'counter' })).toBe(
      'Reception or the bar, in a holder · 6 × 4 in · one per page',
    )
    expect(printPieceCardDetail({ ...shop, piece: 'tent' })).toBe(
      'Tables and nightstands · from your own printer only',
    )
  })
})

describe('printOrientationNote', () => {
  it('gives the spec’s line of physics per piece and orientation', () => {
    expect(printOrientationNote('tent', 'wide', 'letter')).toBe(
      'Wide tents stand about 2.5 in tall. Upright ones stand 3.9 in and fold from a strip.',
    )
    expect(printOrientationNote('tent', 'upright', 'letter')).toBe(
      'Upright tents stand about 3.9 in tall. A second language prints as one small line.',
    )
    expect(printOrientationNote('counter', 'upright', 'letter')).toBe(
      'Upright fits the 4 × 6 in holders most counters use. Wide needs a wide holder.',
    )
    expect(printOrientationNote('small', 'upright', 'letter')).toBe(
      'No stock sleeve takes an upright Small card.',
    )
  })

  it('names Europe’s holders in Europe’s sizes', () => {
    expect(printOrientationNote('counter', 'upright', 'a4')).toBe(
      'Upright fits the A6 holders most counters use. Wide needs a wide holder.',
    )
  })
})

describe('printSheetCutCount', () => {
  it('counts the cuts of §10.2 from the sheet geometry', () => {
    const key = { orientation: 'upright', paper: 'letter' } as const
    expect(printSheetCutCount({ ...key, piece: 'counter', look: 'paper' })).toBe(9)
    expect(printSheetCutCount({ ...key, piece: 'counter', look: 'immersive' })).toBe(6)
    expect(printSheetCutCount({ ...key, piece: 'tent', look: 'paper' })).toBe(3)
    expect(printSheetCutCount({ ...key, piece: 'small', look: 'immersive' })).toBe(12)
    expect(
      printSheetCutCount({ ...key, piece: 'small', look: 'immersive', paper: 'a4' }),
    ).toBe(12)
  })
})

describe('printLookFacts', () => {
  const tent = { piece: 'tent', orientation: 'wide', paper: 'letter' } as const

  it('gives the chosen Paper look its sheet and how a tent sheet is cut', () => {
    expect(printLookFacts('paper', { ...tent, look: 'paper' })).toBe(
      'White, little ink. 4 tents a sheet, cut in half each way.',
    )
    expect(
      printLookFacts('paper', { ...tent, orientation: 'upright', look: 'paper' }),
    ).toBe('White, little ink. 4 tents a sheet, cut into strips.')
  })

  it('gives the other look how many it fits and what it costs', () => {
    expect(printLookFacts('immersive', { ...tent, look: 'paper' })).toBe(
      'Your photo, like your guest page. 2 tents a sheet, more toner.',
    )
    expect(
      printLookFacts('paper', { ...tent, piece: 'counter', look: 'immersive' }),
    ).toBe('White, little ink. 3 cards a sheet.')
  })

  it('gives the chosen Immersive look its cuts', () => {
    expect(
      printLookFacts('immersive', {
        ...tent,
        piece: 'counter',
        orientation: 'upright',
        look: 'immersive',
      }),
    ).toBe('Your photo, like your guest page. 2 cards a sheet, 6 cuts, more toner.')
  })
})

describe('printCountryName', () => {
  it('names a country as a sentence does', () => {
    expect(printCountryName('US')).toBe('the United States')
    expect(printCountryName('bg')).toBe('Bulgaria')
  })

  it('names nothing for a code it does not know', () => {
    expect(printCountryName('ZZ')).toBeNull()
    expect(printCountryName('QQ')).toBeNull()
    expect(printCountryName('USA')).toBeNull()
  })
})

describe('printLookFacts for a print shop', () => {
  const shop = {
    piece: 'counter',
    orientation: 'upright',
    look: 'immersive',
    paper: 'letter',
    printer: 'print_shop',
  } as const

  it('says what each look prints, and nothing about sheets, cuts or toner', () => {
    expect(printLookFacts('paper', shop)).toBe('White, little ink.')
    expect(printLookFacts('immersive', shop)).toBe(
      'Your photo, like your guest page, to the edge of the card.',
    )
    for (const look of ['paper', 'immersive'] as const) {
      expect(printLookFacts(look, shop)).not.toMatch(/sheet|cuts|toner/u)
    }
  })

  it('keeps the sheet facts from the manager’s own printer', () => {
    expect(printLookFacts('paper', { ...shop, printer: 'my_printer' })).toBe(
      'White, little ink. 3 cards a sheet.',
    )
  })
})

describe('printStockLine', () => {
  const us = { paper: 'letter', countryPaper: 'letter', countryCode: 'US' } as const

  it('reads as the board’s for a Paper tent in the United States', () => {
    expect(printStockLine({ ...us, piece: 'tent', look: 'paper' })).toBe(
      'Card stock, 65–80 lb cover (176–216 g/m²), one side, through the manual slot. Letter because your property is in the United States. Print shops sell tents from 4 × 6 in, so for a shop choose Counter cards.',
    )
  })

  it('asks for matte stock for Immersive and says what a print shop gets for a card', () => {
    expect(printStockLine({ ...us, piece: 'counter', look: 'immersive' })).toBe(
      'Card stock, 65–80 lb cover (176–216 g/m²), matte, one side, through the manual slot. Letter because your property is in the United States. A print shop gets one card per page, with print margins added.',
    )
  })

  it('gives Europe’s card and leaves a paper chosen against the country unexplained', () => {
    expect(
      printStockLine({
        piece: 'small',
        look: 'paper',
        paper: 'a4',
        countryPaper: 'letter',
        countryCode: 'US',
      }),
    ).toBe(
      'Card, 160–220 g/m², one side, through the manual slot. A print shop gets one card per page, with print margins added.',
    )
  })
})

describe('printSparesNote', () => {
  it('says what the last sheet holds and what spares make it', () => {
    expect(printSparesNote(10, 4)).toEqual({
      spares: 2,
      note: 'The last sheet has 2; without spares its other 2 spaces print nothing. Spares make it 12.',
    })
    expect(printSparesNote(10, 3).note).toBe(
      'The last sheet has 1; without spares its other 2 spaces print nothing. Spares make it 12.',
    )
    expect(printSparesNote(9, 10).note).toBe(
      'The last sheet has 9; without spares its other 1 space prints nothing. Spares make it 10.',
    )
  })

  it('says when the quantity fills its sheets exactly', () => {
    expect(printSparesNote(10, 2)).toEqual({
      spares: 0,
      note: 'Fills 5 sheets exactly.',
    })
    expect(printSparesNote(4, 4).note).toBe('Fills 1 sheet exactly.')
  })
})
