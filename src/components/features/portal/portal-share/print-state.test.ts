import { describe, expect, it } from 'vitest'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  INITIAL_PRINT_CHOICE,
  parsePrintQuantity,
  printShareCheck,
  printShareCount,
  resolvePrintChoice,
  type PrintShareChoice,
} from './print-state'

const SHORT = { address: 'short', symbolModules: 29 } as const
const LONG = { address: 'long', symbolModules: 53 } as const

const resolve = (
  over: Partial<PrintShareChoice> = {},
  locales: readonly GuestLocale[] = ['en', 'es'],
  country: string | null = 'US',
) => resolvePrintChoice({ ...INITIAL_PRINT_CHOICE, ...over }, locales, country)

describe('resolvePrintChoice', () => {
  it('starts on the board’s print: ten wide Paper tents on Letter, English then Español', () => {
    expect(resolve()).toEqual({
      piece: 'tent',
      orientation: 'wide',
      look: 'paper',
      printer: 'my_printer',
      paper: 'letter',
      countryPaper: 'letter',
      quantity: 10,
      fillSpares: false,
      perSheet: 4,
      chosenPerSheet: undefined,
      backPage: false,
      cropMarks: false,
      languages: ['en', 'es'],
      callToAction: 'how_did_we_do',
      words: { preset: 'how_did_we_do', custom: null },
    })
  })

  it('remembers each piece’s orientation, the Counter card upright and the Small card wide by default', () => {
    expect(resolve({ piece: 'counter' }).orientation).toBe('upright')
    expect(resolve({ piece: 'small' }).orientation).toBe('wide')
    const turned = {
      ...INITIAL_PRINT_CHOICE.orientations,
      tent: 'upright',
    } as const
    expect(resolve({ orientations: turned }).orientation).toBe('upright')
    expect(resolve({ orientations: turned, piece: 'counter' }).orientation).toBe(
      'upright',
    )
  })

  it('prints on the country’s paper until the manager picks one', () => {
    expect(resolve({}, ['en'], 'BG').paper).toBe('a4')
    expect(resolve({ paper: 'letter' }, ['en'], 'BG')).toMatchObject({
      paper: 'letter',
      countryPaper: 'a4',
    })
  })

  it('prints a back page for a card that asked for one, and never for a tent', () => {
    expect(resolve({ piece: 'counter', backPage: true }).backPage).toBe(true)
    expect(resolve({ piece: 'small', backPage: true }).backPage).toBe(true)
    expect(resolve({ piece: 'counter' }).backPage).toBe(false)
    // The choice is remembered while a tent is on show, and the tent prints its front on both faces.
    expect(resolve({ piece: 'tent', backPage: true }).backPage).toBe(false)
    expect(resolve({ printer: 'print_shop', backPage: true }).piece).toBe('counter')
    expect(resolve({ printer: 'print_shop', backPage: true }).backPage).toBe(true)
  })

  it('offers Counter cards in place of tents for a print shop', () => {
    expect(resolve({ printer: 'print_shop' }).piece).toBe('counter')
  })

  it('adds crop marks only to a print shop’s file, and only when asked for', () => {
    expect(resolve({ printer: 'print_shop' }).cropMarks).toBe(false)
    expect(resolve({ printer: 'print_shop', cropMarks: true }).cropMarks).toBe(true)
    // The choice is remembered while the manager's own printer is on show, where a page has no marks to add.
    expect(resolve({ cropMarks: true }).cropMarks).toBe(false)
  })

  it('keeps a count a sheet only while it is fewer than fit', () => {
    expect(resolve({ perSheet: 2 })).toMatchObject({ perSheet: 2, chosenPerSheet: 2 })
    expect(resolve({ perSheet: 4 })).toMatchObject({
      perSheet: 4,
      chosenPerSheet: undefined,
    })
    // Two fit an Immersive tent sheet, so three is every cell.
    expect(resolve({ perSheet: 3, look: 'immersive' })).toMatchObject({
      perSheet: 2,
      chosenPerSheet: undefined,
    })
  })

  it('falls back to the portal’s first languages when the chosen ones are no longer offered', () => {
    expect(resolve({ languages: ['es'] }).languages).toEqual(['es'])
    expect(resolve({ languages: ['de'] }).languages).toEqual(['en', 'es'])
  })
})

describe('parsePrintQuantity', () => {
  it('takes a whole number from 1 to 1000', () => {
    expect(parsePrintQuantity('10')).toBe(10)
    expect(parsePrintQuantity(' 1000 ')).toBe(1000)
    for (const text of ['', '0', '1001', '2.5', 'ten', '-3']) {
      expect(parsePrintQuantity(text)).toBeNull()
    }
  })
})

describe('printShareCount', () => {
  it('counts exact sheets, and spares only when asked', () => {
    expect(printShareCount(resolve())).toEqual({ sheets: 3, pieces: 10 })
    expect(printShareCount(resolve({ fillSpares: true }))).toEqual({
      sheets: 3,
      pieces: 12,
    })
    expect(printShareCount(resolve({ perSheet: 3 }))).toEqual({
      sheets: 4,
      pieces: 10,
    })
  })

  it('counts a print shop’s file as one page', () => {
    expect(printShareCount(resolve({ printer: 'print_shop' }))).toEqual({
      sheets: 1,
      pieces: 1,
    })
  })
})

describe('printShareCheck', () => {
  it('prints a card with a back page, and a tent never asks for one', () => {
    expect(
      printShareCheck(resolve({ piece: 'counter', backPage: true }), SHORT).refusal,
    ).toBeNull()
    expect(
      printShareCheck(resolve({ piece: 'tent', backPage: true }), SHORT).refusal,
    ).toBeNull()
  })

  it('prints the board’s tents on the 1.4 in tile', () => {
    const check = printShareCheck(resolve(), SHORT)
    expect(check.refusal).toBeNull()
    expect(check.tile?.tilePt).toBeCloseTo(100.8, 5)
  })

  it('draws no tile for a tent on the long address, and says why', () => {
    expect(printShareCheck(resolve(), LONG)).toEqual({
      tile: null,
      refusal: 'needs_short_code',
    })
  })

  it('keeps drawing the piece while the quantity is being typed', () => {
    const check = printShareCheck(resolve({ quantityText: '' }), SHORT)
    expect(check.tile).not.toBeNull()
    expect(check.refusal).toBe('quantity_out_of_range')
  })

  it('holds two cues to the bar, and the short cues fit every pair on every piece', () => {
    for (const piece of ['counter', 'tent', 'small'] as const) {
      const check = printShareCheck(
        resolve({ piece, languages: ['fr', 'bg'] }, ['fr', 'bg']),
        SHORT,
      )
      expect(check.refusal).toBeNull()
    }
  })
})
