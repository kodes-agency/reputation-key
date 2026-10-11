import { describe, expect, it } from 'vitest'
import { FIXTURE_ZONE, NOVEMBER } from './goal-month-target.stories.fixtures'
import { goalMonthTargetReceipt } from './goal-month-target-receipt'

const NOW = new Date('2026-10-22T09:00:00.000Z')

describe('goalMonthTargetReceipt', () => {
  const facts = {
    month: 'October',
    followingMonth: 'November',
    timezone: FIXTURE_ZONE,
    now: NOW,
    portalsOnly: true,
    // The months after were at 400 when the dialog opened.
    standing: { month: 'November', figure: '400', targetValue: 400 },
  }
  const changed = { previous: 400, next: 300 }

  it('says what the months after stay at when only the month was to change', () => {
    expect(
      goalMonthTargetReceipt(
        { month: changed, following: { outcome: 'not_requested' } },
        facts,
      ),
    ).toEqual({ tone: 'success', text: 'Target saved. November stays at 400.' })
  })

  it('says what a change that was already scheduled keeps the months after at', () => {
    // A second correction in one month: 300 from November was set by the
    // first, the box was left unticked, and only October moved to 350.
    const receipt = goalMonthTargetReceipt(
      {
        month: { previous: 300, next: 350 },
        following: { outcome: 'not_requested' },
      },
      { ...facts, standing: { month: 'November', figure: '300', targetValue: 300 } },
    )

    expect(receipt).toEqual({
      tone: 'success',
      text: 'Target saved. November stays at 300.',
    })
  })

  it('says only that the target was saved when the months after have it too', () => {
    // The month was put back on the target the months after never left.
    const receipt = goalMonthTargetReceipt(
      {
        month: { previous: 300, next: 400 },
        following: { outcome: 'not_requested' },
      },
      facts,
    )

    expect(receipt).toEqual({ tone: 'success', text: 'Target saved.' })
  })

  it('says from when the months after carry the target', () => {
    const receipt = goalMonthTargetReceipt(
      { month: changed, following: { outcome: 'applied', startsAt: NOVEMBER.start } },
      facts,
    )

    expect(receipt).toEqual({
      tone: 'success',
      text: 'Target saved. It also applies from Nov 1.',
    })
  })

  it('says a scheduled change was replaced', () => {
    const receipt = goalMonthTargetReceipt(
      {
        month: changed,
        following: { outcome: 'replaced_scheduled_change', startsAt: NOVEMBER.start },
      },
      facts,
    )

    expect(receipt).toEqual({
      tone: 'success',
      text: 'Target saved. It replaces the change that was scheduled from Nov 1.',
    })
  })

  it('says a scheduled change was kept, and that only the month changed', () => {
    const receipt = goalMonthTargetReceipt(
      { month: changed, following: { outcome: 'kept_scheduled_change' } },
      facts,
    )

    expect(receipt).toEqual({
      tone: 'warning',
      text: 'November already has its own change scheduled, so only October changed.',
    })
  })

  it('says why the months after were not changed', () => {
    const notApplied = (reason: 'subject_unavailable' | 'metric_unavailable') =>
      goalMonthTargetReceipt(
        { month: changed, following: { outcome: 'not_applied', reason } },
        facts,
      )

    expect(notApplied('subject_unavailable')).toEqual({
      tone: 'warning',
      text: 'October changed. November was not changed because a portal in this goal is archived.',
    })
    expect(notApplied('metric_unavailable')).toEqual({
      tone: 'warning',
      text: 'October changed. November was not changed because the measure is not available.',
    })
  })

  it('still says a sentence when the command gave no reason', () => {
    const receipt = goalMonthTargetReceipt(
      { month: changed, following: { outcome: 'not_applied' } },
      facts,
    )

    expect(receipt.text).toBe(
      'October changed. November was not changed because it could not take the new target.',
    )
  })

  it('does not call a group or the property a portal', () => {
    const receipt = goalMonthTargetReceipt(
      {
        month: changed,
        following: { outcome: 'not_applied', reason: 'subject_unavailable' },
      },
      { ...facts, portalsOnly: false },
    )

    expect(receipt.text).toBe(
      'October changed. November was not changed because a subject of this goal is no longer available.',
    )
  })

  it('never says a month changed when it already had the target', () => {
    const unchanged = (
      following: Parameters<typeof goalMonthTargetReceipt>[0]['following'],
    ) => goalMonthTargetReceipt({ month: 'unchanged', following }, facts)

    expect(unchanged({ outcome: 'not_requested' })).toEqual({
      tone: 'info',
      text: 'October already had this target.',
    })
    expect(unchanged({ outcome: 'applied', startsAt: NOVEMBER.start })).toEqual({
      tone: 'success',
      text: 'October already had this target. It also applies from Nov 1.',
    })
    expect(unchanged({ outcome: 'not_applied', reason: 'metric_unavailable' })).toEqual({
      tone: 'warning',
      text: 'October already had this target. November was not changed because the measure is not available.',
    })
    expect(unchanged({ outcome: 'kept_scheduled_change' })).toEqual({
      tone: 'warning',
      text: 'October already had this target. November keeps the change already scheduled for it.',
    })
  })
})
