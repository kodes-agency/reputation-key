import { describe, expect, it } from 'vitest'
import {
  buildResponseTargetSnapshot,
  evaluateResponseTarget,
  resolvePrivateFeedbackTargetPolicy,
} from './response-target'

const START = new Date('2026-08-28T10:15:00.000Z')

describe('Private Feedback Handling Target', () => {
  it('uses Property override, then Organization policy, then the 48-hour built-in default', () => {
    expect(
      resolvePrivateFeedbackTargetPolicy({
        organizationPolicy: { durationMinutes: 2_880, policyVersion: 3 },
        propertyOverride: { durationMinutes: 720, policyVersion: 7 },
      }),
    ).toEqual({
      durationMinutes: 720,
      policySource: 'property_override',
      policyVersion: 7,
    })
    expect(
      resolvePrivateFeedbackTargetPolicy({
        organizationPolicy: { durationMinutes: 2_880, policyVersion: 3 },
        propertyOverride: null,
      }),
    ).toEqual({
      durationMinutes: 2_880,
      policySource: 'organization_policy',
      policyVersion: 3,
    })
    expect(
      resolvePrivateFeedbackTargetPolicy({
        organizationPolicy: null,
        propertyOverride: null,
      }),
    ).toEqual({
      durationMinutes: 2_880,
      policySource: 'builtin_default',
      policyVersion: 1,
    })
  })

  it('snapshots UTC start/due and exactly one halfway and one target-passed reminder', () => {
    const snapshot = buildResponseTargetSnapshot({
      targetKind: 'private_feedback_handling',
      policy: {
        durationMinutes: 2_880,
        policySource: 'organization_policy',
        policyVersion: 4,
      },
      startAt: START,
    })

    expect(snapshot).toEqual({
      targetKind: 'private_feedback_handling',
      eligibility: 'measured',
      durationMinutes: 2_880,
      policySource: 'organization_policy',
      policyVersion: 4,
      startAt: START,
      dueAt: new Date('2026-08-30T10:15:00.000Z'),
      reminders: [
        {
          kind: 'halfway',
          scheduledFor: new Date('2026-08-29T10:15:00.000Z'),
        },
        {
          kind: 'target_passed',
          scheduledFor: new Date('2026-08-30T10:15:00.000Z'),
        },
      ],
    })
  })

  it('derives overdue from the clock without changing workflow status', () => {
    const target = {
      eligibility: 'measured' as const,
      startAt: START,
      dueAt: new Date('2026-08-30T10:15:00.000Z'),
      completionAt: null,
      result: null,
    }

    expect(evaluateResponseTarget(target, new Date('2026-08-30T10:14:59.999Z'))).toEqual({
      state: 'active',
      overdue: false,
      elapsedMinutes: 2_879,
    })
    expect(evaluateResponseTarget(target, target.dueAt)).toEqual({
      state: 'active',
      overdue: true,
      elapsedMinutes: 2_880,
    })
  })

  it('excludes legacy-unknown and withdrawn cycles from performance', () => {
    expect(
      evaluateResponseTarget(
        {
          eligibility: 'legacy_unknown',
          startAt: null,
          dueAt: null,
          completionAt: null,
          result: null,
        },
        START,
      ),
    ).toEqual({ state: 'excluded', overdue: false, elapsedMinutes: null })
    expect(
      evaluateResponseTarget(
        {
          eligibility: 'measured',
          startAt: START,
          dueAt: new Date('2026-08-30T10:15:00.000Z'),
          completionAt: new Date('2026-08-29T10:15:00.000Z'),
          result: 'cancelled',
        },
        new Date('2026-08-31T10:15:00.000Z'),
      ),
    ).toEqual({ state: 'cancelled', overdue: false, elapsedMinutes: null })
  })
})
