import { describe, expect, it } from 'vitest'
import {
  printFinalCountryName,
  printFinalLookFacts,
  printFinalOrientationNote,
  printFinalPieceCardDetail,
  printFinalSheetCutCount,
  printFinalSparesNote,
  printFinalStockLine,
  printFinalTrimLabel,
} from './portal-print-final-share'

describe('printFinalTrimLabel', () => {
  it('names each piece in its orientation, in inches in the US', () => {
    expect(printFinalTrimLabel('counter', 'upright', 'us')).toBe('4 × 6 in')
    expect(printFinalTrimLabel('counter', 'wide', 'us')).toBe('6 × 4 in')
    expect(printFinalTrimLabel('tent', 'wide', 'us')).toBe('4.25 × 2.75 in')
    expect(printFinalTrimLabel('small', 'wide', 'us')).toBe('3.5 × 2 in')
  })

  it('names them in millimetres in Europe', () => {
    expect(printFinalTrimLabel('counter', 'upright', 'eu')).toBe('105 × 148 mm')
    expect(printFinalTrimLabel('tent', 'wide', 'eu')).toBe('105 × 74.25 mm')
    expect(printFinalTrimLabel('small', 'upright', 'eu')).toBe('54 × 85 mm')
  })
})

describe('printFinalPieceCardDetail', () => {
  const card = {
    orientation: 'wide',
    look: 'paper',
    paper: 'letter',
    printer: 'my_printer',
  } as const

  it('says where each piece goes, its size and how many fit a sheet, as the board does', () => {
    expect(printFinalPieceCardDetail({ ...card, piece: 'tent' })).toBe(
      'Tables and nightstands · 4.25 × 2.75 in faces · 4 per sheet',
    )
    expect(
      printFinalPieceCardDetail({ ...card, piece: 'counter', orientation: 'upright' }),
    ).toBe('Reception or the bar, in a holder · 4 × 6 in · 3 per sheet')
    expect(printFinalPieceCardDetail({ ...card, piece: 'small' })).toBe(
      'Key-card sleeves, check folders · 3.5 × 2 in · 10 per sheet',
    )
  })

  it('counts the chosen look and paper', () => {
    expect(
      printFinalPieceCardDetail({
        ...card,
        piece: 'small',
        look: 'immersive',
        paper: 'a4',
      }),
    ).toBe('Key-card sleeves, check folders · 85 × 54 mm · 9 per sheet')
  })

  it('says a print shop gets one per page, and a tent only prints at the office', () => {
    const shop = { ...card, printer: 'print_shop' } as const
    expect(printFinalPieceCardDetail({ ...shop, piece: 'counter' })).toBe(
      'Reception or the bar, in a holder · 6 × 4 in · one per page',
    )
    expect(printFinalPieceCardDetail({ ...shop, piece: 'tent' })).toBe(
      'Tables and nightstands · from your own printer only',
    )
  })
})

describe('printFinalOrientationNote', () => {
  it('gives the spec’s line of physics per piece and orientation', () => {
    expect(printFinalOrientationNote('tent', 'wide', 'letter')).toBe(
      'Wide tents stand about 2.5 in tall. Upright ones stand 3.9 in and fold from a strip.',
    )
    expect(printFinalOrientationNote('tent', 'upright', 'letter')).toBe(
      'Upright tents stand about 3.9 in tall. A second language prints as one small line.',
    )
    expect(printFinalOrientationNote('counter', 'upright', 'letter')).toBe(
      'Upright fits the 4 × 6 in holders most counters use. Wide needs a wide holder.',
    )
    expect(printFinalOrientationNote('small', 'upright', 'letter')).toBe(
      'No stock sleeve takes an upright Small card.',
    )
  })

  it('names Europe’s holders in Europe’s sizes', () => {
    expect(printFinalOrientationNote('counter', 'upright', 'a4')).toBe(
      'Upright fits the A6 holders most counters use. Wide needs a wide holder.',
    )
  })
})

describe('printFinalSheetCutCount', () => {
  it('counts the cuts of §10.2 from the sheet geometry', () => {
    const key = { orientation: 'upright', paper: 'letter' } as const
    expect(printFinalSheetCutCount({ ...key, piece: 'counter', look: 'paper' })).toBe(9)
    expect(printFinalSheetCutCount({ ...key, piece: 'counter', look: 'immersive' })).toBe(
      6,
    )
    expect(printFinalSheetCutCount({ ...key, piece: 'tent', look: 'paper' })).toBe(3)
    expect(printFinalSheetCutCount({ ...key, piece: 'small', look: 'immersive' })).toBe(
      12,
    )
    expect(
      printFinalSheetCutCount({ ...key, piece: 'small', look: 'immersive', paper: 'a4' }),
    ).toBe(12)
  })
})

