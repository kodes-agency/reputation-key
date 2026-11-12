// What the Print cards section does with the Portal's last print (design
// spec §11, slice 12): the look the section opens on, setting the same choices
// again, and knowing when they already are the last print's.

import { describe, expect, it } from 'vitest'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintLook } from '#/shared/domain/portal-print'
import type { PrintLastSettings } from '#/shared/domain/portal-print-last'
import {
  INITIAL_PRINT_CHOICE,
  choiceOfLastPrint,
  printIsLastSet,
  printLastLook,
  printMatchesLast,
  resolvePrintChoice,
  type PrintShareChoice,
} from './print-state'

const resolve = (
  over: Partial<PrintShareChoice> = {},
  locales: readonly GuestLocale[] = ['en', 'es'],
  country: string | null = 'US',
  lastLook: PrintLook | null = null,
) => resolvePrintChoice({ ...INITIAL_PRINT_CHOICE, ...over }, locales, country, lastLook)

const LAST: PrintLastSettings = {
  piece: 'counter',
  orientation: 'wide',
  look: 'immersive',
  paper: 'a4',
  printer: 'my_printer',
  quantity: 25,
  fillSpares: true,
  perSheet: 1,
  cropMarks: false,
  backPage: true,
  languages: ['es', 'en'],
  callToAction: 'how_was_visit',
  customWords: null,
}

describe('the look a print opens on', () => {
  it('is Paper the first time', () => {
    expect(resolve().look).toBe('paper')
  })

  it('is the look of the last print until the manager picks one', () => {
    expect(resolve({}, ['en'], 'US', 'immersive').look).toBe('immersive')
    expect(resolve({ look: 'paper' }, ['en'], 'US', 'immersive').look).toBe('paper')
  })
})

describe('choiceOfLastPrint', () => {
  const chosen = choiceOfLastPrint(INITIAL_PRINT_CHOICE, LAST)

  it('sets every choice of the last print again', () => {
    expect(chosen).toMatchObject({
      piece: 'counter',
      look: 'immersive',
      printer: 'my_printer',
      paper: 'a4',
      quantityText: '25',
      fillSpares: true,
      perSheet: 1,
      backPage: true,
      cropMarks: false,
      languages: ['es', 'en'],
      callToAction: 'how_was_visit',
    })
    expect(chosen.orientations.counter).toBe('wide')
  })

  it('leaves the orientation the manager keeps for the other pieces alone', () => {
    const turned = {
      ...INITIAL_PRINT_CHOICE,
      orientations: { ...INITIAL_PRINT_CHOICE.orientations, tent: 'upright' },
    } as const

    expect(choiceOfLastPrint(turned, LAST).orientations).toEqual({
      counter: 'wide',
      tent: 'upright',
      small: 'wide',
    })
  })

  it('resolves to the very print it was made from', () => {
    const print = resolvePrintChoice(chosen, ['en', 'es'], 'US', null)

    expect(printMatchesLast(print, LAST)).toBe(true)
  })

  it('keeps a print shop’s form as it was, quantity and all', () => {
    const shop: PrintLastSettings = {
      ...LAST,
      printer: 'print_shop',
      cropMarks: true,
      quantity: 40,
      perSheet: null,
    }
    const print = resolvePrintChoice(
      choiceOfLastPrint(INITIAL_PRINT_CHOICE, shop),
      ['en', 'es'],
      'US',
      null,
    )

    expect(print).toMatchObject({ printer: 'print_shop', cropMarks: true, quantity: 40 })
    expect(printMatchesLast(print, shop)).toBe(true)
  })
})

describe('printMatchesLast', () => {
  const same = () =>
    resolvePrintChoice(
      choiceOfLastPrint(INITIAL_PRINT_CHOICE, LAST),
      ['en', 'es'],
      'US',
      null,
    )

  it('says no for the board’s starting print, which is not the last one', () => {
    expect(printMatchesLast(resolve(), LAST)).toBe(false)
  })

  it.each([
    ['the quantity', { quantityText: '26' }],
    ['the quantity being typed', { quantityText: '' }],
    ['the look', { look: 'paper' }],
    ['the paper', { paper: 'letter' }],
    ['the languages', { languages: ['en', 'es'] }],
    ['the call to action', { callToAction: 'how_did_we_do' }],
    [
      'the own words',
      { customWords: { en: { headline: 'How was today?', subline: '' } } },
    ],
    ['the spares', { fillSpares: false }],
    ['the count a sheet', { perSheet: null }],
    ['the back page', { backPage: false }],
    ['the piece', { piece: 'small' }],
  ] as const)('says no once %s differs', (_label, patch) => {
    const print = resolvePrintChoice(
      { ...choiceOfLastPrint(INITIAL_PRINT_CHOICE, LAST), ...patch },
      ['en', 'es'],
      'US',
      null,
    )

    expect(printMatchesLast(print, LAST)).toBe(false)
  })

  it('says no once the orientation differs', () => {
    const base = choiceOfLastPrint(INITIAL_PRINT_CHOICE, LAST)
    const print = resolvePrintChoice(
      { ...base, orientations: { ...base.orientations, counter: 'upright' } },
      ['en', 'es'],
      'US',
      null,
    )

    expect(printMatchesLast(print, LAST)).toBe(false)
    expect(printMatchesLast(same(), LAST)).toBe(true)
  })
})

describe('printLastLook', () => {
  it('is the look of the last print, or none for a Portal never printed', () => {
    expect(printLastLook({ settings: LAST })).toBe('immersive')
    expect(printLastLook(null)).toBeNull()
  })
})

describe('printIsLastSet', () => {
  const lastPrint = { settings: LAST }

  it('is false before the read and for a Portal never printed', () => {
    expect(printIsLastSet(null, lastPrint)).toBe(false)
    expect(printIsLastSet(resolve(), null)).toBe(false)
  })

  it('is true once the choices on show are the last print’s, and false before', () => {
    const print = resolvePrintChoice(
      choiceOfLastPrint(INITIAL_PRINT_CHOICE, LAST),
      ['en', 'es'],
      'US',
      null,
    )

    expect(printIsLastSet(print, lastPrint)).toBe(true)
    expect(printIsLastSet(resolve(), lastPrint)).toBe(false)
  })
})

describe('the last print of the manager’s own words (spec 11.5, slice C8)', () => {
  const own = { en: { headline: 'How was today?', subline: '' } }
  const lastOwn = { ...LAST, languages: ['en', 'es'] as const, customWords: own }

  it('brings the own words back in "Write your own…", started from the same wording', () => {
    const chosen = choiceOfLastPrint(INITIAL_PRINT_CHOICE, lastOwn)
    expect(chosen).toMatchObject({ callToAction: 'how_was_visit', customWords: own })
    const print = resolvePrintChoice(chosen, ['en', 'es'], 'US', null)
    expect(print.words.custom?.en).toEqual(own.en)
    expect(printMatchesLast(print, lastOwn)).toBe(true)
  })

  it('knows the print by its words, whatever order a stored object keeps its fields in', () => {
    const chosen = choiceOfLastPrint(INITIAL_PRINT_CHOICE, lastOwn)
    const print = resolvePrintChoice(chosen, ['en', 'es'], 'US', null)
    const reordered = { en: { subline: '', headline: 'How was today?' } }
    expect(printMatchesLast(print, { ...lastOwn, customWords: reordered })).toBe(true)
    const other = { en: { headline: 'How was tonight?', subline: '' } }
    expect(printMatchesLast(print, { ...lastOwn, customWords: other })).toBe(false)
  })
})
