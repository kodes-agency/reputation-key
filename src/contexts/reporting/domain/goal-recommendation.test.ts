import { describe, expect, it } from 'vitest'
import { propertyWallClockToInstant } from '#/shared/domain/property-calendar'
import { addLocalDays } from './local-days'
import {
  recommendationWindow,
  recommendPortalGoal,
  subjectRecommendation,
} from './goal-recommendation'
import type {
  PortalGoalMeasure,
  RecommendationDayCount,
  RecommendationPortal,
  RecommendPortalGoalInput,
} from './goal-recommendation-types'

const SOFIA = 'Europe/Sofia'
/** When both goal measures' versions took effect: Aug 1, 03:00 in Sofia. */
const VERSION_FROM = new Date('2026-08-01T00:00:00.000Z')

/** An instant at a local hour of a Sofia day. */
function inSofia(localDay: string, hour = 12, minute = 0): Date {
  const [year = 0, month = 1, day = 1] = localDay.split('-').map(Number)
  return propertyWallClockToInstant(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    SOFIA,
  )
}

/** Every local day from `first` to `last`, both included. */
function daysFrom(first: string, last: string): readonly string[] {
  const days: string[] = []
  for (let day = first; day <= last; day = addLocalDays(day, 1)) days.push(day)
  return days
}

/** A published Portal live since a local day, its code made that day. */
function livePortal(
  name: string,
  liveDay: string,
  patch: Partial<RecommendationPortal> = {},
): RecommendationPortal {
  const since = inSofia(liveDay, 10)
  return {
    portalId: `portal-${name.toLowerCase()}`,
    name,
    publicationState: 'published',
    liveSince: since,
    liveIntervals: [{ from: since, to: null }],
    codeIssuedAt: since,
    codeReady: true,
    portalGroupId: null,
    ...patch,
  }
}

/** `total` readings spread one a day over `days`, the rest on the last day. */
function spread(
  portalId: string | null,
  measure: PortalGoalMeasure,
  days: readonly string[],
  total: number,
): readonly RecommendationDayCount[] {
  return days.flatMap((localDay, index) => {
    const isLast = index === days.length - 1
    const count = isLast
      ? total - Math.min(total, days.length - 1)
      : index < total
        ? 1
        : 0
    return count > 0 ? [{ portalId, measure, localDay, count }] : []
  })
}

function recommend(patch: Partial<RecommendPortalGoalInput>) {
  return recommendPortalGoal({
    now: inSofia('2026-10-23'),
    timezone: SOFIA,
    versionFrom: VERSION_FROM,
    portals: [],
    truncated: false,
    days: [],
    unreadable: [],
    lastScanAt: new Map(),
    ...patch,
  })
}

/** Seaview on Oct 23: Reception and Restaurant live Oct 9, Spa Oct 15 (G1). */
const SEAVIEW_PORTALS = [
  livePortal('Reception', '2026-10-09'),
  livePortal('Restaurant', '2026-10-09'),
  livePortal('Spa', '2026-10-15'),
]
const TWO_WEEKS = daysFrom('2026-10-09', '2026-10-22')
const SEAVIEW_RATINGS = [
  ...spread('portal-reception', 'portal_rating_count', TWO_WEEKS, 11),
  ...spread('portal-restaurant', 'portal_rating_count', TWO_WEEKS, 5),
]

