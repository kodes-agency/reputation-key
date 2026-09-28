import { describe, expect, it, vi } from 'vitest'
import {
  getReviewInboxItemIds,
  REVIEW_INBOX_ITEM_LOOKUP_LIMIT,
} from './get-review-inbox-item-ids'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import type { InboxItem } from '../../domain/types'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-2')
const USER_ID = userId('user-1')
const PROPERTY = propertyId('prop-1')
const OTHER_PROPERTY = propertyId('prop-2')
const REVIEW_WITH_ITEM = reviewId('10000000-0000-4000-8000-000000000001')
const SECOND_REVIEW_WITH_ITEM = reviewId('10000000-0000-4000-8000-000000000002')
const REVIEW_WITHOUT_ITEM = reviewId('10000000-0000-4000-8000-000000000003')

const ctxWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Member',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'organization' as const]),
  ),
})

/** Reads Reviews in the Inbox only at the assigned Properties. */
const assignedCtx = (): AuthContext =>
  createScopedAuthContext({
    organizationId: ORG_ID,
    userId: USER_ID,
    permissions: [
      ['inbox.read', 'assigned-properties'],
      ['review.read', 'assigned-properties'],
    ],
  })

const makeReviewItem = (
  id: string,
  overrides: Readonly<{
    sourceId: string
    propertyId?: PropertyId
    organizationId?: OrganizationId
  }>,
): InboxItem => ({
  id: inboxItemId(id),
  organizationId: overrides.organizationId ?? ORG_ID,
  propertyId: overrides.propertyId ?? PROPERTY,
  sourceType: 'review',
  sourceId: reviewId(overrides.sourceId),
  status: 'open',
  rating: null,
  sourceDate: new Date('2026-09-08T12:00:00.000Z'),
  platform: 'google',
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
  createdAt: new Date('2026-09-08T12:00:00.000Z'),
  updatedAt: new Date('2026-09-08T12:00:00.000Z'),
})

const staffWithAccess = (
  accessible: ReadonlyArray<PropertyId> | null,
): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

function setup(staffPublicApi: StaffPublicApi = staffWithAccess(null)) {
  const repo = createInMemoryInboxRepo()
  repo.items.push(
    makeReviewItem('20000000-0000-4000-8000-000000000001', {
      sourceId: REVIEW_WITH_ITEM,
    }),
    makeReviewItem('20000000-0000-4000-8000-000000000002', {
      sourceId: SECOND_REVIEW_WITH_ITEM,
    }),
  )
  const findActiveReviewItemIds = vi.spyOn(repo, 'findActiveReviewItemIds')
  return {
    repo,
    findActiveReviewItemIds,
    useCase: getReviewInboxItemIds({ repo, staffPublicApi }),
  }
}

const ALL_REVIEWS = [REVIEW_WITH_ITEM, SECOND_REVIEW_WITH_ITEM, REVIEW_WITHOUT_ITEM]

describe('getReviewInboxItemIds', () => {
  it('maps each Review with an Inbox Item to it and leaves the others out', async () => {
    const { useCase } = setup()

    const itemIds = await useCase(
      { propertyId: PROPERTY, reviewIds: ALL_REVIEWS },
      ctxWith('inbox.read', 'review.read'),
    )

    expect(itemIds).toEqual(
      new Map([
        [REVIEW_WITH_ITEM, inboxItemId('20000000-0000-4000-8000-000000000001')],
        [SECOND_REVIEW_WITH_ITEM, inboxItemId('20000000-0000-4000-8000-000000000002')],
      ]),
    )
  })

  it('reads only the requested Property within the caller organization', async () => {
    const { repo, useCase, findActiveReviewItemIds } = setup()
    repo.items.push(
      makeReviewItem('20000000-0000-4000-8000-000000000003', {
        sourceId: REVIEW_WITHOUT_ITEM,
        propertyId: OTHER_PROPERTY,
      }),
      makeReviewItem('20000000-0000-4000-8000-000000000004', {
        sourceId: REVIEW_WITHOUT_ITEM,
        organizationId: OTHER_ORG_ID,
      }),
    )

    const itemIds = await useCase(
      { propertyId: PROPERTY, reviewIds: [REVIEW_WITHOUT_ITEM] },
      ctxWith('inbox.read', 'review.read'),
    )

    expect(itemIds.size).toBe(0)
    expect(findActiveReviewItemIds).toHaveBeenCalledWith(ORG_ID, PROPERTY, [
      REVIEW_WITHOUT_ITEM,
    ])
  })

  it.each<[string, AuthContext]>([
    ['cannot read the Inbox', ctxWith('review.read')],
    ['cannot read Reviews', ctxWith('inbox.read', 'feedback.read')],
  ])(
    'answers no Review when the caller %s, without reading the items',
    async (_label, ctx) => {
      const { useCase, findActiveReviewItemIds } = setup()

      const itemIds = await useCase({ propertyId: PROPERTY, reviewIds: ALL_REVIEWS }, ctx)

      // An item the caller could not open is no link at all: the answer is the
      // same one a Review without an item gets, and it is not an error.
      expect(itemIds.size).toBe(0)
      expect(findActiveReviewItemIds).not.toHaveBeenCalled()
    },
  )

  it('answers no Review at a Property outside the caller access', async () => {
    const { useCase, findActiveReviewItemIds } = setup(staffWithAccess([OTHER_PROPERTY]))

    const itemIds = await useCase(
      { propertyId: PROPERTY, reviewIds: ALL_REVIEWS },
      assignedCtx(),
    )

    expect(itemIds.size).toBe(0)
    expect(findActiveReviewItemIds).not.toHaveBeenCalled()
  })

  it('answers an assigned caller at a Property they can access', async () => {
    const { useCase } = setup(staffWithAccess([PROPERTY]))

    const itemIds = await useCase(
      { propertyId: PROPERTY, reviewIds: [REVIEW_WITH_ITEM] },
      assignedCtx(),
    )

    expect(itemIds).toEqual(
      new Map([[REVIEW_WITH_ITEM, inboxItemId('20000000-0000-4000-8000-000000000001')]]),
    )
  })

  it('does not read access or items when no Review is asked for', async () => {
    const getAccessiblePropertyIds = vi.fn(async () => null)
    const { useCase, findActiveReviewItemIds } = setup({
      getAccessiblePropertyIds,
      getAssignedPortals: async () => [],
    })

    const itemIds = await useCase({ propertyId: PROPERTY, reviewIds: [] }, assignedCtx())

    expect(itemIds.size).toBe(0)
    expect(getAccessiblePropertyIds).not.toHaveBeenCalled()
    expect(findActiveReviewItemIds).not.toHaveBeenCalled()
  })

  it('rejects a lookup larger than the navigation bound before any read', async () => {
    const { useCase, findActiveReviewItemIds } = setup()
    const reviewIds = Array.from({ length: REVIEW_INBOX_ITEM_LOOKUP_LIMIT + 1 }, (_, n) =>
      reviewId(`30000000-0000-4000-8000-${String(n).padStart(12, '0')}`),
    )

    await expect(
      useCase({ propertyId: PROPERTY, reviewIds }, ctxWith('inbox.read', 'review.read')),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'invalid_input' })
    expect(findActiveReviewItemIds).not.toHaveBeenCalled()
  })
})
