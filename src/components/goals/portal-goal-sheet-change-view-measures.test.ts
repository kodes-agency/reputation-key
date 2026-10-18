import { describe, expect, it } from 'vitest'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  changedChangeDraft,
  openingChangeDraft,
  portalGoalChangeModel,
  type PortalGoalChangeContext,
} from './portal-goal-sheet-change-view'
import {
  CARD_CHANGED_TO_SCANS,
  CARD_WHILE_DECEMBER_OPENS,
} from './portal-goal-running.stories.fixtures'

// The change sheet where a month's measure is not the goal's (PLAN PG-14):
// after "Count scans instead" from December, November still counts private
// ratings, so a change of number keeps each month's own measure, and a change
// now is November's alone; and in the hour before a month's own is opened,
// when no month can change now.

const NOV_22 = new Date('2026-11-22T10:00:00.000Z')

const contextOf = (card: PortalGoalCardView, now = NOV_22): PortalGoalChangeContext => {
  if (card.state !== 'goal' || card.goal.change === null) {
    throw new Error('expected a goal that can change')
  }
  return { goal: card.goal, change: card.goal.change, facts: card.sheet, now }
}

describe('in the hour before a month is opened', () => {
  it('a change is from the next month and leaves this one as it is', () => {
    const opening = contextOf(
      CARD_WHILE_DECEMBER_OPENS,
      new Date('2026-11-30T22:05:00.000Z'),
    )
    const model = portalGoalChangeModel(
      openingChangeDraft(opening, 'portal_rating_count'),
      opening,
    )
    const scans = portalGoalChangeModel(
      openingChangeDraft(opening, 'qualified_scans'),
      opening,
    )

    // Not "Starts on Jan 1.": that is a goal that has not started.
    expect(model).toMatchObject({
      months: [{ value: 'next', label: 'From Jan 1' }],
      month: 'next',
      description: 'December stays at 40.',
    })
    expect(scans.description).toBe('December keeps counting private ratings.')
  })
})

describe('after Count scans instead from December', () => {
  // Nov 22: November still counts private ratings at 40; December counts 55 scans.
  const SWITCHED = contextOf(CARD_CHANGED_TO_SCANS)
  const throughThe20th: PortalGoalChangeContext = {
    ...SWITCHED,
    change: { ...SWITCHED.change, opensOn: 'now' },
  }

  it('Change number opens on November in private ratings, for November alone', () => {
    const draft = openingChangeDraft(throughThe20th, 'qualified_scans')
    const model = portalGoalChangeModel(
      changedChangeDraft(draft, { kind: 'type', text: '45' }, throughThe20th),
      throughThe20th,
    )

    expect(model).toMatchObject({
      months: [
        { value: 'now', label: 'November, now', disabled: false },
        { value: 'next', label: 'From Dec 1' },
      ],
      month: 'now',
      unit: 'private ratings',
      // December keeps its scans: no word of the months after.
      description: 'November is judged against the new number.',
      submission: { when: 'now', data: { month: '2026-11', expectedVersion: 2 } },
    })
  })

  it('after the 20th Change number opens on December, in scans', () => {
    const model = portalGoalChangeModel(
      openingChangeDraft(SWITCHED, 'qualified_scans'),
      SWITCHED,
    )

    expect(model).toMatchObject({
      month: 'next',
      unit: 'scans',
      number: { text: '55' },
      description: 'November keeps counting private ratings.',
    })
  })

  it('Count private ratings instead is from December, as Count scans instead is', () => {
    const model = portalGoalChangeModel(
      openingChangeDraft(throughThe20th, 'portal_rating_count'),
      throughThe20th,
    )

    expect(model).toMatchObject({
      month: 'next',
      band: 'December',
      unit: 'private ratings',
      number: { text: '45' },
      description: 'November stays at 40.',
      primary: { label: 'Set 45 from December', disabled: false },
    })
  })
})
