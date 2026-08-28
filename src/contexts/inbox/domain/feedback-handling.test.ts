import { describe, expect, it } from 'vitest'
import {
  correctFeedbackHandlingOutcome,
  recordFeedbackHandlingOutcome,
} from './feedback-handling'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { HandlingCycleHead } from './types'

const RECORDED_AT = new Date('2026-08-27T12:00:00.000Z')
const CORRECTED_AT = new Date('2026-08-27T13:00:00.000Z')
const ACTOR_ID = userId('manager-feedback-handling')

const feedbackHead = (status: 'open' | 'closed'): HandlingCycleHead => ({
  inboxItemId: inboxItemId('550e8400-e29b-41d4-a716-446655440001'),
  organizationId: organizationId('org-feedback-handling'),
  propertyId: propertyId('550e8400-e29b-41d4-a716-446655440002'),
  sourceType: 'feedback',
  sourceId: feedbackId('550e8400-e29b-41d4-a716-446655440003'),
  currentCycleNumber: 2,
  currentSourceRevision: 4,
  stateRevision: status === 'open' ? 3 : 4,
  status,
})

describe('private-feedback handling outcomes', () => {
  it('records exactly one controlled outcome and an Inbox-only optional note', () => {
    const result = recordFeedbackHandlingOutcome({
      id: '550e8400-e29b-41d4-a716-446655440004',
      current: feedbackHead('open'),
      outcome: 'follow_up_completed',
      internalNote: '  Guest confirmed the follow-up helped.  ',
      recordedBy: ACTOR_ID,
      recordedAt: RECORDED_AT,
      deadlineResult: 'not_measured',
    })

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value).toMatchObject({
      outcomeRevision: 1,
      outcome: 'follow_up_completed',
      internalNote: 'Guest confirmed the follow-up helped.',
      completionAt: RECORDED_AT,
      deadlineResult: 'not_measured',
      supersedesOutcomeId: null,
    })
  })

  it('rejects Review cycles and already-closed feedback cycles', () => {
    const reviewHead: HandlingCycleHead = {
      ...feedbackHead('open'),
      sourceType: 'review',
      sourceId: reviewId('550e8400-e29b-41d4-a716-446655440005'),
    }
    const make = (current: HandlingCycleHead) =>
      recordFeedbackHandlingOutcome({
        id: '550e8400-e29b-41d4-a716-446655440006',
        current,
        outcome: 'follow_up_attempted',
        internalNote: null,
        recordedBy: ACTOR_ID,
        recordedAt: RECORDED_AT,
        deadlineResult: 'not_measured',
      })

    expect(make(reviewHead).isErr()).toBe(true)
    expect(make(feedbackHead('closed')).isErr()).toBe(true)
  })

  it('appends a superseding correction without changing completion evidence', () => {
    const original = recordFeedbackHandlingOutcome({
      id: '550e8400-e29b-41d4-a716-446655440007',
      current: feedbackHead('open'),
      outcome: 'follow_up_attempted',
      internalNote: null,
      recordedBy: ACTOR_ID,
      recordedAt: RECORDED_AT,
      deadlineResult: 'late',
    })
    expect(original.isOk()).toBe(true)
    if (original.isErr()) return

    const corrected = correctFeedbackHandlingOutcome({
      id: '550e8400-e29b-41d4-a716-446655440008',
      current: feedbackHead('closed'),
      previous: original.value,
      outcome: 'handled_with_team',
      internalNote: 'Discussed during the manager handover.',
      recordedBy: ACTOR_ID,
      recordedAt: CORRECTED_AT,
    })

    expect(corrected.isOk()).toBe(true)
    if (corrected.isErr()) return
    expect(corrected.value).toMatchObject({
      outcomeRevision: 2,
      outcome: 'handled_with_team',
      recordedAt: CORRECTED_AT,
      completionAt: RECORDED_AT,
      deadlineResult: 'late',
      supersedesOutcomeId: original.value.id,
    })
  })

  it('rejects corrections outside the current closed feedback cycle', () => {
    const original = recordFeedbackHandlingOutcome({
      id: '550e8400-e29b-41d4-a716-446655440009',
      current: feedbackHead('open'),
      outcome: 'reviewed_no_additional_step',
      internalNote: null,
      recordedBy: ACTOR_ID,
      recordedAt: RECORDED_AT,
      deadlineResult: 'on_time',
    })
    expect(original.isOk()).toBe(true)
    if (original.isErr()) return

    const openCycle = correctFeedbackHandlingOutcome({
      id: '550e8400-e29b-41d4-a716-446655440010',
      current: feedbackHead('open'),
      previous: original.value,
      outcome: 'content_concern_reviewed',
      internalNote: null,
      recordedBy: ACTOR_ID,
      recordedAt: CORRECTED_AT,
    })
    const laterCycle = correctFeedbackHandlingOutcome({
      id: '550e8400-e29b-41d4-a716-446655440011',
      current: { ...feedbackHead('closed'), currentCycleNumber: 3 },
      previous: original.value,
      outcome: 'content_concern_reviewed',
      internalNote: null,
      recordedBy: ACTOR_ID,
      recordedAt: CORRECTED_AT,
    })

    expect(openCycle.isErr()).toBe(true)
    expect(laterCycle.isErr()).toBe(true)
  })

  it('rejects unsupported outcomes and unbounded internal notes', () => {
    const base = {
      id: '550e8400-e29b-41d4-a716-446655440012',
      current: feedbackHead('open'),
      internalNote: null,
      recordedBy: ACTOR_ID,
      recordedAt: RECORDED_AT,
      deadlineResult: 'not_measured' as const,
    }

    expect(
      recordFeedbackHandlingOutcome({
        ...base,
        outcome: 'closed' as never,
      }).isErr(),
    ).toBe(true)
    expect(
      recordFeedbackHandlingOutcome({
        ...base,
        outcome: 'follow_up_completed',
        internalNote: 'x'.repeat(2_001),
      }).isErr(),
    ).toBe(true)
  })
})
