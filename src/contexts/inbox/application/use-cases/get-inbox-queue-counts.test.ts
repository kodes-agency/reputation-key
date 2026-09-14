import { describe, expect, it, vi } from 'vitest'
import { getInboxQueueCounts } from './get-inbox-queue-counts'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { ReplyLookupPort } from '../ports/reply-lookup.port'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
  userId,
} from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const VIEWER = userId('user-1')
const AWAITING = reviewId('10000000-0000-4000-8000-000000000001')
const WAITING = reviewId('10000000-0000-4000-8000-000000000002')

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
  propertyId: propertyId('prop-1'),
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
  findStages = vi.fn(async () => ({ awaiting: [AWAITING], waiting: [WAITING] })),
): ReplyLookupPort {
  return {
    getEffectiveReplyByReviewId: async () => null,
    getReplyMilestonesByReviewIds: async () => new Map(),
    getReplyStatesByReviewIds: async () => new Map(),
    findReviewIdsByReplyStage: findStages,
  }
}

const manager: AuthContext = {
  organizationId: ORG_ID,
  userId: VIEWER,
  role: 'AccountAdmin',
}

const reader: AuthContext = {
  organizationId: ORG_ID,
  userId: VIEWER,
  role: 'Member',
  effectivePermissions: new Set(['inbox.read', 'review.read', 'feedback.read']),
  scopeByPermission: new Map([
    ['inbox.read', 'organization'],
    ['review.read', 'organization'],
    ['feedback.read', 'organization'],
  ]),
}

function seedQueueCases(repo: ReturnType<typeof createInMemoryInboxRepo>) {
  repo.items.push(
    makeItem({ id: '1' }),
    makeItem({ id: '2', sourceId: AWAITING }),
    makeItem({ id: '3', sourceId: WAITING }),
    makeItem({
      id: '4',
      sourceType: 'feedback',
      sourceId: feedbackId('30000000-0000-4000-8000-000000000004'),
    }),
    makeItem({ id: '5', assignedTo: VIEWER }),
    makeItem({ id: '6', status: 'closed', isEscalated: true }),
    makeItem({ id: '7', isEscalated: true }),
  )
}

describe('getInboxQueueCounts', () => {
  it('counts every queue with the exact list predicates and one stage lookup', async () => {
    const repo = createInMemoryInboxRepo()
    seedQueueCases(repo)
    const findStages = vi.fn(async () => ({ awaiting: [AWAITING], waiting: [WAITING] }))
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(findStages),
    })

    await expect(useCase({}, manager)).resolves.toEqual({
      reply: 3,
      approval: 1,
      waiting: 1,
      feedback: 1,
      escalated: 2,
      mine: 1,
      closed: 1,
      open: 6,
    })
    expect(findStages).toHaveBeenCalledOnce()
    expect(findStages).toHaveBeenCalledWith(ORG_ID, undefined)
  })

  it('withholds reply-stage counts and their lookup without reply.manage', async () => {
    const repo = createInMemoryInboxRepo()
    seedQueueCases(repo)
    const findStages = vi.fn(async () => ({ awaiting: [AWAITING], waiting: [WAITING] }))
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(findStages),
    })

    await expect(useCase({}, reader)).resolves.toEqual({
      reply: null,
      approval: null,
      waiting: null,
      feedback: 1,
      escalated: 2,
      mine: 1,
      closed: 1,
      open: 6,
    })
    expect(findStages).not.toHaveBeenCalled()
  })

  it('withholds reply-stage counts when reply publication is disabled', async () => {
    const repo = createInMemoryInboxRepo()
    seedQueueCases(repo)
    const findStages = vi.fn(async () => ({ awaiting: [AWAITING], waiting: [WAITING] }))
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(findStages),
    })

    await expect(useCase({ replyQueuesEnabled: false }, manager)).resolves.toEqual({
      reply: null,
      approval: null,
      waiting: null,
      feedback: 1,
      escalated: 2,
      mine: 1,
      closed: 1,
      open: 6,
    })
    expect(findStages).not.toHaveBeenCalled()
  })

  it('narrows all counts and the stage lookup to an accessible property', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(
      makeItem({ id: '1', propertyId: propertyId('prop-1') }),
      makeItem({ id: '2', propertyId: propertyId('prop-2') }),
    )
    const findStages = vi.fn(async () => ({ awaiting: [], waiting: [] }))
    const useCase = getInboxQueueCounts({
      repo,
      staffPublicApi: scopedStaffApi(['prop-1', 'prop-2']),
      replyLookup: replyLookup(findStages),
    })
    const propertyManager = { ...manager, role: 'PropertyManager' as const }

    const counts = await useCase({ propertyId: 'prop-2' }, propertyManager)

    expect(counts.open).toBe(1)
    expect(counts.reply).toBe(1)
    expect(findStages).toHaveBeenCalledWith(ORG_ID, [propertyId('prop-2')])
  })

  it('refuses an inaccessible property', async () => {
    const useCase = getInboxQueueCounts({
      repo: createInMemoryInboxRepo(),
      staffPublicApi: scopedStaffApi(['prop-1']),
      replyLookup: replyLookup(),
    })

    await expect(
      useCase({ propertyId: 'prop-2' }, { ...manager, role: 'PropertyManager' }),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'forbidden' })
  })

  it('rejects a caller without inbox.read', async () => {
    const useCase = getInboxQueueCounts({
      repo: createInMemoryInboxRepo(),
      staffPublicApi: allAccessStaffApi,
      replyLookup: replyLookup(),
    })

    await expect(
      useCase({}, { ...reader, effectivePermissions: new Set() }),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'forbidden' })
  })
})