describe('the recommended number for a monthly portal goal', () => {
  it('names its basis: 28 days ending yesterday, 14 live days to join', () => {
    expect(recommendationWindow(inSofia('2026-10-23'), SOFIA)).toEqual({
      today: '2026-10-23',
      firstDay: '2026-09-25',
      lastDay: '2026-10-22',
      start: inSofia('2026-09-25', 0),
      end: inSofia('2026-10-23', 0),
    })

    const thirteen = recommend({
      portals: [livePortal('Reception', '2026-10-10')],
      days: spread('portal-reception', 'portal_rating_count', TWO_WEEKS.slice(1), 9),
    })
    const fourteen = recommend({
      portals: [livePortal('Reception', '2026-10-09')],
      days: spread('portal-reception', 'portal_rating_count', TWO_WEEKS, 9),
    })

    expect(thirteen.window).toEqual({ firstDay: '2026-09-25', lastDay: '2026-10-22' })
    expect(thirteen.portals[0]).toMatchObject({ liveDays: 13, inBasis: false })
    expect(thirteen.state).toBe('getting_ready')
    expect(fourteen.portals[0]).toMatchObject({ liveDays: 14, inBasis: true })
    expect(fourteen.state).toBe('ready')
  })

  it('Seaview on Oct 23: 11 and 5 in 14 live days give 35 · 40 · 45 for November, 40 recommended', () => {
    const seaview = recommend({ portals: SEAVIEW_PORTALS, days: SEAVIEW_RATINGS })

    expect(seaview.state).toBe('ready')
    expect(seaview.defaultMeasure).toBe('portal_rating_count')
    expect(seaview.defaultMonthKey).toBe('2026-11')
    expect(seaview.months.next).toEqual({ key: '2026-11', days: 30 })
    expect(seaview.basis).toEqual({
      portals: 2,
      weeks: 2,
      counts: { portal_rating_count: 16, qualified_scans: 0 },
    })
    const ratings = seaview.measures.portal_rating_count
    expect(ratings.state).toBe('ready')
    // 16 in 14 days over 30 days is 480/14: about 34.
    expect(ratings.usualPerMonth.next).toEqual({ num: '240', den: '7' })
    expect(ratings.fullMonth.next).toEqual({
      usual: 35,
      aBitMore: 40,
      stretch: 45,
      about: 34,
    })
    expect(seaview.portals.map((portal) => [portal.name, portal.joinsOn])).toEqual([
      ['Reception', null],
      ['Restaurant', null],
      ['Spa', '2026-10-29'],
    ])
  })

  it('this month from today: 12 so far plus a bit more than the usual for the 9 days left gives 23 · 24 · 25', () => {
    // 32 ratings in 28 live days is the same 16-in-14 usual; 12 of them in October.
    const reception = livePortal('Reception', '2026-09-01')
    const ratings = [
      ...spread(
        'portal-reception',
        'portal_rating_count',
        daysFrom('2026-09-25', '2026-09-30'),
        20,
      ),
      ...spread(
        'portal-reception',
        'portal_rating_count',
        daysFrom('2026-10-01', '2026-10-22'),
        12,
      ),
    ]

    const october = recommend({ portals: [reception], days: ratings })

    expect(october.months.current).toEqual({
      key: '2026-10',
      days: 31,
      daysLeftWithToday: 9,
    })
    expect(october.monthToDate.portal_rating_count).toBe(12)
    expect(october.measures.portal_rating_count.fromToday).toEqual({
      usual: 23,
      aBitMore: 24,
      stretch: 25,
      // What the 9 days left add at the usual.
      about: 10,
    })
    // The usual the 23 stands for, exact: the 12 so far and 8 / 7 a day for the
    // 9 days left, 156 / 7 (about 22.29). An own number for October is measured
    // against it, not against the whole month's 248 / 7.
    expect(october.measures.portal_rating_count.usualFromToday).toEqual({
      num: '156',
      den: '7',
    })
    expect(october.measures.portal_rating_count.fullMonth.next).toMatchObject({
      usual: 35,
      aBitMore: 40,
      stretch: 45,
    })
  })

  it('never offers a number at or below what already counts', () => {
    // 2 in 28 days is a slow usual; 40 already count this month.
    const reception = livePortal('Reception', '2026-09-01')
    const ratings = [
      {
        portalId: 'portal-reception',
        measure: 'portal_rating_count',
        localDay: '2026-09-26',
        count: 2,
      },
      {
        portalId: null,
        measure: 'portal_rating_count',
        localDay: '2026-10-21',
        count: 40,
      },
    ] as const

    const october = recommend({ portals: [reception], days: ratings })

    expect(october.monthToDate.portal_rating_count).toBe(40)
    expect(october.measures.portal_rating_count.fromToday).toEqual({
      usual: 45,
      aBitMore: 50,
      stretch: 55,
      about: 1,
    })
  })

  it('a portal under 14 live days counts toward the month but not the rate', () => {
    const spaRatings = spread(
      'portal-spa',
      'portal_rating_count',
      daysFrom('2026-10-15', '2026-10-22'),
      30,
    )

    const seaview = recommend({
      portals: SEAVIEW_PORTALS,
      days: [...SEAVIEW_RATINGS, ...spaRatings],
    })

    expect(seaview.monthToDate.portal_rating_count).toBe(46)
    expect(seaview.basis?.counts.portal_rating_count).toBe(16)
    expect(seaview.measures.portal_rating_count.fullMonth.next).toMatchObject({
      aBitMore: 40,
    })
    expect(seaview.portals[2]).toMatchObject({
      name: 'Spa',
      liveDays: 8,
      inBasis: false,
      window: { portal_rating_count: 30, qualified_scans: 0 },
      monthToDate: { portal_rating_count: 30, qualified_scans: 0 },
    })
  })

  it('getting ready until a portal has 14 live days, ready on the 15th local day', () => {
    const reception = livePortal('Reception', '2026-10-09')
    const ratings = spread(
      'portal-reception',
      'portal_rating_count',
      daysFrom('2026-10-09', '2026-10-16'),
      6,
    )

    const early = recommend({
      now: inSofia('2026-10-17'),
      portals: [reception],
      days: ratings,
    })

    expect(early.window).toEqual({ firstDay: '2026-09-19', lastDay: '2026-10-16' })
    expect(early.state).toBe('getting_ready')
    expect(early.readyOn).toBe('2026-10-23')
    expect(early.defaultMonthKey).toBe('2026-10')
    expect(early.basis).toBeNull()
    expect(early.measures.portal_rating_count).toEqual({
      state: 'nothing',
      usualPerMonth: { current: null, next: null },
      fullMonth: { current: null, next: null },
      fromToday: null,
      usualFromToday: null,
    })
    expect(early.portals[0]).toMatchObject({
      liveSince: '2026-10-09',
      liveDays: 8,
      joinsOn: '2026-10-23',
    })

    const ready = recommend({
      now: inSofia('2026-10-23'),
      portals: [reception],
      days: ratings,
    })
    expect(ready.state).toBe('ready')
    expect(ready.readyOn).toBeNull()
  })

  it('Dec 1 check-in: 34 in 4 weeks give 40 · 45 · 50 for a 31-day December', () => {
    const portals = [
      livePortal('Reception', '2026-10-09'),
      livePortal('Restaurant', '2026-10-09'),
      livePortal('Spa', '2026-10-15'),
    ]
    const november = daysFrom('2026-11-03', '2026-11-30')

    const check = recommend({
      now: inSofia('2026-12-01', 9),
      portals,
      days: spread('portal-reception', 'portal_rating_count', november, 34),
    })

    expect(check.window).toEqual({ firstDay: '2026-11-03', lastDay: '2026-11-30' })
    expect(check.defaultMonthKey).toBe('2026-12')
    expect(check.basis).toMatchObject({ portals: 3, weeks: 4 })
    expect(check.months.current).toEqual({
      key: '2026-12',
      days: 31,
      daysLeftWithToday: 31,
    })
    expect(check.measures.portal_rating_count.fullMonth.current).toEqual({
      usual: 40,
      aBitMore: 45,
      stretch: 50,
      about: 38,
    })
  })

  it('scans but no private ratings offers scans first: 50 · 55 · 60', () => {
    const scans = spread('portal-reception', 'qualified_scans', TWO_WEEKS, 23)

    const scansOnly = recommend({
      portals: [livePortal('Reception', '2026-10-09')],
      days: scans,
    })

    expect(scansOnly.state).toBe('scans_only')
    expect(scansOnly.defaultMeasure).toBe('qualified_scans')
    expect(scansOnly.measures.portal_rating_count.state).toBe('nothing')
    expect(scansOnly.measures.qualified_scans.fullMonth.next).toEqual({
      usual: 50,
      aBitMore: 55,
      stretch: 60,
      about: 49,
    })
  })

  it('ratings unreadable, scans ready: unreadable, with scan choices kept', () => {
    const recommendation = recommend({
      portals: [livePortal('Reception', '2026-10-09')],
      days: [
        ...spread('portal-reception', 'portal_rating_count', TWO_WEEKS, 11),
        ...spread('portal-reception', 'qualified_scans', TWO_WEEKS, 23),
      ],
      unreadable: [
        {
          portalId: 'portal-reception',
          measure: 'portal_rating_count',
          localDay: '2026-10-12',
        },
      ],
    })

    expect(recommendation.state).toBe('unreadable')
    expect(recommendation.monthToDate).toEqual({
      portal_rating_count: null,
      qualified_scans: 23,
    })
    expect(recommendation.measures.portal_rating_count).toEqual({
      state: 'unreadable',
      usualPerMonth: { current: null, next: null },
      fullMonth: { current: null, next: null },
      fromToday: null,
      usualFromToday: null,
    })
    expect(recommendation.measures.qualified_scans.state).toBe('ready')
    expect(recommendation.measures.qualified_scans.fullMonth.next).toMatchObject({
      aBitMore: 55,
    })
  })

  it('a reading that cannot be trusted this month spoils the month so far, whatever its portal', () => {
    const seaview = recommend({
      portals: SEAVIEW_PORTALS,
      days: SEAVIEW_RATINGS,
      unreadable: [
        { portalId: null, measure: 'portal_rating_count', localDay: '2026-10-02' },
      ],
    })

    expect(seaview.state).toBe('unreadable')
    expect(seaview.monthToDate.portal_rating_count).toBeNull()
    expect(seaview.measures.portal_rating_count.state).toBe('unreadable')
    expect(seaview.measures.portal_rating_count.fromToday).toBeNull()
  })

  it('one on a live day of a joined portal in the basis spoils the rate, the month still read', () => {
    // Reception live since Sep 1, so Sep 27 is one of its live days in the basis.
    const october = recommend({
      portals: [livePortal('Reception', '2026-09-01')],
      days: [
        ...spread(
          'portal-reception',
          'portal_rating_count',
          daysFrom('2026-09-25', '2026-09-30'),
          20,
        ),
        ...spread(
          'portal-reception',
          'portal_rating_count',
          daysFrom('2026-10-01', '2026-10-22'),
          12,
        ),
      ],
      unreadable: [
        {
          portalId: 'portal-reception',
          measure: 'portal_rating_count',
          localDay: '2026-09-27',
        },
      ],
    })

    expect(october.state).toBe('unreadable')
    expect(october.measures.portal_rating_count.fullMonth.next).toBeNull()
    expect(october.monthToDate.portal_rating_count).toBe(12)
  })

  it('one last month that the rate leaves out keeps the measure ready', () => {
    // On Oct 23 the basis starts Sep 25. Sep 28 is before Reception went live,
    // and the other two readings have no portal the rate reads.
    const seaview = recommend({
      portals: SEAVIEW_PORTALS,
      days: SEAVIEW_RATINGS,
      unreadable: [
        { portalId: null, measure: 'portal_rating_count', localDay: '2026-09-28' },
        {
          portalId: 'portal-archived',
          measure: 'portal_rating_count',
          localDay: '2026-09-29',
        },
        {
          portalId: 'portal-reception',
          measure: 'portal_rating_count',
          localDay: '2026-09-28',
        },
      ],
    })

    expect(seaview.state).toBe('ready')
    expect(seaview.monthToDate.portal_rating_count).toBe(16)
    expect(seaview.measures.portal_rating_count.fullMonth.next).toMatchObject({
      usual: 35,
      aBitMore: 40,
      stretch: 45,
    })
  })

  it('a measure with nothing counted offers no number', () => {
    const quiet = recommend({ portals: [livePortal('Reception', '2026-10-03')] })

    expect(quiet.state).toBe('nothing_counted')
    expect(quiet.basis).toMatchObject({ portals: 1, weeks: 2 })
    expect(quiet.portals[0]?.liveDays).toBe(20)
    for (const measure of ['portal_rating_count', 'qualified_scans'] as const) {
      expect(quiet.measures[measure]).toEqual({
        state: 'nothing',
        usualPerMonth: { current: null, next: null },
        fullMonth: { current: null, next: null },
        fromToday: null,
        usualFromToday: null,
      })
    }
  })

  it('each choice is at least one step above the one before', () => {
    // On Oct 11, 21 days of October are left with today; nothing has counted
    // in October yet, and Reception has been live 20 days.
    const reception = livePortal('Reception', '2026-09-21')
    const september = daysFrom('2026-09-21', '2026-09-30')
    const choicesFor = (ratings: number) =>
      recommend({
        now: inSofia('2026-10-11'),
        portals: [reception],
        days: spread('portal-reception', 'portal_rating_count', september, ratings),
      }).measures.portal_rating_count.fromToday

    // 26 in 20 days over 21 days is 27.3: 30.03 rounds to 35, and 32.76 to 35 too.
    expect(choicesFor(26)).toMatchObject({ usual: 28, aBitMore: 35, stretch: 40 })
    // 2 in 20 days over 21 days is 2.1: all three round to 3.
    expect(choicesFor(2)).toMatchObject({ usual: 3, aBitMore: 4, stretch: 5 })
  })

  it('a disable of two days keeps the live days it had', () => {
    const reception = livePortal('Reception', '2026-10-01', {
      liveSince: inSofia('2026-10-13', 9),
      liveIntervals: [
        { from: inSofia('2026-10-01', 10), to: inSofia('2026-10-10', 14) },
        { from: inSofia('2026-10-13', 9), to: null },
      ],
    })

    const recommendation = recommend({ portals: [reception] })

    expect(recommendation.portals[0]).toMatchObject({
      liveSince: '2026-10-13',
      liveDays: 20,
      inBasis: true,
    })
  })

  it('counts live days on the Property calendar across the October DST change', () => {
    // Oct 25 has 25 hours in Sofia; the 28 days ending Nov 4 still hold it once.
    const recommendation = recommend({
      now: inSofia('2026-11-05', 1),
      portals: [livePortal('Reception', '2026-09-01')],
      days: [
        {
          portalId: 'portal-reception',
          measure: 'qualified_scans',
          localDay: '2026-10-25',
          count: 2,
        },
      ],
    })

    expect(recommendation.window).toEqual({
      firstDay: '2026-10-08',
      lastDay: '2026-11-04',
    })
    expect(recommendation.portals[0]).toMatchObject({
      liveDays: 28,
      window: { portal_rating_count: 0, qualified_scans: 2 },
    })
  })

  it('a portal live before Aug 1 joins only from Aug 1', () => {
    const recommendation = recommend({
      now: inSofia('2026-08-10'),
      portals: [livePortal('Reception', '2026-07-01')],
    })

    expect(recommendation.window).toEqual({
      firstDay: '2026-07-13',
      lastDay: '2026-08-09',
    })
    expect(recommendation.portals[0]).toMatchObject({ liveDays: 9, inBasis: false })
    expect(recommendation.state).toBe('getting_ready')
    expect(recommendation.readyOn).toBe('2026-08-15')
  })

  it('portals come in name order, never by count', () => {
    const recommendation = recommend({
      portals: SEAVIEW_PORTALS,
      days: [
        ...spread('portal-reception', 'portal_rating_count', TWO_WEEKS, 2),
        ...spread('portal-restaurant', 'portal_rating_count', TWO_WEEKS, 14),
        ...spread('portal-spa', 'portal_rating_count', TWO_WEEKS.slice(6), 8),
      ],
    })

    expect(recommendation.portals.map((portal) => portal.name)).toEqual([
      'Reception',
      'Restaurant',
      'Spa',
    ])
  })

  it('the month default is this month to the 20th, then next', () => {
    const on = (localDay: string, hour = 12) =>
      recommend({ now: inSofia(localDay, hour) }).defaultMonthKey

    expect(on('2026-10-20', 23)).toBe('2026-10')
    expect(on('2026-10-21', 0)).toBe('2026-11')
  })
})

