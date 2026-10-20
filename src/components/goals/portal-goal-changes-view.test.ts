import { describe, expect, it } from 'vitest'
import type { PortalGoalChange } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import { anyChangeInAnotherYear, changeLines } from './portal-goal-changes-view'

const NAMES: Readonly<Record<string, string>> = { elena: 'Elena', marco: 'Marco' }
const personName = (userId: string): string | null => NAMES[userId] ?? null
/** The day the page is read. */
const TODAY = '2026-12-22'

/** Oct 23: Elena set 40 a month from November, as recommended. */
const set = (patch: Partial<Extract<PortalGoalChange, { kind: 'set_from' }>> = {}) =>
  ({
    kind: 'set_from',
    on: '2026-10-23',
    by: 'elena',
    fromMonth: '2026-11',
    target: 40,
    measure: 'portal_rating_count',
    switched: false,
    source: 'recommended',
    note: null,
    ...patch,
  }) as const satisfies PortalGoalChange

const textOf = (change: PortalGoalChange) =>
  changeLines([change], personName, TODAY).lines.map(
    ({ date, text }) => `${date} · ${text}`,
  )

describe('changeLines', () => {
  it('a recommended set says (recommended)', () => {
    expect(textOf(set())).toEqual([
      'Oct 23 · Elena set 40 a month from November (recommended)',
    ])
  })

  it('a null source drops the word', () => {
    expect(
      textOf(set({ on: '2026-11-22', fromMonth: '2026-12', target: 45, source: null })),
    ).toEqual(['Nov 22 · Elena set 45 a month from December'])
    expect(textOf(set({ source: 'own' }))).toEqual([
      'Oct 23 · Elena set 40 a month from November',
    ])
  })

  it('the average’s level is set from a month, or for one, in tenths (PG-21)', () => {
    expect(
      textOf(set({ target: 4.5, measure: 'portal_rating_average', source: 'own' })),
    ).toEqual(['Oct 23 · Elena set 4.5 from November'])
    expect(
      textOf({
        kind: 'set_month',
        on: '2026-11-22',
        by: 'elena',
        month: '2026-11',
        target: 4.6,
        measure: 'portal_rating_average',
        source: 'own',
        note: null,
      }),
    ).toEqual(['Nov 22 · Elena set November to 4.6'])
  })

  it('a month change says set December to 45', () => {
    expect(
      textOf({
        kind: 'set_month',
        on: '2026-12-01',
        by: 'elena',
        month: '2026-12',
        target: 45,
        measure: 'portal_rating_count',
        source: 'recommended',
        note: null,
      }),
    ).toEqual(['Dec 1 · Elena set December to 45 (recommended)'])
  })

  it('same-day go-lives group', () => {
    expect(
      textOf({
        kind: 'went_live',
        on: '2026-10-09',
        portals: ['Reception', 'Restaurant'],
      }),
    ).toEqual(['Oct 9 · Reception and Restaurant went live'])
    expect(textOf({ kind: 'went_live', on: '2026-10-15', portals: ['Spa'] })).toEqual([
      'Oct 15 · Spa went live',
    ])
  })

  it('a measure switch names the unit', () => {
    expect(
      textOf(
        set({
          on: '2026-11-22',
          fromMonth: '2026-12',
          target: 55,
          measure: 'qualified_scans',
          switched: true,
          source: 'own',
        }),
      ),
    ).toEqual(['Nov 22 · Elena switched to scans: 55 a month from December'])
  })

  it('a note shows on its own line', () => {
    const { lines } = changeLines(
      [set({ note: 'Agreed with the GM' })],
      personName,
      TODAY,
    )

    expect(lines[0]?.note).toBe('“Agreed with the GM”')
    expect(lines[0]?.text).toBe('Elena set 40 a month from November (recommended)')
  })

  it('a stop names who stopped it; nobody known, the sentence names no one', () => {
    expect(textOf({ kind: 'stopped', on: '2026-11-12', by: 'marco' })).toEqual([
      'Nov 12 · Marco stopped the goal',
    ])
    expect(textOf({ kind: 'stopped', on: '2026-11-12', by: 'someone' })).toEqual([
      'Nov 12 · The goal was stopped',
    ])
    expect(textOf(set({ by: 'someone' }))).toEqual([
      'Oct 23 · Set 40 a month from November (recommended)',
    ])
  })

  it('newest first, at most 12', () => {
    const changes = Array.from({ length: 14 }, (_, index) =>
      set({ on: `2026-10-${String(28 - index).padStart(2, '0')}` }),
    )

    const shown = changeLines(changes, personName, TODAY)
    const all = changeLines(changes, personName, TODAY, true)

    expect(shown.lines).toHaveLength(12)
    expect(shown.lines[0]?.date).toBe('Oct 28')
    expect(shown.more).toBe(true)
    expect(all.lines).toHaveLength(14)
    expect(all.more).toBe(false)
  })

  it('a change in another year says its year', () => {
    expect(
      textOf({ kind: 'went_live', on: '2025-03-03', portals: ['Reception'] }),
    ).toEqual(['Mar 3, 2025 · Reception went live'])
    expect(textOf(set())).toEqual([
      'Oct 23 · Elena set 40 a month from November (recommended)',
    ])
  })
})

describe('anyChangeInAnotherYear', () => {
  it('is false while every change is of the year of today', () => {
    expect(anyChangeInAnotherYear([set(), set({ on: '2026-01-02' })], TODAY)).toBe(false)
    expect(anyChangeInAnotherYear([], TODAY)).toBe(false)
  })

  it('is true when any change is of another year, shown or not', () => {
    const changes = [
      ...Array.from({ length: 12 }, () => set()),
      set({ on: '2025-12-28' }),
    ]

    expect(changeLines(changes, personName, TODAY).lines).toHaveLength(12)
    expect(anyChangeInAnotherYear(changes, TODAY)).toBe(true)
  })
})
