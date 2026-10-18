import { describe, expect, it } from 'vitest'
import type { PortalGoalCardView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  changedChangeDraft,
  openingChangeDraft,
  portalGoalChangeModel,
  type PortalGoalChangeContext,
  type PortalGoalChangeDraft,
  type PortalGoalChangeEdit,
} from './portal-goal-sheet-change-view'
import { CARD_LAST_DAY, CARD_RUNNING } from './portal-goal-running.stories.fixtures'
import { CARD_SCHEDULED } from './portal-goal.stories.fixtures'

// Changing the Monthly portal goal in its sheet (PLAN PG-14).
// Nov 22 at Seaview: November runs at 40 with 23 so far (9 days left, today
// counted); December is recommended at 45 (40 · 45 · 50 over the last 4
// weeks), and 55 scans; after the 20th the sheet opens on December.

const NOV_22 = new Date('2026-11-22T10:00:00.000Z')

const runningContext = (
  card: PortalGoalCardView = CARD_RUNNING,
  now = NOV_22,
): PortalGoalChangeContext => {
  if (card.state !== 'goal' || card.goal.change === null) {
    throw new Error('expected a goal that can change')
  }
  return { goal: card.goal, change: card.goal.change, facts: card.sheet, now }
}

const RUNNING = runningContext()

const edit = (
  draft: PortalGoalChangeDraft,
  ...edits: readonly PortalGoalChangeEdit[]
): PortalGoalChangeDraft =>
  edits.reduce((last, next) => changedChangeDraft(last, next, RUNNING), draft)

const opened = (
  context = RUNNING,
  measure: 'portal_rating_count' | 'qualified_scans' = 'portal_rating_count',
) => openingChangeDraft(context, measure)