describe('what the recommendation says about each portal', () => {
  it('counts readings with no portal, and those of portals it does not list, in the month and in elsewhere', () => {
    const recommendation = recommend({
      portals: SEAVIEW_PORTALS,
      days: [
        ...SEAVIEW_RATINGS,
        {
          portalId: null,
          measure: 'portal_rating_count',
          localDay: '2026-10-12',
          count: 3,
        },
        // An archived Portal: Portal does not list it.
        {
          portalId: 'portal-terrace',
          measure: 'portal_rating_count',
          localDay: '2026-10-14',
          count: 2,
        },
      ],
    })

    expect(recommendation.monthToDate.portal_rating_count).toBe(21)
    expect(recommendation.elsewhere).toEqual({
      portal_rating_count: 5,
      qualified_scans: 0,
    })
    expect(recommendation.windowTotals).toEqual({
      portal_rating_count: 21,
      qualified_scans: 0,
    })
    expect(recommendation.basis?.counts.portal_rating_count).toBe(16)
  })

  it('lists drafts apart and keeps a disabled portal out of the rate, its readings elsewhere', () => {
    const recommendation = recommend({
      portals: [
        livePortal('Bar', '2026-09-01', {
          publicationState: 'disabled',
          liveSince: null,
          liveIntervals: [{ from: inSofia('2026-09-01'), to: inSofia('2026-10-20') }],
        }),
        livePortal('Lobby', '2026-10-01', {
          publicationState: 'draft',
          liveSince: null,
          liveIntervals: [],
        }),
        livePortal('Reception', '2026-10-09'),
      ],
      days: [
        ...SEAVIEW_RATINGS.filter((row) => row.portalId === 'portal-reception'),
        ...spread('portal-bar', 'portal_rating_count', TWO_WEEKS.slice(0, 10), 7),
      ],
    })

    expect(recommendation.drafts).toEqual([{ portalId: 'portal-lobby', name: 'Lobby' }])
    expect(recommendation.portals.map((portal) => portal.name)).toEqual([
      'Bar',
      'Reception',
    ])
    expect(recommendation.portals[0]).toMatchObject({
      publicationState: 'disabled',
      liveSince: null,
      inBasis: false,
      joinsOn: null,
    })
    expect(recommendation.basis).toMatchObject({ portals: 1 })
    expect(recommendation.elsewhere.portal_rating_count).toBe(7)
  })

  it('no live portal before one is published', () => {
    const recommendation = recommend({
      portals: [
        livePortal('Lobby', '2026-10-01', {
          publicationState: 'draft',
          liveSince: null,
          liveIntervals: [],
        }),
      ],
    })

    expect(recommendation.state).toBe('no_live_portal')
    expect(recommendation.readyOn).toBeNull()
    expect(recommendation.portals).toEqual([])
  })

  it('marks the steps and the quiet facts of each portal', () => {
    const spaCode = inSofia('2026-10-06', 11)
    const recommendation = recommend({
      portals: [
        livePortal('Reception', '2026-10-09'),
        livePortal('Spa', '2026-10-15', { codeIssuedAt: spaCode }),
      ],
      days: spread('portal-reception', 'qualified_scans', TWO_WEEKS, 28),
      lastScanAt: new Map([['portal-reception', inSofia('2026-10-22', 18)]]),
    })

    expect(recommendation.portals[0]).toMatchObject({
      codeMadeOn: '2026-10-09',
      firstScan: true,
      lastScanOn: '2026-10-22',
      noScanSinceCodeDays: null,
      noScansSince: null,
    })
    expect(recommendation.portals[1]).toMatchObject({
      codeMadeOn: '2026-10-06',
      firstScan: false,
      lastScanOn: null,
      noScanSinceCodeDays: 17,
    })
  })

  it('says a busy portal has gone quiet', () => {
    const recommendation = recommend({
      now: inSofia('2026-11-21'),
      portals: [livePortal('Spa', '2026-09-01')],
      days: spread(
        'portal-spa',
        'qualified_scans',
        daysFrom('2026-10-24', '2026-11-15'),
        35,
      ),
      lastScanAt: new Map([['portal-spa', inSofia('2026-11-15', 20)]]),
    })

    expect(recommendation.portals[0]?.noScansSince).toEqual({
      since: '2026-11-15',
      // 35 scans in 28 live days is 8.75 a week.
      usualPerWeek: 9,
    })
  })

  it('carries the read as it was asked: when, where, and whether the list was cut', () => {
    const recommendation = recommend({ truncated: true })

    expect(recommendation).toMatchObject({
      asOf: '2026-10-23T09:00:00.000Z',
      timezone: SOFIA,
      truncated: true,
    })
  })
})

