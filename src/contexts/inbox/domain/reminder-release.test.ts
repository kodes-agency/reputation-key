import { describe, expect, it } from 'vitest'
import {
  REMINDER_GOOGLE_CHECK_DELAY_CAP_MS,
  decideReminderAfterGoogleCheck,
  holdsForAnsweringReply,
  planReminderRelease,
  type ReminderReplyHead,
} from './reminder-release'

const TARGET_START = new Date('2026-09-01T08:00:00.000Z')
const SCHEDULED_FOR = new Date('2026-09-02T08:00:00.000Z')
const MINUTE = 60_000
const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * MINUTE)

const answering: ReminderReplyHead = {
  state: 'live',
  resolution: 'external_current_live',
  materialReviewRevision: 4,
  observedAt: at(TARGET_START, 60),
}

const scope = {
  targetStartAt: TARGET_START,
  cycleMaterialReviewRevision: 4,
} as const

describe('holdsForAnsweringReply', () => {
  it.each([
    ['a reply written on Google', answering],
    [
      'RepKey reply confirmed on Google',
      { ...answering, resolution: 'confirmed_on_google' },
    ],
    [
      'a reply seen at the very instant the target started',
      { ...answering, observedAt: TARGET_START },
    ],
  ] as const)('holds for %s', (_name, head) => {
    expect(holdsForAnsweringReply({ head, ...scope })).toBe(true)
  })

  it.each([
    ['no head at all', undefined],
    ['Google showing no reply', { ...answering, state: 'absent', resolution: 'absent' }],
    ['a reply carried over a guest edit', { ...answering, resolution: 'unchanged' }],
    [
      'a reply that differs from what RepKey sent',
      { ...answering, resolution: 'diverged' },
    ],
    [
      'a reply observed before the target started (reopened after it)',
      { ...answering, observedAt: at(TARGET_START, -1) },
    ],
    ['a reply on another material revision', { ...answering, materialReviewRevision: 3 }],
    ['a reply on a newer material revision', { ...answering, materialReviewRevision: 5 }],
  ] as const)('does not hold for %s', (_name, head) => {
    expect(holdsForAnsweringReply({ head, ...scope })).toBe(false)
  })

  it('does not hold when the target start is unknown', () => {
    expect(
      holdsForAnsweringReply({ head: answering, ...scope, targetStartAt: null }),
    ).toBe(false)
  })
})

describe('planReminderRelease', () => {
  const base = {
    targetKind: 'google_review_response',
    reminderKind: 'target_passed',
    targetDueAt: SCHEDULED_FOR,
    now: at(SCHEDULED_FOR, 1),
    head: undefined,
    ...scope,
  } as const

  it('checks a target-passed Google reminder when nothing local settles it', () => {
    expect(planReminderRelease(base)).toBe('check')
  })

  it('holds without a read when the local head already shows an answering reply', () => {
    expect(planReminderRelease({ ...base, head: answering })).toBe('hold_local')
  })

  it('releases a private feedback reminder without asking Google', () => {
    expect(
      planReminderRelease({ ...base, targetKind: 'private_feedback_handling' }),
    ).toBe('release_unchecked')
  })

  it('releases a private feedback reminder even when a review head exists', () => {
    expect(
      planReminderRelease({
        ...base,
        targetKind: 'private_feedback_handling',
        head: answering,
      }),
    ).toBe('release_unchecked')
  })

  it('leaves a superseded halfway reminder to the store, with no read', () => {
    expect(
      planReminderRelease({
        ...base,
        reminderKind: 'halfway',
        targetDueAt: at(SCHEDULED_FOR, 0),
        now: at(SCHEDULED_FOR, 5),
      }),
    ).toBe('release_unchecked')
  })

  it('checks a halfway reminder whose target has not passed yet', () => {
    expect(
      planReminderRelease({
        ...base,
        reminderKind: 'halfway',
        targetDueAt: at(SCHEDULED_FOR, 600),
      }),
    ).toBe('check')
  })
})

