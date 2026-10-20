import { describe, expect, it } from 'vitest'
import type { PortalGoalChangeFacts } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  changedAverageDraft,
  openingAverageDraft,
  portalGoalAverageChangeModel,
  type PortalGoalAverageChangeContext,
} from './portal-goal-average-change-view'

/** November running at 4.5 on Nov 22; a change from a coming month starts Dec 1. */
const NOVEMBER: PortalGoalChangeFacts = {
  now: {
    monthKey: '2026-11',
    expectedTarget: 4.5,
    expectedVersion: 1,
    expectedFollowingMonth: '2026-12',
    appliesToFollowing: true,
    period: { start: '2026-10-31T22:00:00.000Z', end: '2026-11-30T22:00:00.000Z' },
    timezone: 'Europe/Sofia',
  },
  nextMonthKey: '2026-12',
  opensOn: 'next',
}

const context = (
  change: PortalGoalChangeFacts = NOVEMBER,
  status: 'active' | 'scheduled' = 'active',
): PortalGoalAverageChangeContext => ({
  goal: { programId: 'average-goal', version: 1, target: 4.5, status },
  change,
})

const typed = (text: string, ofContext = context()) =>
  portalGoalAverageChangeModel(
    changedAverageDraft(openingAverageDraft(ofContext), { kind: 'type', text }),
    ofContext,
  )

describe('the average goal’s change sheet', () => {
  it('opens on December after the 20th with the level it has, which changes nothing yet', () => {
    const model = portalGoalAverageChangeModel(openingAverageDraft(context()), context())

    expect(model).toMatchObject({
      month: 'next',
      months: [
        { value: 'now', label: 'November, now' },
        { value: 'next', label: 'From Dec 1' },
      ],
      unit: 'average private rating in December',
      description: 'November stays at 4.5.',
      status: 'Needs 10 private ratings a month.',
      number: { text: '4.5', value: 4.5 },
      primary: { label: 'Set 4.5 from December', disabled: true },
      submission: null,
    })
  })

  it('sets 4.6 from December as the manager’s own level, never a count', () => {
    const model = typed('4.6')

    expect(model.primary).toEqual({ label: 'Set 4.6 from December', disabled: false })
    expect(model.toast).toBe('From December: 4.6 average private rating')
    expect(model.submission).toEqual({
      when: 'next',
      data: {
        programId: 'average-goal',
        metric: 'portal_rating_average',
        targetValue: 4.6,
        expectedVersion: 1,
        startMonth: '2026-12',
        targetSource: 'own',
      },
    })
  })

  it('November, now judges November and the months after it, against what the sheet showed', () => {
    const draft = changedAverageDraft(
      changedAverageDraft(openingAverageDraft(context()), {
        kind: 'month',
        month: 'now',
      }),
      { kind: 'number', value: 4.4 },
    )
    const model = portalGoalAverageChangeModel(
      changedAverageDraft(draft, { kind: 'note', text: '  Quiet month ' }),
      context(),
    )

    expect(model.description).toBe(
      'November is judged against the new number, and so are the months after it.',
    )
    expect(model.primary.label).toBe('Set 4.4 for November')
    expect(model.toast).toBe('November goal: 4.4 average private rating')
    expect(model.submission).toEqual({
      when: 'now',
      data: {
        programId: 'average-goal',
        month: '2026-11',
        targetValue: 4.4,
        expectedTarget: 4.5,
        expectedVersion: 1,
        expectedFollowingMonth: '2026-12',
        note: 'Quiet month',
        targetSource: 'own',
      },
    })
  })

  it('takes tenths from 1 to 5, with a comma too, and steps by a tenth', () => {
    expect(typed('4,7').number).toMatchObject({
      value: 4.7,
      invalid: false,
      valueText: '4.7 average private rating',
      lower: { label: 'Lower to 4.6', to: 4.6 },
      raise: { label: 'Raise to 4.8', to: 4.8 },
    })
    for (const text of ['4.75', '5.5', '0.9', 'four']) {
      expect(typed(text)).toMatchObject({
        number: { value: null, invalid: true },
        primary: { label: 'Set goal', disabled: true },
        submission: null,
      })
    }
    expect(typed('')).toMatchObject({ number: { invalid: false }, toast: null })
  })

  it('a goal that has not started changes from its first month alone', () => {
    const scheduled = context({ ...NOVEMBER, now: null, opensOn: 'next' }, 'scheduled')
    const model = portalGoalAverageChangeModel(openingAverageDraft(scheduled), scheduled)

    expect(model.months).toEqual([{ value: 'next', label: 'From Dec 1' }])
    expect(model.description).toBe('Starts on Dec 1.')
    // Asking for now when no month runs is still from the next month.
    const asked = changedAverageDraft(openingAverageDraft(scheduled), {
      kind: 'month',
      month: 'now',
    })
    expect(portalGoalAverageChangeModel(asked, scheduled).month).toBe('next')
  })

  it('through the 20th it opens on the running month, at its own level', () => {
    const early = context({ ...NOVEMBER, opensOn: 'now' })

    expect(openingAverageDraft(early)).toEqual({
      when: 'now',
      text: '4.5',
      note: { open: false, text: '' },
    })
  })
})
