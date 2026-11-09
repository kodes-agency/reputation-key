import { describe, expect, it } from 'vitest'
import type { PortalGoalPageMonth } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import {
  HOW_IT_COUNTS_TITLE,
  TILES_LABEL,
  TILES_TITLE,
  extrasSubjectName,
  fromPortalsWords,
  howItCountsWords,
  pageBodyLine,
  stripChips,
} from './portal-goal-page-view'
import {
  PAGE_RUNNING,
  PAGE_WITH_NO_SCAN_FACTS,
} from './portal-goal-page.stories.fixtures'

/** A month on the strip: November, 36 of 40 private ratings, not met. */
const month = (patch: Partial<PortalGoalPageMonth> = {}): PortalGoalPageMonth => ({
  key: '2026-11',
  measure: 'portal_rating_count',
  value: 36,
  target: 40,
  outcome: 'not_met',
  finalOn: '2026-12-02',
  correction: null,
  ...patch,
})

describe('pageBodyLine', () => {
  it('says what counts, from which portals, at the property', () => {
    const three = ['Reception', 'Restaurant', 'Spa']

    expect(pageBodyLine('portal_rating_count', three, 'Seaview Hotel')).toBe(
      'Private ratings from all 3 portals at Seaview Hotel.',
    )
    expect(pageBodyLine('portal_rating_count', ['Reception'], 'Seaview Hotel')).toBe(
      'Private ratings from Reception at Seaview Hotel.',
    )
    expect(pageBodyLine('qualified_scans', three, 'Seaview Hotel')).toBe(
      'Scans from all 3 portals at Seaview Hotel.',
    )
  })
})

describe('the average goal’s tiles', () => {
  it('are titled "Your goal, so far", and named so for a screen reader', () => {
    expect(TILES_TITLE).toBe('Your goal, so far')
    expect(TILES_LABEL).toBe('Your goal, so far, in numbers')
  })
})

describe('stripChips', () => {
  it('strip chips: met has a check, not met is neutral, running is dashed', () => {
    const chips = stripChips(
      [
        month({ key: '2026-12', value: 12, target: 45, outcome: 'running' }),
        month({ value: 41, outcome: 'met' }),
        month({ key: '2026-10' }),
      ],
      '2026-12-22',
    )

    expect(
      chips.map(({ text, suffix, met, open, label }) => ({
        text,
        suffix,
        met,
        open,
        label,
      })),
    ).toEqual([
      {
        text: 'Dec 12/45',
        suffix: 'running',
        met: false,
        open: true,
        label: 'December: 12 of 45 private ratings, running',
      },
      {
        text: 'Nov 41/40',
        suffix: null,
        met: true,
        open: false,
        label: 'November: 41 of 40 private ratings, met',
      },
      {
        text: 'Oct 36/40',
        suffix: null,
        met: false,
        open: false,
        label: 'October: 36 of 40 private ratings, not met',
      },
    ])
  })

  it('month facts give the number in that month and a correction', () => {
    const [plain, corrected] = stripChips(
      [
        month(),
        month({
          key: '2026-10',
          value: 41,
          outcome: 'met',
          finalOn: '2026-11-02',
          correction: { on: '2026-11-05', value: 41, outcome: 'met' },
        }),
      ],
      '2026-12-03',
    )

    expect(plain?.lines).toEqual([
      '36 of 40 private ratings · not met',
      'Final on Dec 2',
      'Number in November: 40',
    ])
    expect(corrected?.lines.at(-1)).toBe('Corrected on Nov 5: 41 of 40, now met.')
  })

  it('a month with no figure is never a zero, and another year is named', () => {
    const [chip] = stripChips(
      [month({ key: '2025-11', value: null, outcome: 'unavailable' })],
      '2026-12-03',
    )

    expect(chip).toMatchObject({
      text: 'Nov 2025 –/40',
      label: 'November 2025: 40 private ratings, no usable result',
    })
  })
})

describe('stripChips on the average’s own page (PG-21)', () => {
  it('says each month’s average and its goal in tenths, never a count', () => {
    const average = (patch: Partial<PortalGoalPageMonth>) =>
      month({ measure: 'portal_rating_average', target: 4.5, ...patch })
    const [running, met, unread] = stripChips(
      [
        average({ value: 4.6, outcome: 'running' }),
        average({
          key: '2026-10',
          value: 4.4,
          outcome: 'not_met',
          finalOn: '2026-11-02',
          correction: { on: '2026-11-05', value: 4.6, outcome: 'met' },
        }),
        average({ key: '2026-09', value: null, outcome: 'unavailable' }),
      ],
      '2026-11-22',
    )

    expect(running).toMatchObject({
      text: 'Nov 4.6/4.5',
      label: 'November: 4.6 · goal 4.5, running',
    })
    expect(met?.lines).toEqual([
      '4.4 · goal 4.5 · not met',
      'Final on Nov 2',
      'Number in October: 4.5',
      'Corrected on Nov 5: 4.6 · goal 4.5, now met.',
    ])
    expect(unread).toMatchObject({
      text: 'Sep –/4.5',
      label: 'September: goal 4.5, no usable result',
    })
  })
})

