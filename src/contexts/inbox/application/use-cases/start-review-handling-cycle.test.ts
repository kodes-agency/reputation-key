import { describe, expect, it, vi } from 'vitest'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
  userId,
} from '#/shared/domain/ids'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import type { ReviewHandlingCycleStore } from '../ports/review-handling-cycle.store'
import type { ReviewSourceLookupPort } from '../ports/review-source-lookup.port'
import type { ReviewResponseTargetAuthorityPort } from '../ports/review-response-target-authority.port'
import type { InboxItem } from '../../domain/types'
import { isInboxError } from '../../domain/errors'
import { startReviewHandlingCycle } from './start-review-handling-cycle'

const NOW = new Date('2026-08-27T03:00:00.000Z')
const PROVIDER_TIME = new Date('2026-08-26T03:00:00.000Z')
const ORG_ID = organizationId('org-inbox-start-cycle-1')
const ITEM_ID = inboxItemId('inbox-start-cycle-1')
const REVIEW_ID = reviewId('review-start-cycle-1')
const USER_ID = userId('user-start-cycle-1')
const PROP_ID = propertyId('property-start-cycle-1')

const reviewSourceLookup: ReviewSourceLookupPort = {
  getReviewSourceMetaById: async () => ({
    id: REVIEW_ID,
    propertyId: PROP_ID,
    platform: 'google',
    sourceEpoch: 1,
    sourceDate: PROVIDER_TIME,
    contentExpiresAt: null,
    materialReviewRevision: 2,
  }),
  getReviewSourceMetaByIds: async () => [],
  listReviewSources: async () => [],
}

const responseTargetAuthority: ReviewResponseTargetAuthorityPort = {
  withExactCurrent: async (expectation, apply) => ({
    status: 'current',
    value: await apply({
      ...expectation,
      authority: 'review.current-response-target.v1',
      materialReviewRevision: 2,
      eligibility: 'measured',
      responseTargetStartAt: PROVIDER_TIME,
    }),
  }),
  withExactCurrentBatch: async () => ({ status: 'obsolete' }),
  withInboxProjection: async () => ({ status: 'obsolete' }),
}

const makeItem = (sourceType: InboxItem['sourceType'] = 'review'): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROP_ID,
  sourceType,
  sourceId: sourceType === 'review' ? REVIEW_ID : feedbackId('feedback-start-cycle-1'),
  status: 'closed',
  rating: null,
  sourceDate: NOW,
  platform: sourceType === 'review' ? 'google' : null,
  snippet: null,
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  closedAt: NOW,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 4,
  createdAt: NOW,
  updatedAt: NOW,
})

const makeCycleStore = () => {
  const startNext = vi.fn<ReviewHandlingCycleStore['startNext']>()
  const store: ReviewHandlingCycleStore = {
    findHead: vi.fn(async () => null),
    listCycles: vi.fn(async () => []),
    startNext,
  }
  return { store, startNext }
}

describe('startReviewHandlingCycle', () => {
  it('fails when the stable Inbox item does not exist', async () => {
    const repo = createInMemoryInboxRepo()
    const { store, startNext } = makeCycleStore()
    const execute = startReviewHandlingCycle({
      inboxRepo: repo,
      cycleStore: store,
      reviewSourceLookup,
      responseTargetAuthority,
      clock: () => NOW,
    })

    await expect(
      execute({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        expected: { cycleNumber: 1, materialReviewRevision: 1, stateRevision: 1 },
        materialReviewRevision: 2,
        openedReason: 'material_revision_changed',
        openedBy: null,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'not_found',
    )
    expect(startNext).not.toHaveBeenCalled()
  })

  it('rejects a feedback item because this command owns Review cycles only', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem('feedback'))
    const { store, startNext } = makeCycleStore()
    const execute = startReviewHandlingCycle({
      inboxRepo: repo,
      cycleStore: store,
      reviewSourceLookup,
      responseTargetAuthority,
      clock: () => NOW,
    })

    await expect(
      execute({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        expected: { cycleNumber: 1, materialReviewRevision: 1, stateRevision: 1 },
        materialReviewRevision: 1,
        openedReason: 'manual_reopen',
        openedBy: USER_ID,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
    expect(startNext).not.toHaveBeenCalled()
  })

  it('forwards the exact expected head and one clock timestamp for a Review', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem())
    const { store, startNext } = makeCycleStore()
    const result = {
      cycle: {
        inboxItemId: ITEM_ID,
        cycleNumber: 2,
        organizationId: ORG_ID,
        propertyId: propertyId('property-start-cycle-1'),
        reviewId: REVIEW_ID,
        materialReviewRevision: 2,
        openedReason: 'material_revision_changed' as const,
        manualReopenReason: null,
        manualReopenExplanation: null,
        supersedesCycleNumber: 1,
        openedBy: null,
        openedAt: NOW,
      },
      head: {
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        propertyId: propertyId('property-start-cycle-1'),
        reviewId: REVIEW_ID,
        currentCycleNumber: 2,
        currentMaterialReviewRevision: 2,
        stateRevision: 2,
        status: 'open' as const,
      },
    }
    startNext.mockResolvedValue(result)
    const clock = vi.fn(() => NOW)
    const execute = startReviewHandlingCycle({
      inboxRepo: repo,
      cycleStore: store,
      reviewSourceLookup,
      responseTargetAuthority,
      clock,
    })
    const input = {
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      expected: { cycleNumber: 1, materialReviewRevision: 1, stateRevision: 3 },
      materialReviewRevision: 2,
      openedReason: 'material_revision_changed' as const,
      openedBy: null,
    }

    await expect(execute(input)).resolves.toBe(result)
    expect(clock).toHaveBeenCalledTimes(1)
    expect(startNext).toHaveBeenCalledWith({
      ...input,
      openedAt: NOW,
      responseTarget: {
        reviewAuthority: {
          authority: 'review.current-response-target.v1',
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          reviewId: REVIEW_ID,
          sourceEpoch: 1,
          materialReviewRevision: 2,
          eligibility: 'measured',
          responseTargetStartAt: PROVIDER_TIME,
        },
        targetStart: { basis: 'review_provenance' },
      },
    })
  })

  it('starts a manual-reopen target at the reopen instant, not the provider date', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem())
    const { store, startNext } = makeCycleStore()
    startNext.mockResolvedValue({} as never)
    const execute = startReviewHandlingCycle({
      inboxRepo: repo,
      cycleStore: store,
      reviewSourceLookup,
      responseTargetAuthority,
      clock: () => NOW,
    })

    await execute({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      expected: { cycleNumber: 1, materialReviewRevision: 2, stateRevision: 3 },
      materialReviewRevision: 2,
      openedReason: 'manual_reopen',
      manualReopenReason: 'new_information',
      openedBy: USER_ID,
    })

    expect(startNext).toHaveBeenCalledWith(
      expect.objectContaining({
        responseTarget: {
          reviewAuthority: expect.objectContaining({
            responseTargetStartAt: PROVIDER_TIME,
          }),
          targetStart: { basis: 'operational_reopen', at: NOW },
        },
      }),
    )
  })
})
