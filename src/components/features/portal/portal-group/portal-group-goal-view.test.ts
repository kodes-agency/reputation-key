import { describe, expect, it } from 'vitest'
import type { GoalProgress } from '#/contexts/reporting/application/public-api'
import { goalCardView } from './portal-group-goal-view'

const ZONE = 'Europe/Sofia'
const SEPTEMBER = {
  start: new Date('2026-08-31T21:00:00.000Z'),
  end: new Date('2026-09-30T21:00:00.000Z'),
}

const goal = (overrides: Partial<GoalProgress> = {}): GoalProgress => ({
  programId: 'program-1',
  name: 'Private ratings',
  metric: 'portal_rating_count',
  targetValue: 250,
  setBy: 'elena',
  status: 'active',
  period: SEPTEMBER,
  timezone: ZONE,
  asOf: new Date('2026-09-30T08:00:00.000Z'),
  reading: { kind: 'live', value: 209, sampleCount: 209 },
  ...overrides,
})

const at = (iso: string) => new Date(iso)
const people = (id: string) => (id === 'elena' ? 'Elena Petrova' : null)

describe('goalCardView', () => {
  it('prints the board: month and metric, the figure against the target, who set it', () => {
    const view = goalCardView(goal(), {
      setByName: people,
      now: at('2026-09-30T08:00:00.000Z'),
    })

    expect(view).toMatchObject({
      title: 'September · Private ratings',
      figure: '209',
      target: 'of 250',
      note: 'Set by Elena Petrova · the month ends today',
      state: 'live',
    })
    expect(view.fraction).toBeCloseTo(209 / 250)
    expect(view.progressLabel).toBe('Private ratings: 209 of 250 so far this month')
  })

  it.each([
    ['2026-09-30T08:00:00.000Z', 'the month ends today'],
    ['2026-09-29T08:00:00.000Z', 'the month ends tomorrow'],
    ['2026-09-20T08:00:00.000Z', 'the month ends in 10 days'],
  ])('counts the days left in the property time zone (%s)', (now, words) => {
    const view = goalCardView(goal(), { setByName: people, now: at(now) })

    expect(view.note).toBe(`Set by Elena Petrova · ${words}`)
  })

  it('counts the last day by the property day, not the UTC day', () => {
    // 21:30 UTC on 30 Sep is already 1 Oct in Sofia, so the goal month is over.
    const view = goalCardView(goal({ period: SEPTEMBER }), {
      setByName: people,
      now: at('2026-09-30T21:30:00.000Z'),
    })

    expect(view.note).toBe('Set by Elena Petrova')
  })

  it('never fills the bar beyond the target', () => {
    const view = goalCardView(
      goal({ reading: { kind: 'live', value: 300, sampleCount: 300 } }),
      { setByName: people, now: at('2026-09-30T08:00:00.000Z') },
    )

    expect(view.fraction).toBe(1)
    expect(view.figure).toBe('300')
  })

  it('prints an average to one decimal against its target', () => {
    const view = goalCardView(
      goal({
        metric: 'portal_rating_average',
        targetValue: 4.6,
        reading: { kind: 'live', value: 4.5, sampleCount: 31 },
      }),
      { setByName: people, now: at('2026-09-20T08:00:00.000Z') },
    )

    expect(view).toMatchObject({
      title: 'September · Private rating average',
      figure: '4.5',
      target: 'of 4.6',
    })
  })

  it('says why an average has no figure yet, and shows no bar', () => {
    const view = goalCardView(
      goal({
        metric: 'portal_rating_average',
        targetValue: 4.6,
        reading: { kind: 'too_few', sampleCount: 6, minimumSample: 10 },
      }),
      { setByName: people, now: at('2026-09-20T08:00:00.000Z') },
    )

    expect(view).toMatchObject({
      state: 'too_few',
      figure: null,
      fraction: null,
      detail: 'Too few ratings so far: 6 of the 10 an average needs',
    })
  })

  it('never turns an unreadable figure into a zero', () => {
    const view = goalCardView(goal({ reading: { kind: 'unavailable' } }), {
      setByName: people,
      now: at('2026-09-20T08:00:00.000Z'),
    })

    expect(view).toMatchObject({
      state: 'unavailable',
      figure: null,
      fraction: null,
      detail: 'This figure can’t be read right now',
    })
  })

  it('says when a scheduled goal starts, with no figure', () => {
    const october = {
      start: new Date('2026-09-30T21:00:00.000Z'),
      end: new Date('2026-10-31T22:00:00.000Z'),
    }
    const view = goalCardView(
      goal({ status: 'scheduled', period: october, reading: { kind: 'not_started' } }),
      { setByName: people, now: at('2026-09-20T08:00:00.000Z') },
    )

    expect(view).toMatchObject({
      title: 'October · Private ratings',
      state: 'not_started',
      figure: null,
      detail: 'Starts on Oct 1',
      note: 'Set by Elena Petrova',
    })
  })

  it('says a paused goal is paused', () => {
    const view = goalCardView(
      goal({ status: 'paused', reading: { kind: 'not_started' } }),
      { setByName: people, now: at('2026-09-20T08:00:00.000Z') },
    )

    expect(view.detail).toBe('Paused')
  })

  it('leaves out who set it when the directory cannot name them', () => {
    const view = goalCardView(goal({ setBy: 'unknown' }), {
      setByName: people,
      now: at('2026-09-30T08:00:00.000Z'),
    })

    expect(view.note).toBe('The month ends today')
  })
})
