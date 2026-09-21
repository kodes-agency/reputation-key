import { describe, expect, it } from 'vitest'
import {
  buildResponseTargetSnapshot,
  classifyResponseTargetCompletion,
  evaluateResponseTarget,
  isSupersededReminder,
  resolveGoogleReviewTargetPolicy,
  resolvePrivateFeedbackTargetPolicy,
  schedulableReminders,
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

describe('Google Review Response Target', () => {
  it('takes the Organization policy, and the 48-hour built-in default otherwise', () => {
    expect(
      resolveGoogleReviewTargetPolicy({ durationMinutes: 1_440, policyVersion: 2 }),
    ).toEqual({
      durationMinutes: 1_440,
      policySource: 'organization_policy',
      policyVersion: 2,
    })
    // There is no Property override for Google reviews — one policy per
    // Organization, so a manager cannot be measured against two clocks.
    expect(resolveGoogleReviewTargetPolicy(null)).toEqual({
      durationMinutes: 2_880,
      policySource: 'builtin_default',
      policyVersion: 1,
    })
  })

  it.each([
    ['a zero duration', { durationMinutes: 0, policyVersion: 1 }],
    ['a fractional duration', { durationMinutes: 90.5, policyVersion: 1 }],
    [
      'a duration beyond the 720-hour ceiling',
      { durationMinutes: 720 * 60 + 1, policyVersion: 1 },
    ],
    ['a zero policy version', { durationMinutes: 60, policyVersion: 0 }],
    ['a fractional policy version', { durationMinutes: 60, policyVersion: 1.5 }],
  ])('refuses %s rather than measuring against it', (_label, policy) => {
    // A stored policy that cannot be a duration is not a smaller target; it is
    // an unmeasurable one, and silently defaulting would report an SLA nobody set.
    expect(() => resolveGoogleReviewTargetPolicy(policy)).toThrow(/policy is invalid/i)
    expect(() =>
      resolvePrivateFeedbackTargetPolicy({
        organizationPolicy: null,
        propertyOverride: policy,
      }),
    ).toThrow(/policy is invalid/i)
  })
})

describe('schedulableReminders', () => {
  const snapshotFrom = (startAt: Date) =>
    buildResponseTargetSnapshot({
      targetKind: 'google_review_response',
      policy: {
        durationMinutes: 2_880,
        policySource: 'builtin_default',
        policyVersion: 1,
      },
      startAt,
    })

  it('keeps both slots for a target that starts when it is recorded', () => {
    expect(schedulableReminders(snapshotFrom(START), START)).toEqual([
      { kind: 'halfway', scheduledFor: new Date('2026-08-29T10:15:00.000Z') },
      { kind: 'target_passed', scheduledFor: new Date('2026-08-30T10:15:00.000Z') },
    ])
  })

  it('drops a slot already due when the target is recorded, even one due that very instant', () => {
    // Published a day before it was first observed: halfway is the recording
    // instant itself, so only the target-passed prompt can still help anyone.
    expect(
      schedulableReminders(snapshotFrom(START), new Date('2026-08-29T10:15:00.000Z')),
    ).toEqual([
      { kind: 'target_passed', scheduledFor: new Date('2026-08-30T10:15:00.000Z') },
    ])
  })

  it('records no slot for a target that had already passed when it was recorded', () => {
    // Google published this Review in 2015; RepKey first observed it today.
    expect(
      schedulableReminders(snapshotFrom(new Date('2015-06-01T10:00:00.000Z')), START),
    ).toEqual([])
  })

  it('refuses an unreadable recording instant rather than silently dropping every slot', () => {
    expect(() => schedulableReminders(snapshotFrom(START), new Date(Number.NaN))).toThrow(
      /timestamp is invalid/i,
    )
  })
})

describe('isSupersededReminder', () => {
  const DUE = new Date('2026-08-30T10:15:00.000Z')

  it('supersedes a halfway reminder once the target itself has passed', () => {
    expect(isSupersededReminder('halfway', DUE, DUE)).toBe(true)
    expect(
      isSupersededReminder('halfway', DUE, new Date('2026-09-02T10:15:00.000Z')),
    ).toBe(true)
  })

  it('keeps a halfway reminder while the target is ahead, and never supersedes target-passed', () => {
    expect(isSupersededReminder('halfway', DUE, new Date(DUE.getTime() - 1))).toBe(false)
    expect(isSupersededReminder('target_passed', DUE, DUE)).toBe(false)
  })
})

describe('classifyResponseTargetCompletion', () => {
  const DUE = new Date('2026-08-30T10:15:00.000Z')

  it('counts completion exactly ON the deadline as on time', () => {
    expect(classifyResponseTargetCompletion(DUE, DUE)).toBe('on_time')
  })

  it('counts a millisecond past it as late', () => {
    expect(classifyResponseTargetCompletion(DUE, new Date(DUE.getTime() + 1))).toBe(
      'late',
    )
  })
})

describe('evaluateResponseTarget — the measured arms', () => {
  const DUE = new Date('2026-08-30T10:15:00.000Z')
  const measured = {
    eligibility: 'measured',
    startAt: START,
    dueAt: DUE,
  } as const

  it('reports an active target as overdue only once the deadline has passed', () => {
    expect(
      evaluateResponseTarget(
        { ...measured, completionAt: null, result: null },
        new Date('2026-08-29T10:15:00.000Z'),
      ),
    ).toEqual({ state: 'active', overdue: false, elapsedMinutes: 1_440 })
    expect(
      evaluateResponseTarget({ ...measured, completionAt: null, result: null }, DUE),
    ).toEqual({ state: 'active', overdue: true, elapsedMinutes: 2_880 })
  })

  it('reports a completed target, and carries the late verdict rather than recomputing it', () => {
    expect(
      evaluateResponseTarget(
        {
          ...measured,
          completionAt: new Date('2026-08-29T10:15:00.000Z'),
          result: 'on_time',
        },
        new Date('2026-09-01T10:15:00.000Z'),
      ),
    ).toEqual({ state: 'completed', overdue: false, elapsedMinutes: 1_440 })
    expect(
      evaluateResponseTarget(
        {
          ...measured,
          completionAt: new Date('2026-08-31T10:15:00.000Z'),
          result: 'late',
        },
        new Date('2026-09-01T10:15:00.000Z'),
      ),
    ).toEqual({ state: 'completed', overdue: true, elapsedMinutes: 4_320 })
  })

  it('never reports negative elapsed time when a clock runs backwards', () => {
    expect(
      evaluateResponseTarget(
        { ...measured, completionAt: null, result: null },
        new Date('2026-08-27T10:15:00.000Z'),
      ).elapsedMinutes,
    ).toBe(0)
  })
})
