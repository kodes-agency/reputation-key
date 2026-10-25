import { describe, expect, it } from 'vitest'
import type { PrintFinalWordsFit } from './portal-print-final-words-fit'
import {
  printFinalCheckedAgainst,
  printFinalEveryCardLine,
  printFinalHeadlineCounter,
  printFinalHeadlineStatus,
  printFinalLanguageHeading,
  printFinalMenuReason,
  printFinalNoWordingNote,
  printFinalPickedTooLong,
  printFinalSecondStatus,
  printFinalSublineStatus,
} from './portal-print-final-words-copy'

const fit = (over: Partial<PrintFinalWordsFit> = {}): PrintFinalWordsFit => ({
  state: 'full',
  headlinePt: 19,
  headlineLines: 2,
  sublineLines: 1,
  otherRefused: false,
  steppedForOther: false,
  secondMode: 'one',
  secondRefused: false,
  secondSublineLines: 0,
  ...over,
})

const uprightTent = { piece: 'tent', orientation: 'upright', look: 'paper' } as const
const wideTent = { ...uprightTent, orientation: 'wide' } as const

describe('the menu’s words (spec 5.5)', () => {
  it('names the print it checked', () => {
    expect(printFinalCheckedAgainst(uprightTent, 'letter', ['en', 'es'])).toBe(
      'upright Paper tents · Letter · English, then Español',
    )
  })

  it('says why a wording is greyed', () => {
    expect(
      printFinalMenuReason(
        { preset: 'how_was_visit', state: 'too_long', heldIn: null },
        uprightTent,
        ['en', 'es'],
      ),
    ).toBe('Too long for upright Paper tents with two languages')
    expect(
      printFinalMenuReason(
        { preset: 'got_30_seconds', state: 'held', heldIn: 'fr' },
        uprightTent,
        ['fr'],
      ),
    ).toBe('Not available in Français yet')
  })

  it('says once when no wording fits, and what helps', () => {
    expect(
      printFinalNoWordingNote({ ...uprightTent, look: 'immersive' }, 'a4', ['es', 'en']),
    ).toBe(
      'No wording fits upright Immersive tents on A4 with Español first. Choose Wide, put English first, or write your own shorter words.',
    )
  })

  it('keeps a picked wording that stopped fitting, with its reason', () => {
    expect(
      printFinalPickedTooLong('How was your visit?', uprightTent, ['en', 'es']),
    ).toEqual({
      reason:
        '“How was your visit?” is too long for upright Paper tents with two languages.',
      help: 'Pick another wording, choose Wide, or write your own.',
    })
  })
})

describe('the fields’ statuses (spec 5.7)', () => {
  it('reads every row of the table', () => {
    expect(printFinalHeadlineStatus(wideTent, fit(), null, 26, 1).text).toBe(
      'Fits at full size (19 pt)',
    )
    expect(
      printFinalHeadlineStatus(
        wideTent,
        fit({ state: 'step', headlinePt: 17 }),
        null,
        34,
        1,
      ).text,
    ).toBe('Prints at 17 pt')
    expect(
      printFinalHeadlineStatus(
        wideTent,
        fit({ state: 'step', headlinePt: 18, steppedForOther: true }),
        null,
        28,
        1,
      ).text,
    ).toBe('Prints at 18 pt, the size upright tents need')
    expect(
      printFinalHeadlineStatus(
        wideTent,
        fit({ state: 'step', headlinePt: 16.5, otherRefused: true }),
        null,
        48,
        1,
      ),
    ).toEqual({
      tone: 'neutral',
      text: 'Prints at 16.5 pt',
      extra: 'Too long for upright tents.',
    })
    expect(
      printFinalHeadlineStatus(
        uprightTent,
        fit({ state: 'refused', headlinePt: 16.5 }),
        11,
        48,
        1,
      ),
    ).toEqual({
      tone: 'negative',
      text: 'Too long for an upright tent, even at the smallest size (16.5 pt). Shorten by about 11 characters.',
      extra: 'Wide tents take it.',
    })
  })

  it('counts against the guide, never a limit', () => {
    expect(printFinalHeadlineCounter(wideTent, 26, 1, false)).toBe(
      '26 characters · guide 30 on a tent',
    )
    expect(printFinalHeadlineCounter(wideTent, 14, 2, false)).toBe(
      '14 characters · guide 15 with two languages',
    )
    expect(printFinalHeadlineCounter(wideTent, 26, 1, true)).toBe('26 · guide 30')
  })

  it('says how the sub-line and the second headline print', () => {
    expect(printFinalSublineStatus(16, fit()).text).toBe('Fits on one line')
    expect(printFinalSublineStatus(36, fit({ sublineLines: 2 })).text).toBe(
      'Wraps to two lines',
    )
    expect(printFinalSublineStatus(0, fit()).text).toBe('No sub-line: the words close up')
    expect(printFinalSecondStatus(fit({ secondMode: 'line' }), 'en', 9).text).toBe(
      'Fits as one small line under the English',
    )
    expect(printFinalSecondStatus(fit({ secondMode: 'stack' }), 'en', 12.5).text).toBe(
      'Fits (12.5 pt, under a short rule)',
    )
    expect(printFinalLanguageHeading('es', 1)).toBe(
      'Español · prints smaller, under a short rule',
    )
  })

  it('lists each card and orientation', () => {
    expect(
      printFinalEveryCardLine(
        {
          piece: 'tent',
          orientation: 'upright',
          state: 'full',
          headlinePt: 19,
          secondMode: 'line',
        },
        ['en', 'es'],
      ),
    ).toEqual({
      name: 'Table tent, upright',
      detail: 'full size; Español as one small line',
    })
  })
})
