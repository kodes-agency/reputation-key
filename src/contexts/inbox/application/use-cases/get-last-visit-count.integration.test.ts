import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getLastVisitCount } from './get-last-visit-count'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  seedInboxItem,
  seedInboxOrganization,
} from '../../infrastructure/inbox-database-fixtures'
import { createInboxRepository } from '../../infrastructure/repositories/inbox.repository'
import type { InboxViewRepository } from '../ports/inbox-view.repository'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
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

const ORG_ID = organizationId('org-last-visit-count-test')
const PROP_1 = propertyId('1c000000-0000-0000-0000-000000000001')
const PROP_2 = propertyId('1c000000-0000-0000-0000-000000000002')
const USER_ID = userId('user-1')
const SINCE = new Date('2026-08-26T10:00:00.000Z')

const ctxWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Member',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'organization' as const]),
  ),
})

const makeItem = (
  sourceType: 'review' | 'feedback',
  itemPropertyId = PROP_1,
): InboxItem => ({
  id: inboxItemId(crypto.randomUUID()),
  organizationId: ORG_ID,
  propertyId: itemPropertyId,
  sourceType,
  sourceId:
    sourceType === 'review'
      ? reviewId(crypto.randomUUID())
      : feedbackId(crypto.randomUUID()),
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

const TEST_NOW = new Date('2026-08-26T12:00:00.000Z')

describe.sequential('getLastVisitCount', () => {
  let pool: Pool
  const db = getDb()

  const seed = async (...items: InboxItem[]) => {
    for (const item of items) await seedInboxItem(pool, db, item, () => TEST_NOW)
    return createInboxRepository(
      db,
      {
        reviewLookup: {
          getReviewSnippetById: async () => ({ status: 'not_found' }),
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
      },
      { clock: () => TEST_NOW, logger: createMockLogger() },
    )
  }

  const clearItems = () =>
    pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG_ID])

  beforeAll(async () => {
    pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
    await seedInboxOrganization(pool, ORG_ID, [PROP_1, PROP_2])
  })

  beforeEach(clearItems)

  afterAll(async () => {
    await clearItems()
    await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG_ID])
    await pool.end()
  })

  it('counts only source families the caller may read', async () => {
    const repo = await seed(makeItem('review'), makeItem('feedback'))
    const useCase = getLastVisitCount({ repo, viewRepo, staffPublicApi })

    const count = await useCase({}, ctxWith('inbox.read', 'review.read'))

    expect(count).toBe(1)
  })

  it('returns zero when no owning source context is readable', async () => {
    const repo = await seed(makeItem('review'))
    const useCase = getLastVisitCount({ repo, viewRepo, staffPublicApi })

    const count = await useCase({}, ctxWith('inbox.read'))

    expect(count).toBe(0)
  })

  it('intersects the source scope for the last-visit count', async () => {
    const repo = await seed(
      makeItem('review', PROP_2),
      makeItem('feedback', PROP_1),
      makeItem('feedback', PROP_2),
    )
    const scopedStaffApi: StaffPublicApi = {
      ...staffPublicApi,
      getAccessiblePropertyIds: async () => [PROP_1],
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
