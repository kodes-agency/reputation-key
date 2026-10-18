import { describe, expect, it } from 'vitest'
import type {
  PortalGoalCardView,
  PortalReadinessRow,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { PORTAL_NO_SCAN_HINT } from './portal-goal-copy'
import {
  CARD_SCANS_ONLY,
  CARD_SCHEDULED,
  GOAL_SCHEDULED,
  SHEET_FIRST_WEEKS,
  SHEET_READY,
} from './portal-goal.stories.fixtures'
import { CARD_CHANGED_TO_SCANS } from './portal-goal-running.stories.fixtures'
import {
  gateWords,
  goalLines,
  listOfNames,
  nothingCountedWords,
  ownNumberDoorWords,
  portalGoalSectionLine,
  portalGoalUnit,
  readinessWords,
  readyOnWords,
  soFarWords,
  timeZoneCity,
} from './portal-goal-words'

const row = (patch: Partial<PortalReadinessRow> = {}): PortalReadinessRow => ({
  portalId: 'portal-spa',
  name: 'Spa',
  live: true,
  codeMade: true,
  firstScan: false,
  noScanSinceCodeDays: null,
  ...patch,
})

const FIRST_WEEKS = {
  today: '2026-10-17',
  month: '2026-10',
  soFar: { ratings: 8, scans: 47 },
  portals: [row()],
} as const

describe('the Monthly portal goal card, in words', () => {
  it('states the gate as a fact', () => {
    expect(gateWords({ state: 'no_portal' }, true)).toEqual({
      fact: 'Counts the private ratings your portals bring in each month. It starts once a portal is live.',
      drafts: null,
      action: { kind: 'create_portal', label: 'Create a portal' },
    })
    // No door without portal.create.
    expect(gateWords({ state: 'no_portal' }, false).action).toBeNull()
  })

  it('offers the one draft by name', () => {
    const words = gateWords(
      { state: 'drafts_only', drafts: [{ portalId: 'portal-spa', name: 'Spa' }] },
      false,
    )

    expect(words.drafts).toBe('You have 1 draft portal: Spa.')
    expect(words.action).toEqual({
      kind: 'open_portal',
      portalId: 'portal-spa',
      label: 'Open Spa',
    })
  })

  it('lists two drafts with and', () => {
    const words = gateWords(
      {
        state: 'drafts_only',
        drafts: [
          { portalId: 'portal-spa', name: 'Spa' },
          { portalId: 'portal-bar', name: 'Bar' },
        ],
      },
      true,
    )

    expect(words.drafts).toBe('You have 2 draft portals: Spa and Bar.')
    expect(words.action).toEqual({ kind: 'open_portals', label: 'Open portals' })
    expect(listOfNames(['Reception', 'Restaurant', 'Spa'])).toBe(
      'Reception, Restaurant and Spa',
    )
    expect(listOfNames(['Spa'])).toBe('Spa')
  })

  it('marks each readiness step', () => {
    const words = readinessWords(row({ firstScan: false }))

    expect(words.steps).toEqual([
      { label: 'Live', done: true },
      { label: 'Code made', done: true },
      { label: 'First scan', done: false },
    ])
    expect(readinessWords(row({ live: false, codeMade: false })).steps).toEqual([
      { label: 'Live', done: false },
      { label: 'Code made', done: false },
      { label: 'First scan', done: false },
    ])
  })

  it('hints only after 14 silent days since the code', () => {
    // The server says when: a code under 14 days old, or one scanned, has none.
    expect(readinessWords(row({ noScanSinceCodeDays: null })).hint).toBeNull()
    expect(readinessWords(row({ noScanSinceCodeDays: 17 })).hint).toEqual({
      text: `No scan in the 17 days since its code was made. ${PORTAL_NO_SCAN_HINT}`,
      open: 'Open Spa',
    })
  })

  it('says the ready day, or 2 weeks after a portal goes live', () => {
    expect(readyOnWords('2026-10-23')).toBe(
      'Your recommended number is ready on Oct 23, after 2 weeks live.',
    )
    expect(readyOnWords(null)).toBe(
      'Your recommended number is ready 2 weeks after a portal goes live.',
    )
  })

  it('says the month so far, one rating in the singular', () => {
    expect(soFarWords('2026-10', { ratings: 8, scans: 47 })).toBe(
      'So far in October: 8 private ratings · 47 scans',
    )
    expect(soFarWords('2026-11', { ratings: 1, scans: 1 })).toBe(
      'So far in November: 1 private rating · 1 scan',
    )
  })

  it('says when part of so far cannot be read', () => {
    expect(soFarWords('2026-10', { ratings: null, scans: 47 })).toBe(
      'So far in October: private ratings can’t be read right now · 47 scans',
    )
    expect(soFarWords('2026-10', { ratings: 8, scans: null })).toBe(
      'So far in October: 8 private ratings · scans can’t be read right now',
    )
  })

  it('offers a number of their own before one is recommended', () => {
    expect(ownNumberDoorWords('getting_ready')).toBe('Set my own number')
    expect(ownNumberDoorWords('recommendation_unreadable')).toBe('Set my own number')
    expect(ownNumberDoorWords('nothing_counted')).toBe('Set a number anyway')
  })

  it('names the weeks nothing came in', () => {
    expect(nothingCountedWords(2)).toEqual({
      text: 'No scans in the last 2 weeks. Check that each code is where guests can see it.',
      action: { kind: 'open_portals', label: 'Open portals' },
    })
  })

  it('says what the goal counts under the section title, except at a gate', () => {
    const line = (card: PortalGoalCardView) => portalGoalSectionLine(card)

    expect(
      line({
        state: 'getting_ready',
        readyOn: '2026-10-23',
        ...FIRST_WEEKS,
        sheet: SHEET_FIRST_WEEKS,
      }),
    ).toBe('How many private ratings your portals bring in each month.')
    expect(line(CARD_SCANS_ONLY)).toBe('How many scans your portals get each month.')
    // With a goal, its own measure.
    expect(line(CARD_SCHEDULED)).toBe(
      'How many private ratings your portals bring in each month.',
    )
    expect(
      line({
        state: 'goal',
        today: '2026-10-23',
        goal: { ...GOAL_SCHEDULED, measure: 'qualified_scans' },
        sheet: SHEET_READY,
      }),
    ).toBe('How many scans your portals get each month.')
    // Changed to scans from December: November, on the card, counts private ratings.
    expect(line(CARD_CHANGED_TO_SCANS)).toBe(
      'How many private ratings your portals bring in each month.',
    )
    expect(line({ state: 'nothing_counted', weeks: 2, sheet: SHEET_FIRST_WEEKS })).toBe(
      'How many private ratings your portals bring in each month.',
    )
    expect(line({ state: 'no_portal' })).toBeNull()
    expect(line({ state: 'drafts_only', drafts: [] })).toBeNull()
  })

  it('counts in the measure: one is singular', () => {
    expect(portalGoalUnit('portal_rating_count', 1)).toBe('private rating')
    expect(portalGoalUnit('portal_rating_count', 40)).toBe('private ratings')
    expect(portalGoalUnit('qualified_scans', 1)).toBe('scan')
    expect(portalGoalUnit('qualified_scans', 0)).toBe('scans')
  })

  it('turns Europe/Sofia into Sofia', () => {
    expect(timeZoneCity('Europe/Sofia')).toBe('Sofia')
    expect(timeZoneCity('America/New_York')).toBe('New York')
    expect(timeZoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
    expect(timeZoneCity('UTC')).toBe('UTC')
  })
})

describe('the Monthly portal goal on its card, in words', () => {
  /** Past its first day: no start to say, and no month so far of its own. */
  const STARTED = { ...GOAL_SCHEDULED, startsOn: null, currentMonthSoFar: null }

  it('a scheduled goal says its month, when it starts and this month so far', () => {
    expect(goalLines(GOAL_SCHEDULED, '2026-10-23')).toEqual([
      'November · 40 private ratings',
      'Starts on Nov 1 · October so far: 12',
    ])
    expect(
      goalLines({ ...GOAL_SCHEDULED, currentMonthSoFar: null }, '2026-10-23'),
    ).toEqual(['November · 40 private ratings', 'Starts on Nov 1'])
  })

  it('a goal with no month running says its number', () => {
    expect(
      goalLines(
        { ...STARTED, status: 'paused', measure: 'qualified_scans' },
        '2026-11-22',
      ),
    ).toEqual(['November · 40 scans'])
  })

  it('a stopped goal names the month it still counts, not today’s', () => {
    // Dec 1: November is still being read for a goal stopped in November, and
    // it counted private ratings although the goal was changed to scans.
    expect(
      goalLines(
        {
          ...STARTED,
          status: 'ended',
          measure: 'qualified_scans',
          countingMonth: { key: '2026-11', measure: 'portal_rating_count', target: 45 },
        },
        '2026-12-01',
      ),
    ).toEqual(['November · 45 private ratings'])
  })
})
