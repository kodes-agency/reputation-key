import { describe, expect, it } from 'vitest'
import { monthTargetPlan } from '#/contexts/reporting/application/goal-month-target-plan'
import {
  FIXTURE_ZONE,
  NOVEMBER,
  goalBundle,
  monthRow,
  version,
} from './goal-month-target.stories.fixtures'
import {
  goalFollowingHelp,
  goalMonthSoFarLines,
  goalMonthTargetDescription,
  goalMonthTargetWords,
} from './goal-month-target-dialog-view'

const at = (iso: string) => new Date(iso)
const NOW = at('2026-10-22T09:00:00.000Z')

type Goal = ReturnType<typeof goalBundle>

/** The plan the dialog and the command both work from; these goals all have a running month. */
function planOf(goal: Goal, timezone = FIXTURE_ZONE, now = NOW) {
  const plan = monthTargetPlan(goal, now, timezone)
  if (plan === null) throw new Error('the fixture has no running month')
  return plan
}

// October runs under the first version, at 400.
const counting = () =>
  goalBundle({ versions: [version('v1', 1)], results: [monthRow('lobby', 'v1')] })

// A revision already waits for November.
const scheduledChange = (patch: Parameters<typeof version>[2] = {}) =>
  goalBundle({
    versions: [
      version('v1', 1, { effectiveTo: NOVEMBER.start }),
      version('v2', 2, { targetValue: 500, effectiveFrom: NOVEMBER.start, ...patch }),
    ],
    results: [monthRow('lobby', 'v1')],
  })

describe('goalMonthTargetWords', () => {
  it('names the month and puts the real date on the checkbox, ticked', () => {
    const words = goalMonthTargetWords(planOf(counting()), {
      timezone: FIXTURE_ZONE,
      now: NOW,
    })

    expect(words).toEqual({
      month: 'October',
      followingMonth: 'November',
      fieldLabel: 'Target for October',
      following: {
        label: 'Also use this target from Nov 1',
        defaultChecked: true,
        available: true,
      },
    })
  })

  it('leaves the box unticked when a change is already scheduled', () => {
    const words = goalMonthTargetWords(planOf(scheduledChange()), {
      timezone: FIXTURE_ZONE,
      now: NOW,
    })

    expect(words.following).toEqual({
      label: 'Also use this target from Nov 1',
      defaultChecked: false,
      available: true,
    })
  })

  it('leaves the box unticked when ticking it would skip a month', () => {
    // The month was cut on a UTC calendar and the Property has since moved to
    // Sofia, whose November begins before the running month ends. A version
    // for the months after can only start with Sofia's December.
    const words = goalMonthTargetWords(planOf(counting(), 'Europe/Sofia'), {
      timezone: 'Europe/Sofia',
      now: NOW,
    })

    expect(words.followingMonth).toBe('December')
    expect(words.following).toEqual({
      label: 'Also use this target from Dec 1',
      defaultChecked: false,
      available: true,
    })
  })

  it('makes the box unavailable when the scheduled change has another measure', () => {
    const goal = scheduledChange({
      metric: 'portal_rating_average',
      metricMinimumSample: 10,
      targetValue: 4.5,
    })

    const words = goalMonthTargetWords(planOf(goal), { timezone: FIXTURE_ZONE, now: NOW })

    expect(words.following).toEqual({
      label: 'Also use this target from Nov 1',
      defaultChecked: false,
      available: false,
    })
  })

  it('prints the year of a start in another year', () => {
    const december = {
      start: at('2026-12-01T00:00:00.000Z'),
      end: at('2027-01-01T00:00:00.000Z'),
    }
    const goal = goalBundle({
      versions: [version('v1', 1, { effectiveFrom: december.start })],
      results: [monthRow('lobby', 'v1', december)],
    })
    const now = at('2026-12-10T09:00:00.000Z')

    const words = goalMonthTargetWords(planOf(goal, FIXTURE_ZONE, now), {
      timezone: FIXTURE_ZONE,
      now,
    })

    expect(words.following.label).toBe('Also use this target from Jan 1, 2027')
  })
})

