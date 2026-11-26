import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import {
  clearInboxOrganization,
  createUseCaseDatabase,
  dropInboxOrganization,
  openFixturePool,
  runScopedId,
  seedInboxOrganization,
} from '../inbox/inbox-database.test-fixtures'
import { createResponseTargetStore } from './store.server'
import { createResponseTargetPolicyStore } from './policy.store.server'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import {
  getGoogleReviewTargetAnalytics,
  getPrivateFeedbackTargetAnalytics,
  getResponseTargetPolicySettings,
} from './get-response-targets.server'

const NOW = new Date('2026-08-30T12:00:00.000Z')
const ORG = organizationId('org-response-target-read')
const USER = userId('user-response-target-read')
const PROPERTY = propertyId(runScopedId('78000000-0000-4000-8000-000000000001'))
const OTHER_PROPERTY = propertyId(runScopedId('78000000-0000-4000-8000-000000000002'))

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
      getPrivateFeedbackAnalytics: vi.fn(targetStore.getPrivateFeedbackAnalytics),
      getGoogleReviewAnalytics: vi.fn(targetStore.getGoogleReviewAnalytics),
    }
  }

  beforeAll(async () => {
    pool = openFixturePool()
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
    await pool.query(
      'DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1',
      [ORG],
    )
    await dropInboxOrganization(pool, ORG)
    await pool.end()
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
