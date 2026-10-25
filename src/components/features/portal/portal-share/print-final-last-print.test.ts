import { describe, expect, it } from 'vitest'
import type { PortalPrintKitLastPrint } from '#/contexts/portal/application/public-api'
import type { PrintFinalLastSettings } from '#/shared/domain/portal-print-final-last'
import { printFinalLastNotice } from './print-final-last-print'

const NOW = new Date('2026-10-25T12:00:00.000Z')

const SETTINGS: PrintFinalLastSettings = {
  piece: 'tent',
  orientation: 'wide',
  look: 'paper',
  paper: 'letter',
  printer: 'my_printer',
  quantity: 10,
  fillSpares: false,
  perSheet: null,
  cropMarks: false,
  backPage: false,
  languages: ['en', 'es'],
  callToAction: 'how_did_we_do',
}

const last = (
  settings: Partial<PrintFinalLastSettings> = {},
  photo: PortalPrintKitLastPrint['photo'] = { kind: 'same' },
  printedAt = '2026-10-12T12:00:00.000Z',
): PortalPrintKitLastPrint => ({
  printedAt,
  settings: { ...SETTINGS, ...settings },
  photo,
})

const notice = (print: PortalPrintKitLastPrint) => printFinalLastNotice(print, NOW, 'UTC')

describe('printFinalLastNotice', () => {
  it('says what was printed and when, as the board’s Paper tents do', () => {
    expect(notice(last())).toEqual({
      title:
        'Last printed Oct 12 · 10 Paper table tents, wide, on Letter, English + Español',
      photoLine: null,
    })
  })

  it('leaves the language out when the print had one, as the board’s Immersive cards do', () => {
    expect(
      notice(
        last({
          piece: 'counter',
          orientation: 'upright',
          look: 'immersive',
          languages: ['en'],
        }),
      ).title,
    ).toBe('Last printed Oct 12 · 10 Immersive Counter cards, upright, on Letter')
  })

  it('counts one piece in the singular and names the paper it was made for', () => {
    expect(
      notice(last({ piece: 'small', quantity: 1, paper: 'a4', languages: ['bg'] })).title,
    ).toBe('Last printed Oct 12 · 1 Paper Small card, wide, on A4')
  })

  it('says a print shop’s file is one piece a page, whatever the quantity field held', () => {
    expect(
      notice(
        last({
          piece: 'counter',
          orientation: 'upright',
          printer: 'print_shop',
          quantity: 40,
          languages: ['en'],
        }),
      ).title,
    ).toBe(
      'Last printed Oct 12 · Paper Counter card for a print shop, upright, on Letter',
    )
  })

  it('names the year of a print that was made in an earlier one', () => {
    expect(notice(last({}, { kind: 'same' }, '2025-12-30T12:00:00.000Z')).title).toMatch(
      /^Last printed Dec 30, 2025 · /u,
    )
  })

  it('has nothing to say of a photo that did not change', () => {
    expect(notice(last({ look: 'immersive' }, { kind: 'same' })).photoLine).toBeNull()
  })

  it('says the day a new photo was added, and that printing again uses it', () => {
    expect(
      notice(
        last({ look: 'immersive' }, { kind: 'changed', on: '2026-10-20T08:00:00.000Z' }),
      ).photoLine,
    ).toBe('Your photo changed on Oct 20. Printing again uses the new one.')
  })

  it('says the photo changed since, when there is no day to name', () => {
    expect(
      notice(last({ look: 'immersive' }, { kind: 'changed', on: null })).photoLine,
    ).toBe('Your photo changed since. Printing again uses the new one.')
  })

  it('says a photo that was taken off is gone from the next print', () => {
    expect(notice(last({ look: 'immersive' }, { kind: 'removed' })).photoLine).toBe(
      'Your photo was removed since. Printing again prints without it.',
    )
  })

  it('never uses the words the final kit retires', () => {
    const { title, photoLine } = notice(
      last(
        { look: 'immersive', printer: 'print_shop', piece: 'counter' },
        {
          kind: 'changed',
          on: null,
        },
      ),
    )

    expect(`${title} ${photoLine}`).not.toMatch(
      /\b(piece|output|bleed|100K|Large|Mini)\b/u,
    )
  })
})
