import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { getInboxItems } from './get-inbox-items'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type {
  InboxItem,
  InboxItemReplyState,
  InboxStatus,
  SourceType,
} from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import type { Role } from '#/shared/domain/roles'
import { isInboxError } from '../../domain/errors'
import type { ReplyLookupPort } from '../ports/reply-lookup.port'
import type { InboxViewRepository } from '../ports/inbox-view.repository'
import type { AiReviewInsightsPort } from '../ports/ai-review-insights.port'
import type { Cursor } from '../ports/inbox.repository'
import { createInboxRepository } from '#/contexts/reputation/inbox/inbox-repository.server'
import {
  buildFixtureItem,
  fixtureUuid,
  seedInboxScope,
} from '../../infrastructure/inbox-database-fixtures'

const SCOPE = 'get-inbox-items'
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-get-inbox-items-test')
const OTHER_ORG_ID = organizationId('org-get-inbox-items-other')
const PROP_ID = propertyId(fixtureUuid(SCOPE, 'prop-1'))
const OTHER_PROP_ID = propertyId(fixtureUuid(SCOPE, 'prop-2'))
const OTHER_ORG_PROP_ID = propertyId(fixtureUuid(SCOPE, 'prop-other-org'))
const USER_ID = userId('user-1')

const itemId = (label: string) => inboxItemId(fixtureUuid(SCOPE, label))

const pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })

const clearScope = async (orgId: string): Promise<void> => {
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [orgId])
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [orgId])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [orgId])
}

// Mock: AccountAdmin gets null (all access)
const adminStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

// Mock: Staff gets specific property IDs (scoped)
const createScopedStaffApi = (ids: ReadonlyArray<string>): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids.map(propertyId),
  getAssignedPortals: async () => [],
})

function seedItem(
  label: string,
  overrides: Partial<Omit<InboxItem, 'id'>> = {},
): InboxItem {
  return buildFixtureItem({
    organizationId: overrides.organizationId ?? ORG_ID,
    scope: SCOPE,
    label,
    status: (overrides.status ?? 'open') as InboxStatus,
    propertyId: overrides.propertyId ?? PROP_ID,
    sourceType: (overrides.sourceType ?? 'review') as SourceType,
    at: FIXED_TIME,
    overrides,
  })
}

const setup = (
  peopleApi: StaffPublicApi = adminStaffApi,
  replyStates: ReadonlyMap<string, InboxItemReplyState> = new Map(),
  viewedUpTo: Date | null = null,
  issueReviewIds: ReadonlyArray<string> = [],
) => {
  const aiInsights = {
    findCurrentReviewIdsByAttention: vi.fn(async () => []),
    findCurrentReviewIdsByIssue: vi.fn(async () => issueReviewIds.map(reviewId)),
  } as unknown as AiReviewInsightsPort
  const repo = createInboxRepository(
    getDb(),
    {
      reviewLookup: {
        getReviewSnippetById: async () => ({ status: 'not_found' as const }),
        getReviewSnippetsByIds: async () => new Map(),
        findEligibleReviewIds: async () => [],
      },
      feedbackLookup: {
        getFeedbackSnippetById: async () => null,
        getFeedbackSnippetsByIds: async () => new Map(),
        findEligibleFeedbackIds: async () => [],
      },
      propertyLookup: {
        getPropertyNameById: async () => null,
        getPropertyNamesByIds: async () => new Map(),
      },
      aiInsights,
    },
    { clock: () => FIXED_TIME, logger: createMockLogger() },
  )
  const getReplyStatesByReviewIds = vi.fn(async () => replyStates)
  const replyLookup: ReplyLookupPort = {
    getEffectiveReplyByReviewId: vi.fn(async () => null),
    getReplyMilestonesByReviewIds: vi.fn(async () => new Map()),
    getGoogleReplyHeadsByReviewIds: vi.fn(async () => new Map()),
    getReplyStatesByReviewIds,
    findReviewIdsByReplyStage: vi.fn(async () => ({ awaiting: [], waiting: [] })),
  }
  const viewRepo: InboxViewRepository = {
    getLastInboxView: vi.fn(async () => viewedUpTo),
    stampLastInboxView: vi.fn(async (_orgId, _userId, now) => now ?? FIXED_TIME),
  }
  const useCase = getInboxItems({
    repo,
    staffPublicApi: peopleApi,
    replyLookup,
    viewRepo,
    clock: () => FIXED_TIME,
  })
  const seed = async (...items: InboxItem[]) => {
    for (const orgId of new Set(items.map((item) => item.organizationId))) {
      await seedInboxScope(
        pool,
        orgId,
        orgId === ORG_ID ? [PROP_ID, OTHER_PROP_ID] : [OTHER_ORG_PROP_ID],
        items.filter((item) => item.organizationId === orgId),
        FIXED_TIME,
      )
    }
  }
  return { useCase, seed, getReplyStatesByReviewIds, replyLookup, viewRepo, aiInsights }
}