describe('printFinalLookFacts', () => {
  const tent = { piece: 'tent', orientation: 'wide', paper: 'letter' } as const

  it('gives the chosen Paper look its sheet and how a tent sheet is cut', () => {
    expect(printFinalLookFacts('paper', { ...tent, look: 'paper' })).toBe(
      'White, little ink. 4 tents a sheet, cut in half each way.',
    )
    expect(
      printFinalLookFacts('paper', { ...tent, orientation: 'upright', look: 'paper' }),
    ).toBe('White, little ink. 4 tents a sheet, cut into strips.')
  })

  it('gives the other look how many it fits and what it costs', () => {
    expect(printFinalLookFacts('immersive', { ...tent, look: 'paper' })).toBe(
      'Your photo, like your guest page. 2 tents a sheet, more toner.',
    )
    expect(
      printFinalLookFacts('paper', { ...tent, piece: 'counter', look: 'immersive' }),
    ).toBe('White, little ink. 3 cards a sheet.')
  })

  it('gives the chosen Immersive look its cuts', () => {
    expect(
      printFinalLookFacts('immersive', {
        ...tent,
        piece: 'counter',
        orientation: 'upright',
        look: 'immersive',
      }),
    ).toBe('Your photo, like your guest page. 2 cards a sheet, 6 cuts, more toner.')
  })
})

describe('printFinalCountryName', () => {
  it('names a country as a sentence does', () => {
    expect(printFinalCountryName('US')).toBe('the United States')
    expect(printFinalCountryName('bg')).toBe('Bulgaria')
  })

  it('names nothing for a code it does not know', () => {
    expect(printFinalCountryName('ZZ')).toBeNull()
    expect(printFinalCountryName('QQ')).toBeNull()
    expect(printFinalCountryName('USA')).toBeNull()
  })
})

describe('printFinalLookFacts for a print shop', () => {
  const shop = {
    piece: 'counter',
    orientation: 'upright',
    look: 'immersive',
    paper: 'letter',
    printer: 'print_shop',
  } as const

  it('says what each look prints, and nothing about sheets, cuts or toner', () => {
    expect(printFinalLookFacts('paper', shop)).toBe('White, little ink.')
    expect(printFinalLookFacts('immersive', shop)).toBe(
      'Your photo, like your guest page, to the edge of the card.',
    )
    for (const look of ['paper', 'immersive'] as const) {
      expect(printFinalLookFacts(look, shop)).not.toMatch(/sheet|cuts|toner/u)
    }
  })

  it('keeps the sheet facts from the manager’s own printer', () => {
    expect(printFinalLookFacts('paper', { ...shop, printer: 'my_printer' })).toBe(
      'White, little ink. 3 cards a sheet.',
    )
  })
})

describe('printFinalStockLine', () => {
  const us = { paper: 'letter', countryPaper: 'letter', countryCode: 'US' } as const

  it('reads as the board’s for a Paper tent in the United States', () => {
    expect(printFinalStockLine({ ...us, piece: 'tent', look: 'paper' })).toBe(
      'Card stock, 65–80 lb cover (176–216 g/m²), one side, through the manual slot. Letter because your property is in the United States. Print shops sell tents from 4 × 6 in, so for a shop choose Counter cards.',
    )
  })

  it('asks for matte stock for Immersive and says what a print shop gets for a card', () => {
    expect(printFinalStockLine({ ...us, piece: 'counter', look: 'immersive' })).toBe(
      'Card stock, 65–80 lb cover (176–216 g/m²), matte, one side, through the manual slot. Letter because your property is in the United States. A print shop gets one card per page, with print margins added.',
    )
  })

  it('gives Europe’s card and leaves a paper chosen against the country unexplained', () => {
    expect(
      printFinalStockLine({
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

describe('printFinalSparesNote', () => {
  it('says what the last sheet holds and what spares make it', () => {
    expect(printFinalSparesNote(10, 4)).toEqual({
      spares: 2,
      note: 'The last sheet has 2; without spares its other 2 spaces print nothing. Spares make it 12.',
    })
    expect(printFinalSparesNote(10, 3).note).toBe(
      'The last sheet has 1; without spares its other 2 spaces print nothing. Spares make it 12.',
    )
    expect(printFinalSparesNote(9, 10).note).toBe(
      'The last sheet has 9; without spares its other 1 space prints nothing. Spares make it 10.',
    )
  })

  it('says when the quantity fills its sheets exactly', () => {
    expect(printFinalSparesNote(10, 2)).toEqual({
      spares: 0,
      note: 'Fills 5 sheets exactly.',
    })
    expect(printFinalSparesNote(4, 4).note).toBe('Fills 1 sheet exactly.')
  })
})