describe('the recommended number for one portal or one group (PG-20)', () => {
  // Nov 22: the month offered is December (31 days); November has 9 days left.
  const months = recommend({ now: inSofia('2026-11-22') }).months
  const reception = {
    window: { portal_rating_count: 9, qualified_scans: 0 },
    liveDays: 14,
  }
  const spa = { window: { portal_rating_count: 4, qualified_scans: 0 }, liveDays: 14 }
  const nothingSoFar = { portal_rating_count: 0, qualified_scans: 0 }

  it("a portal's own 9 in 14 days gives 20 · 22 · 24 for December", () => {
    const own = subjectRecommendation({
      members: [reception],
      monthToDate: nothingSoFar,
      unreadable: new Set(),
      months,
    })

    expect(own.portal_rating_count.state).toBe('ready')
    expect(own.portal_rating_count.fullMonth.next).toMatchObject({
      usual: 20,
      aBitMore: 22,
      stretch: 24,
    })
    // No scans: no number for scans.
    expect(own.qualified_scans).toMatchObject({ state: 'nothing', fromToday: null })
  })

  it("a group's rate is its members' summed, on top of its own month so far", () => {
    const group = subjectRecommendation({
      members: [reception, spa],
      monthToDate: { portal_rating_count: 12, qualified_scans: 0 },
      unreadable: new Set(),
      months,
    })

    // 13 in 14 days: about 29 in December's 31.
    expect(group.portal_rating_count.fullMonth.next?.about).toBe(29)
    // 12 so far, and the 9 days left with today add about 8.
    expect(group.portal_rating_count.fromToday).toMatchObject({ about: 8 })
    expect(group.portal_rating_count.fromToday?.usual).toBeGreaterThan(12)
  })

  it('no joined member, or an unreadable measure, offers no number', () => {
    const none = subjectRecommendation({
      members: [],
      monthToDate: nothingSoFar,
      unreadable: new Set(),
      months,
    })
    const spoiled = subjectRecommendation({
      members: [reception],
      monthToDate: nothingSoFar,
      unreadable: new Set(['portal_rating_count']),
      months,
    })

    expect(none.portal_rating_count).toMatchObject({ state: 'nothing', fromToday: null })
    expect(spoiled.portal_rating_count).toMatchObject({
      state: 'unreadable',
      fullMonth: { current: null, next: null },
    })
  })
})
