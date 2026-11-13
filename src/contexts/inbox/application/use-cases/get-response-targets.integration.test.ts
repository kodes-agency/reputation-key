import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  clearInboxOrganization,
  createUseCaseDatabase,
  createUseCaseInboxRepository,
  dropInboxUseCaseTenant,
  openFixturePool,
  runScopedId,
  seedInboxItem,
  seedInboxOrganization,
} from '../../infrastructure/inbox-database-fixtures'
import { createResponseTargetStore } from '../../../reputation/response-targets/store.server'
import { createResponseTargetPolicyStore } from '../../../reputation/response-targets/policy.store.server'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { InboxItem } from '../../domain/types'
import {
  getGoogleReviewTargetAnalytics,
  getInboxResponseTarget,
  getPrivateFeedbackTargetAnalytics,
  getResponseTargetPolicySettings,
} from './get-response-targets'

const NOW = new Date('2026-08-30T12:00:00.000Z')
const ORG = organizationId('org-response-target-read')
const USER = userId('user-response-target-read')
const PROPERTY = propertyId(runScopedId('78000000-0000-4000-8000-000000000001'))
const OTHER_PROPERTY = propertyId(runScopedId('78000000-0000-4000-8000-000000000002'))
const ITEM = inboxItemId(runScopedId('78000000-0000-4000-8000-000000000003'))

const feedbackItem: InboxItem = {
  id: ITEM,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceType: 'feedback',
  sourceId: feedbackId(runScopedId('78000000-0000-4000-8000-000000000004')),
  status: 'open',
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  rating: 2,
  sourceDate: NOW,
  platform: null,
  snippet: null,
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: NOW,
  updatedAt: NOW,
}

const ctx = createScopedAuthContext({
  organizationId: ORG,
  userId: USER,
  permissions: [
    ['inbox.read', 'assigned-properties'],
    ['feedback.read', 'assigned-properties'],
  ],
})

const peopleApi = (ids: readonly (typeof PROPERTY)[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids,
  getAssignedPortals: async () => [],
})

describe.sequential('Response Target manager reads', () => {
  const db = createUseCaseDatabase()
  let pool: Pool

  const store = () => {
    const targetStore = createResponseTargetStore(db)
    return {
      ...targetStore,
      getCycleTarget: vi.fn(targetStore.getCycleTarget),
      getPrivateFeedbackAnalytics: vi.fn(targetStore.getPrivateFeedbackAnalytics),
      getGoogleReviewAnalytics: vi.fn(targetStore.getGoogleReviewAnalytics),
    }
  }

  const seedFeedbackItem = () => seedInboxItem(pool, db, feedbackItem, () => NOW)

  beforeAll(async () => {
    pool = openFixturePool()
    clearEventSchemas()
    registerAllEventSchemas()
    await seedInboxOrganization(pool, ORG, [PROPERTY, OTHER_PROPERTY])
  })

  beforeEach(async () => {
    await clearInboxOrganization(pool, ORG)
    await pool.query(
      'DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1',
      [ORG],
    )
  })

  afterAll(async () => {
    clearEventSchemas()
    await pool.query(
      'DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1',
      [ORG],
    )
    await dropInboxUseCaseTenant(pool, ORG, [PROPERTY, OTHER_PROPERTY])
    await pool.end()
  })

  it('reads one target only through current Inbox + source Property access', async () => {
    const repo = createUseCaseInboxRepository(db, () => NOW)
    await seedFeedbackItem()
    const targetStore = store()
    const execute = getInboxResponseTarget({
      repo,
      targetStore,
      staffPublicApi: peopleApi([PROPERTY]),
      clock: () => NOW,
    })

    await execute({ inboxItemId: ITEM }, ctx)

    expect(targetStore.getCycleTarget).toHaveBeenCalledWith(ITEM, ORG, NOW)
  })

  it('rejects a target outside the manager’s assigned Property', async () => {
    const repo = createUseCaseInboxRepository(db, () => NOW)
    await seedFeedbackItem()
    const targetStore = store()

    await expect(
      getInboxResponseTarget({
        repo,
        targetStore,
        staffPublicApi: peopleApi([OTHER_PROPERTY] as never),
        clock: () => NOW,
      })({ inboxItemId: ITEM }, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(targetStore.getCycleTarget).not.toHaveBeenCalled()
  })

  it('passes only the feedback-read Property intersection to private analytics', async () => {
    const targetStore = store()
    const execute = getPrivateFeedbackTargetAnalytics({
      targetStore,
      staffPublicApi: peopleApi([PROPERTY]),
      clock: () => NOW,
    })

    await execute({}, ctx)

    expect(targetStore.getPrivateFeedbackAnalytics).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyIds: [PROPERTY],
      now: NOW,
    })
  })

  it('keeps Google response analytics separate and Property-scoped', async () => {
    const targetStore = store()
    const reviewCtx = createScopedAuthContext({
      organizationId: ORG,
      userId: USER,
      permissions: [
        ['inbox.read', 'assigned-properties'],
        ['review.read', 'assigned-properties'],
      ],
    })
    const execute = getGoogleReviewTargetAnalytics({
      targetStore,
      staffPublicApi: peopleApi([PROPERTY]),
      clock: () => NOW,
    })

    await execute({}, reviewCtx)

    expect(targetStore.getGoogleReviewAnalytics).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyIds: [PROPERTY],
      now: NOW,
    })
    expect(targetStore.getPrivateFeedbackAnalytics).not.toHaveBeenCalled()
  })

  it('lets only an Organization administrator read policy versions for safe compare-and-set edits', async () => {
    await pool.query(
      `INSERT INTO inbox_response_target_organization_policies (
         organization_id, target_kind, duration_minutes, policy_version,
         updated_by, created_at, updated_at
       ) VALUES ($1, 'private_feedback_handling', 1440, 3, $2, $3, $3)`,
      [ORG, USER, NOW],
    )
    const policyStore = createResponseTargetPolicyStore(db)
    const getPolicySettings = vi.spyOn(policyStore, 'getPolicySettings')
    const execute = getResponseTargetPolicySettings({ policyStore })
    const admin = createScopedAuthContext({
      organizationId: ORG,
      userId: USER,
      permissions: [['organization.update', 'organization']],
    })

    await expect(execute({}, admin)).resolves.toMatchObject({
      organization: { privateFeedbackHandling: { policyVersion: 3 } },
    })
    expect(getPolicySettings).toHaveBeenCalledWith(ORG, undefined)
    await expect(execute({}, ctx)).rejects.toMatchObject({ code: 'forbidden' })
  })
})