describe('decideReminderAfterGoogleCheck', () => {
  const decide = (input: Partial<Parameters<typeof decideReminderAfterGoogleCheck>[0]>) =>
    decideReminderAfterGoogleCheck({
      outcome: 'read',
      head: answering,
      scheduledFor: SCHEDULED_FOR,
      now: at(SCHEDULED_FOR, 2),
      ...scope,
      ...input,
    })

  describe('after a successful read', () => {
    it('holds when Google shows an answering reply on this cycle', () => {
      expect(decide({})).toBe('hold')
    })

    it('releases when Google shows no reply', () => {
      expect(
        decide({ head: { ...answering, state: 'absent', resolution: 'absent' } }),
      ).toBe('release')
    })

    it('releases when there is no head at all', () => {
      expect(decide({ head: undefined })).toBe('release')
    })

    it('releases when the reply was observed before the target started', () => {
      expect(decide({ head: { ...answering, observedAt: at(TARGET_START, -5) } })).toBe(
        'release',
      )
    })

    it('releases when the read created a new material revision', () => {
      expect(decide({ head: { ...answering, materialReviewRevision: 5 } })).toBe(
        'release',
      )
    })

    it('releases when the reply is only a carried-over one', () => {
      expect(decide({ head: { ...answering, resolution: 'unchanged' } })).toBe('release')
    })
  })

  describe('when the reply cannot be read', () => {
    it('releases, because a translation-only reply can never close the item', () => {
      expect(decide({ outcome: 'reply_unreadable' })).toBe('release')
    })

    it('releases even if an older head would have held', () => {
      expect(decide({ outcome: 'reply_unreadable', head: answering })).toBe('release')
    })
  })

  describe('when the review cannot be checked at all', () => {
    it('releases at once for content that is no longer active', () => {
      expect(decide({ outcome: 'not_checkable', head: undefined })).toBe('release')
    })

    it('releases at once for a permanent provider condition, with no wait', () => {
      expect(decide({ outcome: 'permanent_failure', head: undefined })).toBe('release')
    })

    it('releases at once for a permanent condition even while the cap has time left', () => {
      expect(
        decide({
          outcome: 'permanent_failure',
          head: undefined,
          now: at(SCHEDULED_FOR, 1),
        }),
      ).toBe('release')
    })
  })

  describe('transient failures wait at most 15 minutes from scheduled_for', () => {
    it.each(['transient_failure', 'review_missing'] as const)(
      'defers a %s one minute after scheduled_for',
      (outcome) => {
        expect(decide({ outcome, head: undefined, now: at(SCHEDULED_FOR, 1) })).toBe(
          'defer',
        )
      },
    )

    it('defers one millisecond before the cap', () => {
      expect(
        decide({
          outcome: 'transient_failure',
          head: undefined,
          now: new Date(SCHEDULED_FOR.getTime() + REMINDER_GOOGLE_CHECK_DELAY_CAP_MS - 1),
        }),
      ).toBe('defer')
    })

    it('releases exactly at the cap', () => {
      expect(
        decide({
          outcome: 'transient_failure',
          head: undefined,
          now: new Date(SCHEDULED_FOR.getTime() + REMINDER_GOOGLE_CHECK_DELAY_CAP_MS),
        }),
      ).toBe('release')
    })

    it('releases a slot found far past the cap when its read fails', () => {
      expect(
        decide({
          outcome: 'transient_failure',
          head: undefined,
          now: at(SCHEDULED_FOR, 240),
        }),
      ).toBe('release')
    })

    it('releases a 404 once the cap has passed', () => {
      expect(
        decide({
          outcome: 'review_missing',
          head: undefined,
          now: at(SCHEDULED_FOR, 16),
        }),
      ).toBe('release')
    })
  })

  it('caps the delay at fifteen minutes', () => {
    expect(REMINDER_GOOGLE_CHECK_DELAY_CAP_MS).toBe(15 * MINUTE)
  })
})