describe('portalGoalChangeModel', () => {
  it('opens on December after the 20th, on the number the goal has', () => {
    const model = portalGoalChangeModel(opened(), RUNNING)

    expect(model).toMatchObject({
      title: 'Change your monthly portal goal',
      months: [
        { value: 'now', label: 'November, now', disabled: false },
        { value: 'next', label: 'From Dec 1' },
      ],
      month: 'next',
      band: 'December',
      number: { text: '40', value: 40 },
      // Nothing to change yet.
      primary: { label: 'Set 40 from December', disabled: true },
      submission: null,
    })
  })

  it('no choice cards when changing', () => {
    const model = portalGoalChangeModel(opened(), RUNNING)

    expect(model.choices).toBeNull()
    expect(model.chosen).toBeNull()
    expect(model.status).toEqual({
      text: 'Your own number',
      restore: { label: 'Back to 45, recommended', value: 45 },
    })
  })

  it('next month says November stays at 40', () => {
    const model = portalGoalChangeModel(
      edit(opened(), { kind: 'type', text: '45' }),
      RUNNING,
    )

    expect(model).toMatchObject({
      description: 'November stays at 40.',
      status: {
        text: 'Recommended · a bit above your usual over the last 4 weeks',
        restore: null,
      },
      primary: { label: 'Set 45 from December', disabled: false },
      toast: 'From December: 45 private ratings',
      submission: {
        when: 'next',
        data: {
          programId: 'program-monthly',
          metric: 'portal_rating_count',
          targetValue: 45,
          expectedVersion: 1,
          targetSource: 'recommended',
        },
      },
    })
    // Not below pace: the next month has not begun.
    expect(model.notes).toEqual([])
  })

  it('starts below pace at 23 so far for 45 now', () => {
    const model = portalGoalChangeModel(
      edit(opened(), { kind: 'month', month: 'now' }, { kind: 'type', text: '45' }),
      RUNNING,
    )

    expect(model).toMatchObject({
      description:
        'November is judged against the new number, and so are the months after it.',
      month: 'now',
      band: 'November',
      // 23 × 30 × 100 = 69,000 < 90 × 45 × 22 = 89,100.
      notes: ['At 23 so far, 45 starts below pace.'],
      primary: { label: 'Set 45 for November', disabled: false },
      toast: 'November goal: 45 private ratings',
      submission: {
        when: 'now',
        data: {
          programId: 'program-monthly',
          month: '2026-11',
          targetValue: 45,
          expectedTarget: 40,
          expectedVersion: 1,
          expectedFollowingMonth: '2026-12',
          targetSource: 'own',
        },
      },
    })
    // 30 is not behind (69,000 ≥ 59,400), and 40, its own number, is no change.
    const lower = portalGoalChangeModel(
      edit(opened(), { kind: 'month', month: 'now' }, { kind: 'type', text: '30' }),
      RUNNING,
    )
    expect(lower.notes).toEqual([])
    const same = portalGoalChangeModel(
      edit(opened(), { kind: 'month', month: 'now' }, { kind: 'type', text: '40' }),
      RUNNING,
    )
    expect(same).toMatchObject({
      notes: [],
      primary: { disabled: true },
      submission: null,
    })
  })

  it('the rest of the month is recommended now, as the read offered it', () => {
    const model = portalGoalChangeModel(
      edit(opened(), { kind: 'month', month: 'now' }, { kind: 'type', text: '36' }),
      RUNNING,
    )

    expect(model.status.text).toBe(
      'Recommended · a bit above your usual over the last 4 weeks',
    )
    expect(model.submission?.data.targetSource).toBe('recommended')
  })

  it('the last day offers both months', () => {
    const lastDay = runningContext(CARD_LAST_DAY, new Date('2026-11-30T20:00:00.000Z'))
    const model = portalGoalChangeModel(
      openingChangeDraft(lastDay, 'portal_rating_count'),
      lastDay,
    )

    expect(model.months).toEqual([
      { value: 'now', label: 'November, now', disabled: false },
      { value: 'next', label: 'From Dec 1' },
    ])
    const now = portalGoalChangeModel(
      changedChangeDraft(
        changedChangeDraft(
          openingChangeDraft(lastDay, 'portal_rating_count'),
          { kind: 'month', month: 'now' },
          lastDay,
        ),
        { kind: 'type', text: '24' },
        lastDay,
      ),
      lastDay,
    )
    expect(now.submission).toMatchObject({ when: 'now', data: { month: '2026-11' } })
  })

  it('scans forces next and says November keeps counting private ratings', () => {
    const draft = edit(
      opened(),
      { kind: 'month', month: 'now' },
      { kind: 'measure', measure: 'qualified_scans' },
    )
    const model = portalGoalChangeModel(draft, RUNNING)

    expect(model).toMatchObject({
      months: [
        { value: 'now', label: 'November, now', disabled: true },
        { value: 'next', label: 'From Dec 1' },
      ],
      month: 'next',
      description: 'November keeps counting private ratings.',
      unit: 'scans',
      number: { text: '55' },
      asksEveryGuest: false,
      switchMeasure: {
        label: 'Count private ratings instead',
        measure: 'portal_rating_count',
      },
      primary: { label: 'Set 55 scans from December', disabled: false },
      toast: 'From December: 55 scans',
      submission: {
        when: 'next',
        data: { metric: 'qualified_scans', targetValue: 55, targetSource: 'recommended' },
      },
    })
    // A tap on the closed segment changes nothing.
    expect(
      portalGoalChangeModel(edit(draft, { kind: 'month', month: 'now' }), RUNNING).month,
    ).toBe('next')
  })

  it('the page menu opens it on scans, from December', () => {
    const model = portalGoalChangeModel(opened(RUNNING, 'qualified_scans'), RUNNING)

    expect(model).toMatchObject({
      month: 'next',
      number: { text: '55' },
      primary: { label: 'Set 55 scans from December', disabled: false },
    })
  })

  it('a note is sent trimmed, only when one was written', () => {
    const draft = edit(opened(), { kind: 'type', text: '45' })
    expect(portalGoalChangeModel(draft, RUNNING).note).toEqual({
      open: false,
      text: '',
      limit: 500,
    })

    const noted = edit(draft, { kind: 'note_open' }, { kind: 'note', text: '  Winter  ' })
    expect(portalGoalChangeModel(noted, RUNNING).submission?.data).toMatchObject({
      note: 'Winter',
    })
    const blank = edit(draft, { kind: 'note_open' }, { kind: 'note', text: '   ' })
    expect(portalGoalChangeModel(blank, RUNNING).submission?.data).not.toHaveProperty(
      'note',
    )
  })

  it('a month found ended leaves only the next month', () => {
    const draft = edit(opened(), { kind: 'month', month: 'now' }, { kind: 'now_closed' })
    const model = portalGoalChangeModel(draft, RUNNING)

    expect(model.months).toEqual([{ value: 'next', label: 'From Dec 1' }])
    expect(model.month).toBe('next')
  })

  it('a scheduled goal changes from its first month', () => {
    const scheduled = runningContext(CARD_SCHEDULED, new Date('2026-10-23T09:00:00.000Z'))
    const model = portalGoalChangeModel(
      changedChangeDraft(
        openingChangeDraft(scheduled, 'portal_rating_count'),
        { kind: 'type', text: '45' },
        scheduled,
      ),
      scheduled,
    )

    expect(model).toMatchObject({
      months: [{ value: 'next', label: 'From Nov 1' }],
      description: 'Starts on Nov 1.',
      band: 'November',
      primary: { label: 'Set 45 from November', disabled: false },
      toast: 'From November: 45 private ratings',
      submission: { when: 'next', data: { targetValue: 45, targetSource: 'own' } },
    })
  })

  it('never throws on letters, spaces or a huge number', () => {
    for (const text of ['abc', ' ', '12 345 678 901', '0']) {
      const model = portalGoalChangeModel(edit(opened(), { kind: 'type', text }), RUNNING)
      expect(model.submission).toBeNull()
      expect(model.primary.disabled).toBe(true)
    }
  })
})