describe('goalMonthTargetDescription', () => {
  it('says which month is judged against the new target, and that the change is shown', () => {
    const words = goalMonthTargetWords(planOf(counting()), {
      timezone: FIXTURE_ZONE,
      now: NOW,
    })

    expect(goalMonthTargetDescription(words)).toBe(
      'October is judged against the new target. The goal keeps showing who changed it and what it started at.',
    )
  })

  it('says there is nothing to change when no month is running', () => {
    expect(goalMonthTargetDescription(null)).toBe(
      'No month of this goal is running right now, so there is no target to change. Reload the page to see where the goal stands.',
    )
  })
})

describe('goalFollowingHelp', () => {
  const frame = { timezone: FIXTURE_ZONE, now: NOW }

  it('says nothing when ticking the box simply carries the target on', () => {
    expect(goalFollowingHelp(planOf(counting()), 300, frame)).toBeNull()
  })

  it('asks before replacing a change that is already scheduled', () => {
    expect(goalFollowingHelp(planOf(scheduledChange()), 300, frame)).toBe(
      'November is already set to 500. Replace it with 300?',
    )
  })

  it('asks nothing when the scheduled change already has the target typed', () => {
    expect(goalFollowingHelp(planOf(scheduledChange()), 500, frame)).toBe(
      'November is already set to 500.',
    )
  })

  it('asks nothing while the field holds no number', () => {
    expect(goalFollowingHelp(planOf(scheduledChange()), Number.NaN, frame)).toBe(
      'November is already set to 500.',
    )
  })

  it('warns that a month would have no goal result', () => {
    const sofia = { timezone: 'Europe/Sofia', now: NOW }

    expect(goalFollowingHelp(planOf(counting(), 'Europe/Sofia'), 300, sofia)).toBe(
      'November would have no goal result.',
    )
  })

  it('says why the months after cannot take the target', () => {
    const goal = scheduledChange({
      metric: 'portal_rating_average',
      metricMinimumSample: 10,
      targetValue: 4.5,
    })

    expect(goalFollowingHelp(planOf(goal), 300, frame)).toBe(
      'November already has its own change scheduled, so only October will change.',
    )
  })
})

describe('goalMonthSoFarLines', () => {
  const live = (value: number) => ({ kind: 'live', value, sampleCount: value }) as const

  it('says what one subject has counted so far this month', () => {
    expect(
      goalMonthSoFarLines('qualified_scans', [{ name: 'Lobby', reading: live(412) }]),
    ).toEqual(['412 so far this month'])
  })

  it('names each subject of a goal with several', () => {
    expect(
      goalMonthSoFarLines('qualified_scans', [
        { name: 'Lobby', reading: live(412) },
        { name: 'Pool bar', reading: live(87) },
      ]),
    ).toEqual(['Lobby: 412 so far this month', 'Pool bar: 87 so far this month'])
  })

  it('never turns an unreadable or too thin figure into a number', () => {
    expect(
      goalMonthSoFarLines('portal_rating_average', [
        { name: 'Lobby', reading: live(4.46) },
        {
          name: 'Pool bar',
          reading: { kind: 'too_few', sampleCount: 6, minimumSample: 10 },
        },
        { name: 'Spa', reading: { kind: 'unavailable' } },
      ]),
    ).toEqual([
      'Lobby: 4.5 so far this month',
      'Pool bar: Too few ratings so far this month: 6 of the 10 an average needs',
      'Spa: This month’s figure can’t be read right now',
    ])
  })

  it('still names the one subject it has a figure for when the goal has several', () => {
    expect(
      goalMonthSoFarLines('qualified_scans', [
        { name: 'Lobby', reading: live(412) },
        { name: 'Pool bar', reading: { kind: 'not_started' } },
      ]),
    ).toEqual(['Lobby: 412 so far this month'])
  })

  it('says nothing for a subject that is not counting', () => {
    expect(
      goalMonthSoFarLines('qualified_scans', [
        { name: 'Lobby', reading: { kind: 'not_started' } },
      ]),
    ).toEqual([])
  })
})
