import { describe, expect, it } from 'vitest'
import { getLastVisitCount } from './get-last-visit-count'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import type { InboxViewRepository } from '../ports/inbox-view.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import type { InboxItem } from '../../domain/types'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'

const ORG_ID = organizationId('org-1')
const USER_ID = userId('user-1')
const SINCE = new Date('2026-08-26T10:00:00.000Z')

const ctxWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Staff',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'organization' as const]),
  ),
})

const makeItem = (
  id: string,
  sourceType: 'review' | 'feedback',
  itemPropertyId = propertyId('prop-1'),
): InboxItem => ({
  id: inboxItemId(id),
  organizationId: ORG_ID,
  propertyId: itemPropertyId,
  sourceType,
  sourceId:
    sourceType === 'review' ? reviewId(`review-${id}`) : feedbackId(`feedback-${id}`),
  status: 'open',
  rating: 3,
  sourceDate: new Date('2026-08-26T12:00:00.000Z'),
  platform: sourceType === 'review' ? 'google' : 'direct',
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
  createdAt: new Date('2026-08-26T11:00:00.000Z'),
  updatedAt: new Date('2026-08-26T11:00:00.000Z'),
})

const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const viewRepo: InboxViewRepository = {
  getLastInboxView: async () => SINCE,
  stampLastInboxView: async () => SINCE,
}

describe('getLastVisitCount', () => {
  it('counts only source families the caller may read', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(
      makeItem('review-item', 'review'),
      makeItem('feedback-item', 'feedback'),
    )
    const useCase = getLastVisitCount({ repo, viewRepo, staffPublicApi })

    const count = await useCase({}, ctxWith('inbox.read', 'review.read'))

    expect(count).toBe(1)
  })

  it('returns zero when no owning source context is readable', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem('review-item', 'review'))
    const useCase = getLastVisitCount({ repo, viewRepo, staffPublicApi })

    const count = await useCase({}, ctxWith('inbox.read'))

    expect(count).toBe(0)
  })

  it('intersects the source scope for the last-visit count', async () => {
    const repo = createInMemoryInboxRepo()
    repo.items.push(
      makeItem('review-2', 'review', propertyId('prop-2')),
      makeItem('feedback-1', 'feedback', propertyId('prop-1')),
      makeItem('feedback-2', 'feedback', propertyId('prop-2')),
    )
    const scopedStaffApi: StaffPublicApi = {
      ...staffPublicApi,
      getAccessiblePropertyIds: async () => [propertyId('prop-1')],
    }
    const useCase = getLastVisitCount({
      repo,
      viewRepo,
      staffPublicApi: scopedStaffApi,
    })

    const count = await useCase(
      {},
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

    expect(count).toBe(2)
  })
})
