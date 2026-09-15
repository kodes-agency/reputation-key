import { describe, expect, it, vi } from 'vitest'
import { getInboxPropertyCounts } from './get-inbox-property-counts'
import { getInboxQueueCounts } from './get-inbox-queue-counts'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { ReplyLookupPort } from '../ports/reply-lookup.port'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const VIEWER = userId('user-1')
const ELEGANCE = propertyId('prop-elegance')
const RILA = propertyId('prop-rila')
const BLACK_SEA = propertyId('prop-black-sea')
const AWAITING = reviewId('10000000-0000-4000-8000-000000000001')

const allAccessStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const scopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
  getAssignedPortals: async () => [],
})

const makeItem = ({
  id,
  ...overrides
}: Partial<Omit<InboxItem, 'id'>> & { id: string }): InboxItem => ({
  id: inboxItemId(id),
  organizationId: ORG_ID,
  propertyId: ELEGANCE,
  sourceType: 'review',
  sourceId: reviewId(`20000000-0000-4000-8000-${id.padStart(12, '0')}`),
  status: 'open',
  rating: null,
  sourceDate: new Date('2026-09-01T10:00:00Z'),
  platform: null,
  snippet: null,
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  updatedAt: new Date('2026-09-01T10:00:00Z'),
  ...overrides,
})

function replyLookup(
  findStages = vi.fn(async () => ({ awaiting: [AWAITING], waiting: [] })),
): ReplyLookupPort {
  return {
    getEffectiveReplyByReviewId: async () => null,
    getReplyMilestonesByReviewIds: async () => new Map(),
    getReplyStatesByReviewIds: async () => new Map(),
    findReviewIdsByReplyStage: findStages,
  }
}

const accountAdmin: AuthContext = {
  organizationId: ORG_ID,
  userId: VIEWER,
  role: 'AccountAdmin',
}

const member: AuthContext = {
  organizationId: ORG_ID,
  userId: VIEWER,
  role: 'Member',
}

/** Needs reply: Elegance 2, Rila 1. Awaiting approval: Elegance 1. Feedback: Black Sea 1. */
function seedPortfolio(repo: ReturnType<typeof createInMemoryInboxRepo>) {
  repo.items.push(
    makeItem({ id: '1' }),
    makeItem({ id: '2' }),
    makeItem({ id: '3', sourceId: AWAITING }),
    makeItem({ id: '4', propertyId: RILA }),
    makeItem({ id: '5', propertyId: RILA, status: 'closed' }),
    makeItem({
      id: '6',
      propertyId: BLACK_SEA,
      sourceType: 'feedback',
      sourceId: feedbackId('30000000-0000-4000-8000-000000000006'),
    }),
  )
}

describe('getInboxPropertyCounts', () => {
  it('counts one queue per property, with the organization total', async () => {
    const repo = createInMemoryInboxRepo()
    seedPortfolio(repo)
    const useCase = getInboxPropertyCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(),
    })

    await expect(useCase({ queue: 'reply' }, accountAdmin)).resolves.toEqual({
      queue: 'reply',
      total: 3,
      byProperty: { [ELEGANCE]: 2, [RILA]: 1 },
    })
    await expect(useCase({ queue: 'approval' }, accountAdmin)).resolves.toEqual({
      queue: 'approval',
      total: 1,
      byProperty: { [ELEGANCE]: 1 },
    })
  })

  it('agrees with the queue rail: the total is the queue count at organization scope', async () => {
    const repo = createInMemoryInboxRepo()
    seedPortfolio(repo)
    const deps = {
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(),
    }

    const [byProperty, queues] = await Promise.all([
      getInboxPropertyCounts(deps)({ queue: 'open' }, accountAdmin),
      getInboxQueueCounts(deps)({}, accountAdmin),
    ])

    expect(byProperty.total).toBe(queues.open)
  })

  it('reads the reply stages only for a reply-stage queue', async () => {
    const repo = createInMemoryInboxRepo()
    seedPortfolio(repo)
    const findStages = vi.fn(async () => ({ awaiting: [AWAITING], waiting: [] }))
    const useCase = getInboxPropertyCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(findStages),
    })

    await useCase({ queue: 'feedback' }, accountAdmin)
    expect(findStages).not.toHaveBeenCalled()

    await useCase({ queue: 'waiting' }, accountAdmin)
    expect(findStages).toHaveBeenCalledOnce()
    expect(findStages).toHaveBeenCalledWith(ORG_ID, undefined)
  })

  it('counts only the properties an assigned viewer can see', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(
      makeItem({ id: '1', propertyId: ELEGANCE }),
      makeItem({ id: '2', propertyId: RILA }),
      makeItem({ id: '3', propertyId: BLACK_SEA }),
    )
    const useCase = getInboxPropertyCounts({
      repo,
      staffPublicApi: scopedStaffApi([RILA, BLACK_SEA]),
      replyLookup: replyLookup(),
    })

    await expect(useCase({ queue: 'open' }, member)).resolves.toEqual({
      queue: 'open',
      total: 2,
      byProperty: { [RILA]: 1, [BLACK_SEA]: 1 },
    })
  })

  it('is empty for an assigned viewer with no properties', async () => {
    const repo = createInMemoryInboxRepo()
    seedPortfolio(repo)
    const useCase = getInboxPropertyCounts({
      repo,
      staffPublicApi: scopedStaffApi([]),
      replyLookup: replyLookup(),
    })

    await expect(useCase({ queue: 'open' }, member)).resolves.toEqual({
      queue: 'open',
      total: 0,
      byProperty: {},
    })
  })

  it('refuses a reply-stage queue without reply.manage, before reading anything', async () => {
    const findStages = vi.fn(async () => ({ awaiting: [], waiting: [] }))
    const getAccessiblePropertyIds = vi.fn(async () => null)
    const useCase = getInboxPropertyCounts({
      repo: createInMemoryInboxRepo(),
      staffPublicApi: { getAccessiblePropertyIds, getAssignedPortals: async () => [] },
      replyLookup: replyLookup(findStages),
    })

    await expect(useCase({ queue: 'reply' }, member)).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'forbidden',
    })
    expect(getAccessiblePropertyIds).not.toHaveBeenCalled()
    expect(findStages).not.toHaveBeenCalled()
  })

  it('rejects a caller without inbox.read', async () => {
    const useCase = getInboxPropertyCounts({
      repo: createInMemoryInboxRepo(),
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(),
    })

    await expect(
      useCase({ queue: 'open' }, { ...member, effectivePermissions: new Set() }),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'forbidden' })
  })
})
