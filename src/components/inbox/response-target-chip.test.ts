import { describe, expect, it } from 'vitest'
import type { ResponseTargetView } from '#/contexts/inbox/application/public-api'
import { presentResponseTargetChip } from './response-target-chip'

/** Fixed clock: the repo forbids tests that read the wall clock. */
const NOW = new Date('2026-08-26T01:00:00.000Z')

const TARGET: ResponseTargetView = {
  inboxItemId:
    '11111111-1111-4111-8111-111111111111' as ResponseTargetView['inboxItemId'],
  cycleNumber: 1,
  organizationId: 'org-1' as ResponseTargetView['organizationId'],
  propertyId: '22222222-2222-4222-8222-222222222222' as ResponseTargetView['propertyId'],
  targetKind: 'google_review_response',
  eligibility: 'measured',
  durationMinutes: 2_880,
  policySource: 'organization_policy',
  policyVersion: 3,
  startAt: new Date('2026-08-25T08:00:00.000Z'),
  dueAt: new Date('2026-08-27T08:00:00.000Z'),
  completionAt: null,
  result: null,
  stopReason: null,
  propertyTimezone: 'America/New_York',
  evaluation: { state: 'active', overdue: false, elapsedMinutes: 1_020 },
}

const activeTarget = (dueAt: string, overdue = false): ResponseTargetView => ({
  ...TARGET,
  dueAt: new Date(dueAt),
  evaluation: { state: 'active', overdue, elapsedMinutes: 1_020 },
})

const completedTarget = (result: 'on_time' | 'late'): ResponseTargetView => ({
  ...TARGET,
  completionAt: new Date('2026-08-26T00:00:00.000Z'),
  result,
  stopReason: 'confirmed_on_google',
  evaluation: { state: 'completed', overdue: result === 'late', elapsedMinutes: 960 },
})

const feedbackTarget = (target: ResponseTargetView): ResponseTargetView => ({
  ...target,
  targetKind: 'private_feedback_handling',
})

const excludedTarget = (
  eligibility: 'historical_onboarding' | 'legacy_unknown',
): ResponseTargetView => ({
  ...TARGET,
  eligibility,
  durationMinutes: null,
  policySource: null,
  policyVersion: null,
  startAt: null,
  dueAt: null,
  evaluation: { state: 'excluded', overdue: false, elapsedMinutes: null },
})

