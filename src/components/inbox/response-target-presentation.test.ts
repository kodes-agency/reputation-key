import { describe, expect, it } from 'vitest'
import type { ResponseTargetView } from '#/contexts/inbox/application/public-api'
import { presentResponseTarget } from './response-target-presentation'

const TARGET: ResponseTargetView = {
  inboxItemId:
    '11111111-1111-4111-8111-111111111111' as ResponseTargetView['inboxItemId'],
  cycleNumber: 1,
  organizationId: 'org-1' as ResponseTargetView['organizationId'],
  propertyId: '22222222-2222-4222-8222-222222222222' as ResponseTargetView['propertyId'],
  targetKind: 'private_feedback_handling',
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
  evaluation: { state: 'active', overdue: false, elapsedMinutes: 60 },
}

describe('response target presentation', () => {
  it('shows active timing in the Property timezone', () => {
    expect(presentResponseTarget(TARGET)).toMatchObject({
      status: 'In progress',
      dueLabel: 'Aug 27, 2026, 4:00 AM',
      tone: 'neutral',
    })
  })

  it('explains the saved Google timing anchors without implying every cycle starts at Inbox opening', () => {
    expect(
      presentResponseTarget({
        ...TARGET,
        targetKind: 'google_review_response',
      }).description,
    ).toBe(
      'Timing starts from the saved Google publication, meaningful review update, or reopen time for this cycle.',
    )
  })

  it('uses calm overdue copy without implying automatic escalation', () => {
    expect(
      presentResponseTarget({
        ...TARGET,
        evaluation: { state: 'active', overdue: true, elapsedMinutes: 3_000 },
      }),
    ).toMatchObject({
      status: 'Target time passed',
      description:
        'The item remains open for follow-up. Escalation is managed separately.',
      tone: 'attention',
    })
  })

  it('states why onboarding history and legacy cycles are excluded', () => {
    const excluded = {
      ...TARGET,
      targetKind: 'google_review_response' as const,
      durationMinutes: null,
      policySource: null,
      policyVersion: null,
      startAt: null,
      dueAt: null,
      evaluation: {
        state: 'excluded' as const,
        overdue: false,
        elapsedMinutes: null,
      },
    }

    expect(
      presentResponseTarget({
        ...excluded,
        eligibility: 'historical_onboarding',
      }).description,
    ).toBe(
      'This review was imported as onboarding history, so its earlier response time is not included in target reporting.',
    )
    expect(
      presentResponseTarget({
        ...excluded,
        eligibility: 'legacy_unknown',
      }).description,
    ).toBe(
      'Reliable timing is unavailable for this earlier review cycle, so it is not included in target reporting.',
    )
  })

  it('describes Google completion as observed live instead of only confirmed publication', () => {
    expect(
      presentResponseTarget({
        ...TARGET,
        targetKind: 'google_review_response',
        completionAt: new Date('2026-08-26T08:00:00.000Z'),
        result: 'on_time',
        stopReason: 'confirmed_on_google',
        evaluation: { state: 'completed', overdue: false, elapsedMinutes: 1_440 },
      }).description,
    ).toBe('A current response was observed live on Google within the saved target.')
  })

  it('distinguishes completion, cancellation, and unmeasured legacy cycles', () => {
    expect(
      presentResponseTarget({
        ...TARGET,
        completionAt: new Date('2026-08-26T08:00:00.000Z'),
        result: 'on_time',
        stopReason: 'private_feedback_handled',
        evaluation: { state: 'completed', overdue: false, elapsedMinutes: 1_440 },
      }).status,
    ).toBe('Completed within target')
    expect(
      presentResponseTarget({
        ...TARGET,
        result: 'cancelled',
        stopReason: 'guest_withdrawn',
        evaluation: { state: 'cancelled', overdue: false, elapsedMinutes: null },
      }).status,
    ).toBe('Cancelled')
    expect(
      presentResponseTarget({
        ...TARGET,
        eligibility: 'legacy_unknown',
        durationMinutes: null,
        policySource: null,
        policyVersion: null,
        startAt: null,
        dueAt: null,
        evaluation: { state: 'excluded', overdue: false, elapsedMinutes: null },
      }).status,
    ).toBe('Not measured')
  })
})
