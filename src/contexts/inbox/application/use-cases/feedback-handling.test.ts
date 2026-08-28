import { describe, expect, it, vi } from 'vitest'
import { markFeedbackHandled } from './mark-feedback-handled'
import { correctFeedbackHandlingOutcome } from './correct-feedback-handling-outcome'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { FeedbackHandlingStore } from '../ports/feedback-handling.store'

const NOW = new Date('2026-08-27T12:00:00.000Z')
const ORG_ID = organizationId('org-feedback-handling')
const ITEM_ID = inboxItemId('550e8400-e29b-41d4-a716-446655440021')
const PROPERTY_ID = propertyId('550e8400-e29b-41d4-a716-446655440022')
const ACTOR_ID = userId('manager-feedback-handling')
const OUTCOME_ID = '550e8400-e29b-41d4-a716-446655440026'

const item = (sourceType: 'feedback' | 'review' = 'feedback'): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  sourceType,
  sourceId:
    sourceType === 'feedback'
      ? feedbackId('550e8400-e29b-41d4-a716-446655440023')
      : reviewId('550e8400-e29b-41d4-a716-446655440024'),
  status: 'open',
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  rating: 2,
  sourceDate: NOW,
  platform: null,
  snippet: 'The room was not ready.',
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: NOW,
  updatedAt: NOW,
})

const ctx = createScopedAuthContext({
  organizationId: ORG_ID,
  userId: ACTOR_ID,
  permissions: [
    ['inbox.write', 'assigned-properties'],
    ['feedback.handle', 'assigned-properties'],
  ],
})

const staffApi = (propertyIds = [PROPERTY_ID]): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => propertyIds,
  getAssignedPortals: async () => [],
})

const expected = {
  commandRevision: 1,
  cycleNumber: 1,
  sourceRevision: 1,
  stateRevision: 1,
} as const

function setup(seed = item()) {
  const repo = createInMemoryInboxRepo()
  repo.items.push(seed)
  const handled = {
    ...seed,
    status: 'closed' as const,
    closedAt: NOW,
    commandRevision: 2,
  }
  const store = {
    getState: vi.fn(async () => null),
    markHandled: vi.fn(async () => ({ item: handled, feedbackHandling: null })),
    correctOutcome: vi.fn(async () => ({
      item: { ...handled, commandRevision: 3 },
      feedbackHandling: null,
    })),
  } as unknown as FeedbackHandlingStore
  return { repo, store }
}

const deterministicDependencies = {
  clock: () => NOW,
  idGen: () => OUTCOME_ID,
} as const

describe('markFeedbackHandled', () => {
  it('authorizes the exact private-feedback Property and delegates one outcome', async () => {
    const { repo, store } = setup()
    const execute = markFeedbackHandled({
      repo,
      store,
      staffPublicApi: staffApi(),
      ...deterministicDependencies,
    })

    const result = await execute(
      {
        inboxItemId: ITEM_ID,
        expected,
        outcome: 'follow_up_attempted',
        internalNote: 'Left a voicemail and sent an email.',
      },
      ctx,
    )

    expect(result.item).toMatchObject({ status: 'closed', rating: 2 })
    expect(store.markHandled).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({ sourceType: 'feedback', rating: 2 }),
        expected,
        outcome: 'follow_up_attempted',
        actorUserId: ACTOR_ID,
      }),
    )
  })

  it('rejects Review items and inaccessible private feedback', async () => {
    const review = setup(item('review'))
    const inaccessible = setup()

    await expect(
      markFeedbackHandled({
        repo: review.repo,
        store: review.store,
        staffPublicApi: staffApi(),
        ...deterministicDependencies,
      })(
        {
          inboxItemId: ITEM_ID,
          expected,
          outcome: 'reviewed_no_additional_step',
          internalNote: null,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      markFeedbackHandled({
        repo: inaccessible.repo,
        store: inaccessible.store,
        staffPublicApi: staffApi([]),
        ...deterministicDependencies,
      })(
        {
          inboxItemId: ITEM_ID,
          expected,
          outcome: 'reviewed_no_additional_step',
          internalNote: null,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(review.store.markHandled).not.toHaveBeenCalled()
    expect(inaccessible.store.markHandled).not.toHaveBeenCalled()
  })
})

describe('correctFeedbackHandlingOutcome', () => {
  it('delegates a correction through the same manager authority without reopening', async () => {
    const closed = item()
    const { repo, store } = setup({
      ...closed,
      status: 'closed',
      closedAt: NOW,
      commandRevision: 2,
    })
    const execute = correctFeedbackHandlingOutcome({
      repo,
      store,
      staffPublicApi: staffApi(),
      ...deterministicDependencies,
    })

    const result = await execute(
      {
        inboxItemId: ITEM_ID,
        expected: {
          commandRevision: 2,
          cycleNumber: 1,
          sourceRevision: 1,
          stateRevision: 2,
          outcomeRevision: 1,
          outcomeId: '550e8400-e29b-41d4-a716-446655440025',
        },
        outcome: 'handled_with_team',
        internalNote: null,
      },
      ctx,
    )

    expect(result.item).toMatchObject({ status: 'closed', rating: 2 })
    expect(store.correctOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'handled_with_team',
        actorUserId: ACTOR_ID,
      }),
    )
  })
})