describe('response target chip', () => {
  it('counts down with the exact due time in the Property timezone', () => {
    expect(presentResponseTargetChip(TARGET, NOW)).toMatchObject({
      label: 'Reply due in 31 h',
      tone: 'neutral',
      dueLabel: 'Aug 27, 2026, 4:00 AM',
      timezone: 'America/New_York',
      description:
        'Timing starts from the saved Google publication, meaningful review update, or reopen time for this cycle.',
    })
  })

  it('warns from exactly twelve hours out, not a minute earlier', () => {
    const atTheBoundary = activeTarget('2026-08-26T13:00:00.000Z')
    const oneMinuteBefore = activeTarget('2026-08-26T13:01:00.000Z')

    expect(presentResponseTargetChip(atTheBoundary, NOW)).toMatchObject({
      label: 'Reply due in 12 h',
      tone: 'warning',
    })
    expect(presentResponseTargetChip(oneMinuteBefore, NOW)).toMatchObject({
      label: 'Reply due in 12 h',
      tone: 'neutral',
    })
  })

  it('rounds to the largest whole unit and never prints a bare number', () => {
    expect(
      presentResponseTargetChip(activeTarget('2026-08-26T01:45:00.000Z'), NOW).label,
    ).toBe('Reply due in 45 m')
    expect(
      presentResponseTargetChip(activeTarget('2026-08-26T07:00:00.000Z'), NOW).label,
    ).toBe('Reply due in 6 h')
    expect(
      presentResponseTargetChip(activeTarget('2026-08-28T01:00:00.000Z'), NOW).label,
    ).toBe('Reply due in 2 d')
  })

  it('says under a minute instead of rounding the last seconds to zero', () => {
    expect(
      presentResponseTargetChip(activeTarget('2026-08-26T01:00:59.000Z'), NOW).label,
    ).toBe('Reply due in under a minute')
  })

  it('names how far an open cycle has run past its target', () => {
    expect(
      presentResponseTargetChip(activeTarget('2026-08-24T01:00:00.000Z', true), NOW),
    ).toMatchObject({
      label: 'Overdue by 2 d',
      tone: 'negative',
      description:
        'The item remains open for follow-up. Escalation is managed separately.',
    })
  })

  it('separates a reply inside the target from one after it', () => {
    expect(presentResponseTargetChip(completedTarget('on_time'), NOW)).toMatchObject({
      label: 'Replied on time',
      tone: 'positive',
      description:
        'A current response was observed live on Google within the saved target.',
    })
    expect(presentResponseTargetChip(completedTarget('late'), NOW)).toMatchObject({
      label: 'Replied late',
      tone: 'neutral',
      description:
        'A current response was observed live on Google after the saved target and remains included in reporting.',
    })
  })

  it('asks feedback items to be handled rather than replied to', () => {
    expect(presentResponseTargetChip(feedbackTarget(TARGET), NOW)).toMatchObject({
      label: 'Handle within 31 h',
      tone: 'neutral',
      description:
        'Timing starts from the feedback submission or reopen time for this cycle.',
    })
    expect(
      presentResponseTargetChip(feedbackTarget(completedTarget('on_time')), NOW),
    ).toMatchObject({
      label: 'Handled on time',
      description: 'The feedback handling cycle was completed within its saved target.',
    })
    expect(
      presentResponseTargetChip(feedbackTarget(completedTarget('late')), NOW),
    ).toMatchObject({
      label: 'Handled late',
      description:
        'The feedback handling cycle was completed and remains included in reporting.',
    })
  })

  it('counts a feedback deadline down rather than naming a clock time', () => {
    // `Handle by 6 h` would read as six o'clock; the preposition has to govern
    // a duration on both kinds.
    expect(
      presentResponseTargetChip(
        feedbackTarget(activeTarget('2026-08-26T07:00:00.000Z')),
        NOW,
      ).label,
    ).toBe('Handle within 6 h')
    expect(
      presentResponseTargetChip(
        feedbackTarget(activeTarget('2026-08-26T01:45:00.000Z')),
        NOW,
      ).label,
    ).toBe('Handle within 45 m')
    expect(
      presentResponseTargetChip(
        feedbackTarget(activeTarget('2026-08-26T01:00:59.000Z')),
        NOW,
      ).label,
    ).toBe('Handle within under a minute')
  })

  it('warns a feedback item from exactly twelve hours out, like a review', () => {
    expect(
      presentResponseTargetChip(
        feedbackTarget(activeTarget('2026-08-26T13:00:00.000Z')),
        NOW,
      ),
    ).toMatchObject({ label: 'Handle within 12 h', tone: 'warning' })
    expect(
      presentResponseTargetChip(
        feedbackTarget(activeTarget('2026-08-26T13:01:00.000Z')),
        NOW,
      ),
    ).toMatchObject({ label: 'Handle within 12 h', tone: 'neutral' })
  })

  it('shares Overdue by with review items instead of a handling verb', () => {
    expect(
      presentResponseTargetChip(
        feedbackTarget(activeTarget('2026-08-24T01:00:00.000Z', true)),
        NOW,
      ).label,
    ).toBe('Overdue by 2 d')
  })

  it('states why onboarding history and legacy cycles are not measured', () => {
    expect(
      presentResponseTargetChip(excludedTarget('historical_onboarding'), NOW),
    ).toMatchObject({
      label: 'Not measured',
      tone: 'muted',
      dueLabel: null,
      description:
        'This review was imported as onboarding history, so its earlier response time is not included in target reporting.',
    })
    expect(
      presentResponseTargetChip(excludedTarget('legacy_unknown'), NOW).description,
    ).toBe(
      'Reliable timing is unavailable for this earlier review cycle, so it is not included in target reporting.',
    )
    expect(
      presentResponseTargetChip(feedbackTarget(excludedTarget('legacy_unknown')), NOW)
        .description,
    ).toBe(
      'Reliable timing is unavailable for this earlier feedback cycle, so it is not included in target reporting.',
    )
  })

  it('keeps a cancelled cycle out of reporting without a countdown', () => {
    expect(
      presentResponseTargetChip(
        {
          ...TARGET,
          result: 'cancelled',
          stopReason: 'guest_withdrawn',
          evaluation: { state: 'cancelled', overdue: false, elapsedMinutes: null },
        },
        NOW,
      ),
    ).toMatchObject({
      label: 'Not measured',
      tone: 'muted',
      description: 'This cycle is excluded from response-target reporting.',
    })
  })

  it('has no exact due time when the cycle never had one', () => {
    expect(
      presentResponseTargetChip({ ...completedTarget('on_time'), dueAt: null }, NOW)
        .dueLabel,
    ).toBeNull()
  })
})