const adminCtx = {
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'AccountAdmin' as const,
} as AuthContext

const pmCtx = {
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'PropertyManager' as const,
} as AuthContext

const assignedManagerCtx = {
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'PropertyManager' as const,
} as AuthContext

const dynamicCtx = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Member',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'organization' as const]),
  ),
})

describe.sequential('getInboxItems', () => {
  beforeEach(async () => {
    await clearScope(ORG_ID)
    await clearScope(OTHER_ORG_ID)
  })

  afterAll(async () => {
    await clearScope(ORG_ID)
    await clearScope(OTHER_ORG_ID)
    await pool.end()
  })

  it('returns paginated items for an organization', async () => {
    const { useCase, seed } = setup()
    await seed(seedItem('ii-1'))
    await seed(seedItem('ii-2'))

    const result = await useCase({ filters: {} }, adminCtx)

    expect(result.items).toHaveLength(2)
    expect(result.totalCount).toBe(2)
    expect(result.nextCursor).toBeDefined()
    expect(result.responseCutoff).toEqual(FIXED_TIME)
    expect(result.viewedUpTo).toBeNull()
  })

  it('returns the caller watermark captured with the page', async () => {
    const viewedUpTo = new Date('2026-04-14T09:00:00Z')
    const { useCase, seed } = setup(adminStaffApi, new Map(), viewedUpTo)
    await seed(seedItem('ii-viewed-up-to'))

    const result = await useCase({ filters: {} }, adminCtx)

    expect(result.viewedUpTo).toEqual(viewedUpTo)
  })

  it('reads the visit watermark only for the first page', async () => {
    const cursorItem = seedItem('ii-watermark-cursor')
    const { useCase, viewRepo } = setup(
      adminStaffApi,
      new Map(),
      new Date('2026-04-14T09:00:00Z'),
    )

    const result = await useCase(
      {
        filters: {},
        cursor: { sourceDate: cursorItem.sourceDate, id: cursorItem.id },
      },
      adminCtx,
    )

    expect(result.viewedUpTo).toBeNull()
    expect(viewRepo.getLastInboxView).not.toHaveBeenCalled()
  })

  it('applies a reply queue through its effective stage ids', async () => {
    const awaiting = seedItem('ii-awaiting')
    const needsReply = seedItem('ii-needs-reply')
    const { useCase, seed, replyLookup } = setup()
    await seed(awaiting, needsReply)
    vi.mocked(replyLookup.findReviewIdsByReplyStage).mockResolvedValue({
      awaiting: [awaiting.sourceId as ReturnType<typeof reviewId>],
      waiting: [],
    })

    const result = await useCase({ filters: {}, queue: 'approval' }, adminCtx)

    expect(result.items.map((item) => item.id)).toEqual([awaiting.id])
    expect(replyLookup.findReviewIdsByReplyStage).toHaveBeenCalledWith(ORG_ID, undefined)
  })

  it('intersects a cross-source queue with the active source filter', async () => {
    const review = seedItem('ii-open-review')
    const feedback = seedItem('ii-open-feedback', {
      sourceType: 'feedback',
    })
    const { useCase, seed } = setup()
    await seed(review, feedback)

    const result = await useCase(
      { filters: { sourceType: 'feedback' }, queue: 'open' },
      adminCtx,
    )

    expect(result.items.map((item) => item.id)).toEqual([feedback.id])
  })

  it('returns no rows when a queue contradicts the active source filter', async () => {
    const feedback = seedItem('ii-feedback-queue', {
      sourceType: 'feedback',
    })
    const { useCase, seed } = setup()
    await seed(feedback)

    const result = await useCase(
      { filters: { sourceType: 'review' }, queue: 'feedback' },
      adminCtx,
    )

    expect(result.items).toEqual([])
    expect(result.totalCount).toBe(0)
  })

  it.each(['approval', 'waiting'] as const)(
    'refuses the %s queue without reply.manage',
    async (queue) => {
      const { useCase } = setup()

      await expect(
        useCase({ filters: {}, queue }, dynamicCtx('inbox.read', 'review.read')),
      ).rejects.toSatisfy(
        (error: unknown) => isInboxError(error) && error.code === 'forbidden',
      )
    },
  )

  describe('without reply stages, the reply queue is every open Review', () => {
    // The rail's one reply row is then labelled "Open" (ADR 0057, amended 2026-10-28).
    const seedMixed = async (seed: ReturnType<typeof setup>['seed']) => {
      const awaiting = seedItem('ii-awaiting')
      const needsReply = seedItem('ii-needs-reply')
      const closedReview = seedItem('ii-closed-review', { status: 'closed' })
      const feedback = seedItem('ii-open-feedback', {
        sourceType: 'feedback',
      })
      await seed(awaiting, needsReply, closedReview, feedback)
      return { awaiting, needsReply }
    }

    it('serves it to an actor without reply.manage, with no stage lookup', async () => {
      const { useCase, seed, replyLookup } = setup()
      const { awaiting, needsReply } = await seedMixed(seed)

      const result = await useCase(
        { filters: {}, queue: 'reply' },
        dynamicCtx('inbox.read', 'review.read', 'feedback.read'),
      )

      expect(result.items.map((item) => item.id).sort()).toEqual(
        [awaiting.id, needsReply.id].sort(),
      )
      expect(result.totalCount).toBe(2)
      expect(replyLookup.findReviewIdsByReplyStage).not.toHaveBeenCalled()
    })

    it('serves it when the boundary says reply publication is off, even to a manager', async () => {
      const { useCase, seed, replyLookup } = setup()
      const { awaiting, needsReply } = await seedMixed(seed)

      const result = await useCase(
        { filters: {}, queue: 'reply', replyQueuesEnabled: false },
        adminCtx,
      )

      expect(result.items.map((item) => item.id).sort()).toEqual(
        [awaiting.id, needsReply.id].sort(),
      )
      expect(replyLookup.findReviewIdsByReplyStage).not.toHaveBeenCalled()
    })

    it('still refuses the stage queues when the boundary says publication is off', async () => {
      const { useCase } = setup()

      await expect(
        useCase({ filters: {}, queue: 'approval', replyQueuesEnabled: false }, adminCtx),
      ).rejects.toSatisfy(
        (error: unknown) => isInboxError(error) && error.code === 'forbidden',
      )
    })
  })

  it('lists closed Reviews under Replied and closed feedback under Handled', async () => {
    const closedReview = seedItem('ii-closed-review', { status: 'closed' })
    const closedFeedback = seedItem('ii-closed-feedback', {
      status: 'closed',
      sourceType: 'feedback',
    })
    const openReview = seedItem('ii-open-review')
    const { useCase, seed } = setup()
    await seed(closedReview, closedFeedback, openReview)

    const replied = await useCase({ filters: {}, queue: 'replied' }, adminCtx)
    const handled = await useCase({ filters: {}, queue: 'handled' }, adminCtx)

    expect(replied.items.map((item) => item.id)).toEqual([closedReview.id])
    expect(replied.totalCount).toBe(1)
    expect(handled.items.map((item) => item.id)).toEqual([closedFeedback.id])
    expect(handled.totalCount).toBe(1)
  })

  it('omits reply state when the actor lacks reply.manage', async () => {
    const item = seedItem('ii-private-reply-state')
    const replyState: InboxItemReplyState = {
      status: 'pending_approval',
      publicationState: null,
      publicationLastErrorClass: null,
      updatedAt: FIXED_TIME,
    }
    const { useCase, seed, getReplyStatesByReviewIds } = setup(
      adminStaffApi,
      new Map([[String(item.sourceId), replyState]]),
    )
    await seed(item)

    const result = await useCase({ filters: {} }, dynamicCtx('inbox.read', 'review.read'))

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).not.toHaveProperty('replyState')
    expect(getReplyStatesByReviewIds).not.toHaveBeenCalled()
  })

  it('enriches every review row from one governed reply-state batch', async () => {
    const withReply = seedItem('ii-with-reply')
    const withoutReply = seedItem('ii-without-reply')
    const feedback = seedItem('ii-feedback', {
      sourceType: 'feedback',
    })
    const replyState: InboxItemReplyState = {
      status: 'approved',
      publicationState: 'pending_observation',
      publicationLastErrorClass: null,
      updatedAt: FIXED_TIME,
    }
    const { useCase, seed, getReplyStatesByReviewIds } = setup(
      adminStaffApi,
      new Map([[String(withReply.sourceId), replyState]]),
    )
    await seed(withReply, withoutReply, feedback)

    const result = await useCase(
      { filters: {} },
      dynamicCtx('inbox.read', 'review.read', 'feedback.read', 'reply.manage'),
    )

    expect(getReplyStatesByReviewIds).toHaveBeenCalledOnce()
    expect(getReplyStatesByReviewIds).toHaveBeenCalledWith(
      expect.arrayContaining([withReply.sourceId, withoutReply.sourceId]),
      ORG_ID,
    )
    expect(result.items.find((item) => item.id === withReply.id)?.replyState).toEqual(
      replyState,
    )
    expect(result.items.find((item) => item.id === withoutReply.id)).toHaveProperty(
      'replyState',
      null,
    )
    expect(result.items.find((item) => item.id === feedback.id)).not.toHaveProperty(
      'replyState',
    )
    expect(Object.keys(replyState)).toEqual([
      'status',
      'publicationState',
      'publicationLastErrorClass',
      'updatedAt',
    ])
  })

  it.each([
    [{}, ['1', '2', '3', '4', '5']],
    [{ status: 'open' as const }, ['1', '2', '3', '4']],
    [{ isEscalated: true }, ['4', '5']],
    [{ status: 'open' as const, isEscalated: true }, ['4']],
  ])('keeps status and escalation independent for %j', async (filters, expectedIds) => {
    const { useCase, seed } = setup()
    await seed(
      seedItem('1'),
      seedItem('2'),
      seedItem('3', { sourceType: 'feedback' }),
      seedItem('4', { isEscalated: true }),
      seedItem('5', {
        sourceType: 'feedback',
        status: 'closed',
        isEscalated: true,
      }),
    )

    const result = await useCase({ filters }, adminCtx)

    expect(result.items.map((item) => item.id).sort()).toEqual(
      expectedIds.map(itemId).sort(),
    )
    expect(result.totalCount).toBe(expectedIds.length)
  })

  it('filters by sourceType', async () => {
    const { useCase, seed } = setup()
    await seed(seedItem('ii-1', { sourceType: 'review' }))
    await seed(seedItem('ii-2', { sourceType: 'feedback' }))

    const result = await useCase({ filters: { sourceType: 'feedback' } }, adminCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.sourceType).toBe('feedback')
  })

  it('omits private-feedback rows when the caller lacks feedback.read', async () => {
    const { useCase, seed } = setup()
    await seed(seedItem('ii-review', { sourceType: 'review' }))
    await seed(
      seedItem('ii-feedback', {
        sourceType: 'feedback',
      }),
    )

    const result = await useCase({ filters: {} }, dynamicCtx('inbox.read', 'review.read'))

    expect(result.items.map((item) => item.sourceType)).toEqual(['review'])
    expect(result.totalCount).toBe(1)
  })

  it('intersects each source permission scope with Inbox scope', async () => {
    const { useCase, seed } = setup(createScopedStaffApi([PROP_ID]))
    await seed(
      seedItem('review-1', { sourceType: 'review', propertyId: PROP_ID }),
      seedItem('review-2', { sourceType: 'review', propertyId: OTHER_PROP_ID }),
      seedItem('feedback-1', {
        sourceType: 'feedback',
        propertyId: PROP_ID,
      }),
      seedItem('feedback-2', {
        sourceType: 'feedback',
        propertyId: OTHER_PROP_ID,
      }),
    )

    const result = await useCase(
      { filters: {} },
      createScopedAuthContext({
        organizationId: ORG_ID,
        userId: USER_ID,
        permissions: [
          ['inbox.read', 'organization'],
          ['review.read', 'organization'],
          ['feedback.read', 'assigned-properties'],
        ],
      }),
    )

    expect(result.items.map((item) => item.id).sort()).toEqual(
      [itemId('feedback-1'), itemId('review-1'), itemId('review-2')].sort(),
    )
    expect(result.totalCount).toBe(3)
  })

  it('returns an empty page for an explicitly requested unauthorized source', async () => {
    const { useCase, seed } = setup()
    await seed(
      seedItem('ii-feedback', {
        sourceType: 'feedback',
      }),
    )

    const result = await useCase(
      { filters: { sourceType: 'feedback' } },
      dynamicCtx('inbox.read', 'review.read'),
    )

    expect(result).toEqual({
      items: [],
      nextCursor: null,
      totalCount: 0,
      responseCutoff: FIXED_TIME,
      viewedUpTo: null,
    })
  })

  it('returns no source rows when Inbox read is not paired with an owning-context read', async () => {
    const { useCase, seed } = setup()
    await seed(seedItem('ii-review', { sourceType: 'review' }))

    const result = await useCase({ filters: {} }, dynamicCtx('inbox.read'))

    expect(result).toEqual({
      items: [],
      nextCursor: null,
      totalCount: 0,
      responseCutoff: FIXED_TIME,
      viewedUpTo: null,
    })
  })

  it('rejects a caller without inbox.read', async () => {
    const { useCase } = setup()

    await expect(
      useCase(
        { filters: {} },
        {
          organizationId: ORG_ID,
          userId: USER_ID,
          role: 'Guest' as unknown as Role,
        },
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
  })

  it('filters the in-memory repository by an aspect and polarity on one mention', async () => {
    const praise = seedItem('ii-praise')
    const complaint = seedItem('ii-complaint')
    const { useCase, seed, aiInsights } = setup(adminStaffApi, new Map(), null, [
      String(complaint.sourceId),
    ])
    await seed(praise, complaint)

    const result = await useCase(
      { filters: { issueId: 'wait_time', polarity: ['negative'] } },
      adminCtx,
    )

    expect(aiInsights.findCurrentReviewIdsByIssue).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'wait_time', polarities: ['negative'] }),
    )
    expect(result.items.map((item) => item.id)).toEqual([complaint.id])
    expect(result.totalCount).toBe(1)
  })

  it('filters by propertyId', async () => {
    const { useCase, seed } = setup()
    await seed(seedItem('ii-1', { propertyId: PROP_ID }))
    await seed(seedItem('ii-2', { propertyId: OTHER_PROP_ID }))

    const result = await useCase({ filters: { propertyId: PROP_ID } }, adminCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.propertyId).toBe(PROP_ID)
  })

  it('does not return items from other organizations', async () => {
    const { useCase, seed } = setup()
    await seed(seedItem('ii-1', { organizationId: ORG_ID }))
    await seed(
      seedItem('ii-2', { organizationId: OTHER_ORG_ID, propertyId: OTHER_ORG_PROP_ID }),
    )

    const result = await useCase({ filters: {} }, adminCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe(itemId('ii-1'))
  })

  it.each([
    [undefined, 1, ['ii-1', 'ii-3', 'ii-2']],
    [undefined, 2, ['ii-1', 'ii-3', 'ii-2']],
    ['newest' as const, 2, ['ii-1', 'ii-3', 'ii-2']],
    ['oldest' as const, 2, ['ii-2', 'ii-3', 'ii-1']],
  ])('paginates in %s order with page size %i', async (sort, limit, expectedIds) => {
    const { useCase, seed } = setup()
    const seeded = [
      seedItem('ii-1', { sourceDate: new Date('2026-04-12') }),
      seedItem('ii-2', { sourceDate: new Date('2026-04-10') }),
      seedItem('ii-3', { sourceDate: new Date('2026-04-11') }),
    ]
    await seed(...seeded)

    let cursor: Cursor | undefined
    for (let offset = 0; offset < expectedIds.length; offset += limit) {
      const page = await useCase({ filters: { sort }, cursor, limit }, adminCtx)

      expect(page.items.map((item) => item.id)).toEqual(
        expectedIds.slice(offset, offset + limit).map(itemId),
      )
      expect(page.totalCount).toBe(3)
      const last = seeded.find(
        (item) => item.id === itemId(expectedIds[offset + limit - 1] ?? ''),
      )!
      expect(page.nextCursor).toEqual(
        offset + limit < expectedIds.length
          ? { id: last.id, sourceDate: last.sourceDate }
          : null,
      )
      cursor = page.nextCursor ?? undefined
    }
  })

  // ── Property scoping tests (F-14 fix) ──────────────────────────────

  it('AccountAdmin sees all properties (org-wide role bypass)', async () => {
    const { useCase, seed } = setup(adminStaffApi)
    await seed(seedItem('ii-1', { propertyId: PROP_ID }))
    await seed(seedItem('ii-2', { propertyId: OTHER_PROP_ID }))

    const result = await useCase({ filters: {} }, adminCtx)

    expect(result.items).toHaveLength(2)
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    // PM holds inbox.manage, but per root CONTEXT.md L72 PM only manages
    // ASSIGNED properties — the read path must scope PM via staff_assignment.
    const scopedApi = createScopedStaffApi([PROP_ID])
    const { useCase, seed } = setup(scopedApi)
    await seed(seedItem('ii-1', { propertyId: PROP_ID }))
    await seed(seedItem('ii-2', { propertyId: OTHER_PROP_ID }))

    const result = await useCase({ filters: {} }, pmCtx)

    // Only the assigned property's item is visible
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.propertyId).toBe(PROP_ID)
  })

  it('allows PropertyManager to filter by an assigned property', async () => {
    const scopedApi = createScopedStaffApi([PROP_ID])
    const { useCase, seed } = setup(scopedApi)
    await seed(seedItem('ii-1', { propertyId: PROP_ID }))

    const result = await useCase({ filters: { propertyId: PROP_ID } }, pmCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.propertyId).toBe(PROP_ID)
  })

  it('denies PropertyManager when filtering by an unassigned property', async () => {
    const scopedApi = createScopedStaffApi([PROP_ID])
    const { useCase, seed } = setup(scopedApi)
    await seed(seedItem('ii-1', { propertyId: PROP_ID }))

    await expect(
      useCase({ filters: { propertyId: OTHER_PROP_ID } }, pmCtx),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('PropertyManager is property-scoped to accessible properties only', async () => {
    const scopedApi = createScopedStaffApi([PROP_ID])
    const { useCase, seed } = setup(scopedApi)
    await seed(seedItem('ii-1', { propertyId: PROP_ID }))
    await seed(seedItem('ii-2', { propertyId: OTHER_PROP_ID }))

    const result = await useCase({ filters: {} }, assignedManagerCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.propertyId).toBe(PROP_ID)
  })

  it('PropertyManager with no accessible properties sees nothing', async () => {
    const scopedApi = createScopedStaffApi([])
    const { useCase, seed } = setup(scopedApi)
    await seed(seedItem('ii-1'))

    const result = await useCase({ filters: {} }, assignedManagerCtx)

    expect(result.items).toHaveLength(0)
  })

  it('Member is denied when filtering by an inaccessible property', async () => {
    const scopedApi = createScopedStaffApi([PROP_ID])
    const { useCase, seed } = setup(scopedApi)
    await seed(seedItem('ii-1'))

    await expect(
      useCase({ filters: { propertyId: OTHER_PROP_ID } }, assignedManagerCtx),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('PropertyManager can filter by an accessible property', async () => {
    const scopedApi = createScopedStaffApi([PROP_ID])
    const { useCase, seed } = setup(scopedApi)
    await seed(seedItem('ii-1', { propertyId: PROP_ID }))

    const result = await useCase({ filters: { propertyId: PROP_ID } }, assignedManagerCtx)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.propertyId).toBe(PROP_ID)
  })
})
