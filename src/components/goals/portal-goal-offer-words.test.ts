import { describe, expect, it } from 'vitest'
import type { PortalGoalOffer } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { WORKED_OUT_TITLE, offerWords, workedOutWords } from './portal-goal-offer-words'
import {
  OFFER_NOVEMBER,
  OFFER_OCTOBER,
  OFFER_SCANS,
} from './portal-goal.stories.fixtures'

/** Seaview with Reception alone in the number, and no Portal joining later. */
const ONE_PORTAL: PortalGoalOffer = {
  ...OFFER_NOVEMBER,
  basis: {
    ...OFFER_NOVEMBER.basis,
    count: 11,
    portals: [{ name: 'Reception', count: 11, liveDays: 14 }],
  },
  newPortals: [],
}

describe('the ready card, in words', () => {
  it('a bit above your usual, about 34 a month, from 2 weeks at 2 portals', () => {
    expect(offerWords(OFFER_NOVEMBER)).toEqual({
      heading: 'Recommended for November',
      figure: { value: '40', unit: 'private ratings' },
      lead: 'A bit above your usual: about 34 a month, from the last 2 weeks at 2 portals.',
      countsFrom: null,
      newPortals:
        'Spa is new. Its ratings count from day one, and it joins the number once it has 2 weeks.',
      asksEveryGuest: true,
      use: 'Use 40',
      setToast: 'November goal set: 40 private ratings',
      door: { label: 'Change', measure: 'portal_rating_count' },
    })
  })

  it('one portal is singular', () => {
    expect(offerWords(ONE_PORTAL)).toMatchObject({
      lead: 'A bit above your usual: about 34 a month, from the last 2 weeks at 1 portal.',
      newPortals: null,
    })
    expect(workedOutWords(ONE_PORTAL).paragraphs[0]).toBe(
      'Reception brought in 11 private ratings in the 14 days to Oct 22.',
    )
  })

  it('names the new portal that joins later', () => {
    expect(offerWords(OFFER_NOVEMBER).newPortals).toBe(
      'Spa is new. Its ratings count from day one, and it joins the number once it has 2 weeks.',
    )
    const two = {
      ...OFFER_NOVEMBER,
      newPortals: [
        { name: 'Bar', liveDays: 3, joinsOn: '2026-11-03' },
        { name: 'Spa', liveDays: 8, joinsOn: '2026-10-29' },
      ],
    }
    expect(offerWords(two).newPortals).toBe(
      'Bar and Spa are new. Their ratings count from day one, and they join the number once they have 2 weeks.',
    )
  })

  it('offers the rest of this month with what already counts', () => {
    expect(offerWords(OFFER_OCTOBER)).toMatchObject({
      heading: 'Recommended for October',
      figure: { value: '24', unit: 'private ratings' },
      countsFrom: 'Counts from Oct 1 · 12 already count.',
      use: 'Use 24',
      setToast: 'October goal set: 24 private ratings',
    })
    expect(offerWords({ ...OFFER_OCTOBER, soFar: 1 }).countsFrom).toBe(
      'Counts from Oct 1 · 1 already counts.',
    )
    expect(offerWords({ ...OFFER_OCTOBER, soFar: null }).countsFrom).toBe(
      'Counts from Oct 1.',
    )
  })

  it('scans first when there are scans and no ratings', () => {
    expect(offerWords(OFFER_SCANS)).toEqual({
      heading: null,
      figure: null,
      lead: 'Your portals had 23 scans but no private ratings in the last 2 weeks. Start by counting scans: 55 scans in November.',
      countsFrom: null,
      newPortals: null,
      asksEveryGuest: false,
      use: 'Use 55 scans',
      setToast: 'November goal set: 55 scans',
      // P-2: scans come first, and private ratings are one tap away.
      door: { label: 'Set a private ratings number', measure: 'portal_rating_count' },
    })
  })
})

describe('how we worked this out', () => {
  it('the sums behind November: the basis, the whole month and the lift', () => {
    expect(WORKED_OUT_TITLE).toBe('How we worked this out')
    expect(workedOutWords(OFFER_NOVEMBER).paragraphs).toEqual([
      'Reception and Restaurant brought in 16 private ratings in the 14 days to Oct 22.',
      'At that pace, a 30-day month gets about 34: your usual. The recommendation is a bit more, rounded up: 40.',
    ])
  })

  it('the popover rows say live days and joins', () => {
    expect(workedOutWords(OFFER_NOVEMBER).rows).toEqual([
      'Reception · 11 in 14 days',
      'Restaurant · 5 in 14 days',
      'Spa · live 8 days, joins once it has 2 weeks',
    ])
    const lobby = {
      ...OFFER_NOVEMBER,
      newPortals: [{ name: 'Lobby', liveDays: 1, joinsOn: '2026-11-05' }],
    }
    expect(workedOutWords(lobby).rows.at(-1)).toBe(
      'Lobby · live 1 day, joins once it has 2 weeks',
    )
  })

  it('this month adds the days left to what already counts', () => {
    expect(workedOutWords(OFFER_OCTOBER).paragraphs[1]).toBe(
      '12 already count this month. At your usual, the 9 days left add about 10. A bit more, rounded up: 24.',
    )
  })

  it('a full basis is 4 weeks', () => {
    const fourWeeks = {
      ...OFFER_NOVEMBER,
      basis: { ...OFFER_NOVEMBER.basis, weeks: 4, days: 28 },
    } as const
    expect(workedOutWords(fourWeeks).paragraphs[0]).toBe(
      'Reception and Restaurant brought in 16 private ratings in the 4 weeks to Oct 22.',
    )
  })

  it('says how the measure counts, on the Property’s months', () => {
    expect(workedOutWords(OFFER_NOVEMBER).foot).toBe(
      'Low and high ratings count the same. Withdrawn ratings don’t count. Months follow Sofia time.',
    )
    expect(workedOutWords(OFFER_SCANS).foot).toBe(
      'The same visit counts once per portal in any 24 hours. Bots don’t count. Months follow Sofia time.',
    )
  })
})