describe('fromPortalsWords', () => {
  const portals = [
    { portalId: 'portal-reception', name: 'Reception' },
    { portalId: 'portal-spa', name: 'Spa' },
  ]

  it('lists each portal in the read’s order, Other portals, and the total', () => {
    const words = fromPortalsWords(
      {
        portals: [
          { portalId: 'portal-reception', name: 'Reception', count: 3 },
          { portalId: 'portal-spa', name: 'Spa', count: 18 },
        ],
        elsewhere: 2,
        total: 23,
        truncated: false,
      },
      {},
      portals,
    )

    expect(words).toEqual({
      rows: [
        { key: 'portal-reception', name: 'Reception', count: '3' },
        { key: 'portal-spa', name: 'Spa', count: '18' },
        { key: 'elsewhere', name: 'Other portals', count: '2' },
      ],
      total: '23',
      truncated: null,
      quiet: [],
    })
  })

  it('keeps the read’s name order even when one portal brought in most of it', () => {
    const { rows, facts, portals: listed } = PAGE_RUNNING
    const words = fromPortalsWords(rows, facts, listed)

    // Spa has 20 of the 23 and Reception 3: never sorted, never ranked (P-1).
    expect(words.rows?.map(({ name, count }) => `${name} ${count}`)).toEqual([
      'Reception 3',
      'Restaurant 0',
      'Spa 20',
    ])
    expect(words.total).toBe('23')
  })

  it('says a quiet portal’s name, its last scan, its usual week and the way to open it', () => {
    const words = fromPortalsWords(
      null,
      { 'portal-spa': { noScansSince: '2026-11-15', usualPerWeek: 7 } },
      portals,
    )

    expect(words.quiet).toEqual([
      {
        portalId: 'portal-spa',
        name: 'Spa',
        since: 'No scans since Nov 15',
        text: 'Spa: no scans since Nov 15. It usually gets about 7 a week.',
        open: 'Open Spa',
      },
    ])
    expect(words.rows).toBeNull()
  })

  it('lists the quiet portals in the read’s order, not the facts’', () => {
    const words = fromPortalsWords(
      null,
      {
        'portal-spa': { noScansSince: '2026-11-15', usualPerWeek: 7 },
        'portal-reception': { noScansSince: '2026-11-08', usualPerWeek: 12 },
      },
      portals,
    )

    expect(words.quiet.map(({ name, since }) => `${name}: ${since}`)).toEqual([
      'Reception: No scans since Nov 8',
      'Spa: No scans since Nov 15',
    ])
  })

  it('leaves out a fact about a portal the page does not list', () => {
    const { rows, facts, portals: listed } = PAGE_WITH_NO_SCAN_FACTS
    const words = fromPortalsWords(
      rows,
      { ...facts, 'portal-gone': { noScansSince: '2026-11-01', usualPerWeek: 3 } },
      listed,
    )

    expect(words.quiet.map(({ portalId }) => portalId)).toEqual(['portal-spa'])
  })

  it('says when only the first 100 portals are listed', () => {
    const words = fromPortalsWords(
      { portals: [], elsewhere: 4, total: 4, truncated: true },
      {},
      [],
    )

    expect(words.truncated).toBe('Showing the first 100 portals by name.')
  })
})

describe('extrasSubjectName', () => {
  it('names the property, a portal and a group from the read', () => {
    const names = {
      'portal:portal-reception': 'Reception',
      'portal_group:group-rooms': 'Rooms',
    }

    expect(
      [
        { kind: 'property', propertyId: 'p1' } as const,
        { kind: 'portal', portalId: 'portal-reception' } as const,
        { kind: 'portal_group', portalGroupId: 'group-rooms' } as const,
        { kind: 'portal', portalId: 'portal-gone' } as const,
      ].map((subject) => extrasSubjectName(subject, 'Seaview Hotel', names)),
    ).toEqual(['Seaview Hotel', 'Reception', 'Rooms', 'Portal'])
  })
})

describe('howItCountsWords', () => {
  it('is the closed card’s title', () => {
    expect(HOW_IT_COUNTS_TITLE).toBe('How this goal counts')
  })

  it('How this goal counts has a scans version', () => {
    expect(howItCountsWords('portal_rating_count', 'Europe/Sofia')).toBe(
      'Counts the 1–5 star private ratings guests give at any of your portals. Low and high ratings count the same. Months follow Sofia time, from the 1st to the last day. A month’s result arrives about a day after it ends. If a guest corrects or withdraws a rating, the month updates.',
    )
    // A goal for one portal counts the ratings at its portal (PG-21).
    expect(howItCountsWords('portal_rating_count', 'Europe/Sofia', 'Reception')).toMatch(
      /^Counts the 1–5 star private ratings guests give at Reception\. /,
    )
    expect(howItCountsWords('qualified_scans', 'Europe/Sofia')).toBe(
      'Counts guests who open a portal from its code. The same visit counts once per portal in any 24 hours. Bots don’t count. Months follow Sofia time, from the 1st to the last day. A month’s result arrives about a day after it ends.',
    )
  })
})
