import { describe, expect, it } from 'vitest'
import { sourceDateWindow } from './source-date-window'

describe('sourceDateWindow', () => {
  it('has no bounds for no days', () => {
    expect(sourceDateWindow({ timezone: 'Europe/Sofia' })).toEqual({})
  })

  it('starts the first day and ends the last at midnight of the Property, not of UTC', () => {
    // Sofia is UTC+3 in summer: its 13 June begins at 21:00 UTC on the 12th, and
    // its 10 September ends at 20:59:59.999 UTC on the 10th.
    const window = sourceDateWindow({
      since: '2026-06-13',
      until: '2026-09-10',
      timezone: 'Europe/Sofia',
    })

    expect(window.sourceDateFrom?.toISOString()).toBe('2026-06-12T21:00:00.000Z')
    expect(window.sourceDateTo?.toISOString()).toBe('2026-09-10T20:59:59.999Z')
  })

  it('keeps a review just after local midnight inside the day it belongs to', () => {
    // 00:10 on 13 June in Sofia is 21:10 UTC on the 12th: the UTC date says the 12th.
    const review = new Date('2026-06-12T21:10:00.000Z')
    const window = sourceDateWindow({
      since: '2026-06-13',
      until: '2026-06-13',
      timezone: 'Europe/Sofia',
    })

    expect(review >= window.sourceDateFrom!).toBe(true)
    expect(review <= window.sourceDateTo!).toBe(true)
  })

  it('follows a daylight saving change: the day it moves is 23 hours long', () => {
    // New York springs forward on 8 March 2026: 00:00 EST (UTC-5) to the next
    // midnight in EDT (UTC-4).
    const window = sourceDateWindow({
      since: '2026-03-08',
      until: '2026-03-08',
      timezone: 'America/New_York',
    })

    expect(window.sourceDateFrom?.toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(window.sourceDateTo?.toISOString()).toBe('2026-03-09T03:59:59.999Z')
  })

  it('crosses a month and a year end for the day after the last day', () => {
    const window = sourceDateWindow({
      since: '2026-12-31',
      until: '2026-12-31',
      timezone: 'Pacific/Auckland',
    })

    // Auckland is UTC+13 on that day.
    expect(window.sourceDateFrom?.toISOString()).toBe('2026-12-30T11:00:00.000Z')
    expect(window.sourceDateTo?.toISOString()).toBe('2026-12-31T10:59:59.999Z')
  })

  it('reads the days in UTC when no Property is named', () => {
    const window = sourceDateWindow({
      since: '2026-06-13',
      until: '2026-06-13',
      timezone: null,
    })

    expect(window.sourceDateFrom?.toISOString()).toBe('2026-06-13T00:00:00.000Z')
    expect(window.sourceDateTo?.toISOString()).toBe('2026-06-13T23:59:59.999Z')
  })

  it('bounds one side when only one day is named', () => {
    expect(
      Object.keys(sourceDateWindow({ since: '2026-06-13', timezone: 'Europe/Sofia' })),
    ).toEqual(['sourceDateFrom'])
    expect(
      Object.keys(sourceDateWindow({ until: '2026-06-13', timezone: 'Europe/Sofia' })),
    ).toEqual(['sourceDateTo'])
  })

  it('refuses something that is not a day', () => {
    expect(() => sourceDateWindow({ since: 'June', timezone: null })).toThrow(RangeError)
  })
})
