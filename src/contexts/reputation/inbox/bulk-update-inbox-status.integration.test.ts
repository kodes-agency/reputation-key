import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { bulkUpdateInboxStatus } from './bulk-update-inbox-status.server'
import type { BulkUpdateInboxStatusInput } from '#/contexts/inbox/application/inbox-status-commands'
import { getEnv } from '#/shared/config/env'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  inboxItemId,
  organizationId,
  propertyId,
  userId,
  type InboxItemId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '#/contexts/inbox/domain/types'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import { isInboxError } from '#/contexts/inbox/domain/errors'
import type { ReviewSourceLookupPort } from '#/contexts/inbox/application/ports/review-source-lookup.port'
import type { ReviewResponseTargetAuthorityPort } from '#/contexts/inbox/application/ports/review-response-target-authority.port'
import {
  buildFixtureItem,
  createInboxDatabaseStores,
  dropInboxOrganization,
  fixtureUuid,
  readOutboxFacts,
  seedInboxScope,
} from '#/contexts/inbox/infrastructure/inbox-database-fixtures'

const SCOPE = 'bulk-update-inbox-status'
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const PROVIDER_TIME = new Date('2026-04-10T12:00:00Z')
const ORG_ID = organizationId('org-bulk-update-inbox-status-test')
const OTHER_ORG_ID = organizationId('org-bulk-update-inbox-status-other')
const USER_ID = userId('user-1')
const PROP_1 = propertyId(fixtureUuid(SCOPE, 'prop-1'))
const PROP_2 = propertyId(fixtureUuid(SCOPE, 'prop-2'))

const itemId = (label: string): InboxItemId => inboxItemId(fixtureUuid(SCOPE, label))

const ctxFor = (role: Role, orgId = ORG_ID): AuthContext =>
  ({ organizationId: orgId, userId: USER_ID, role }) as AuthContext

const ctxWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Member',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'organization' as const]),
  ),
})

function seedItem(
  label: string,
  status: InboxStatus,
  propId = PROP_1,
  sourceType: SourceType = 'review',
): InboxItem {
  return buildFixtureItem({
    organizationId: ORG_ID,
    scope: SCOPE,
    label,
    status,
    propertyId: propId,
    sourceType,
    at: FIXED_TIME,
  })
}

const defaultStaffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })

const setup = (peopleApi: StaffPublicApi = defaultStaffApi) => {
  const { repo, commandStore } = createInboxDatabaseStores(
    () => FIXED_TIME,
    createMockLogger(),
  )
  const seeded: InboxItem[] = []
  const reviewSourceLookup: ReviewSourceLookupPort = {
    getReviewSourceMetaById: async () => null,
    getReviewSourceMetaByIds: async (ids) =>
      ids.flatMap((id) => {
        const item = seeded.find(
          (candidate) => candidate.sourceType === 'review' && candidate.sourceId === id,
        )
        return item
          ? [
              {
                id,
                propertyId: item.propertyId,
                platform: 'google',
                sourceEpoch: 0,
                sourceDate: item.sourceDate,
                contentExpiresAt: null,
                materialReviewRevision: 1,
              },
            ]
          : []
      }),
    listReviewSources: async () => [],
  }
  const responseTargetAuthority: ReviewResponseTargetAuthorityPort = {
    withExactCurrent: async () => ({ status: 'obsolete' }),
    withInboxProjection: async () => ({ status: 'obsolete' }),
    withExactCurrentBatch: async (expectations, apply) => ({
      status: 'current',
      value: await apply(
        expectations.map((expectation) => ({
          ...expectation,
          authority: 'review.current-response-target.v1',
          materialReviewRevision: 1,
          eligibility: 'measured',
          responseTargetStartAt: PROVIDER_TIME,
          rating: null,
        })),
      ),
    }),
  }
  const execute = bulkUpdateInboxStatus({
    repo,
    commandStore,
    clock: () => FIXED_TIME,
    idGen: () => '6a000000-0000-4000-8000-000000000002',
    staffPublicApi: peopleApi,
    reviewSourceLookup,
    responseTargetAuthority,
    logger: createMockLogger(),
  })
  const useCase = (
    input: Omit<BulkUpdateInboxStatusInput, 'reopenReason'> &
      Partial<Pick<BulkUpdateInboxStatusInput, 'reopenReason'>>,
    ctx: AuthContext,
  ) => execute({ reopenReason: 'new_information', ...input }, ctx)
  const seed = async (...items: InboxItem[]) => {
    seeded.push(...items)
    await seedInboxScope(pool, ORG_ID, [PROP_1, PROP_2], items, FIXED_TIME)
  }
  const statuses = async (...labels: string[]): Promise<InboxStatus[]> => {
    const rows = await repo.findByIds(labels.map(itemId), ORG_ID)
    return labels.map((label) => rows.find((row) => row.id === itemId(label))!.status)
  }
  return { useCase, seed, statuses, commandStore }
}

const bulkCommands = (...labels: string[]) =>
  labels.map((label) => ({
    inboxItemId: itemId(label),
    expectedCommandRevision: 1,
  }))

describe.sequential('bulkUpdateInboxStatus', () => {
  registerAllEventSchemas()

  beforeEach(() => dropInboxOrganization(pool, ORG_ID))

  afterAll(async () => {
    await dropInboxOrganization(pool, ORG_ID)
    await pool.end()
  })

  it('updates multiple items with valid transitions', async () => {
    const { useCase, seed, statuses, commandStore } = setup()
    const storeCall = vi.spyOn(commandStore, 'bulkUpdateStatus')
    await seed(seedItem('ii-1', 'closed'), seedItem('ii-2', 'closed'))

    const result = await useCase(
      { items: bulkCommands('ii-1', 'ii-2'), newStatus: 'open' },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(2)
    expect(result.results).toEqual([
      { inboxItemId: itemId('ii-1'), outcome: 'reopened' },
      { inboxItemId: itemId('ii-2'), outcome: 'reopened' },
    ])
    expect(await statuses('ii-1', 'ii-2')).toEqual(['open', 'open'])
    const targets = storeCall.mock.calls[0]?.[3]
    expect(targets).toBeInstanceOf(Map)
    expect([...(targets?.values() ?? [])]).toEqual([
      expect.objectContaining({
        reviewAuthority: expect.objectContaining({
          eligibility: 'measured',
          responseTargetStartAt: PROVIDER_TIME,
          rating: null,
        }),
        targetStart: { basis: 'operational_reopen', at: FIXED_TIME },
      }),
      expect.objectContaining({
        reviewAuthority: expect.objectContaining({
          eligibility: 'measured',
          responseTargetStartAt: PROVIDER_TIME,
          rating: null,
        }),
        targetStart: { basis: 'operational_reopen', at: FIXED_TIME },
      }),
    ])
  })

  it('forwards the governed reason and Other explanation to the store', async () => {
    const { useCase, seed, commandStore } = setup()
    await seed(seedItem('ii-1', 'closed', PROP_1, 'feedback'))
    const storeCall = vi.spyOn(commandStore, 'bulkUpdateStatus')

    await useCase(
      {
        items: bulkCommands('ii-1'),
        newStatus: 'open',
        reopenReason: 'other',
        reopenExplanation: '  A new guest message needs follow-up.  ',
      },
      ctxFor('AccountAdmin'),
    )

    expect(storeCall).toHaveBeenCalledWith(
      [expect.objectContaining({ id: itemId('ii-1') })],
      [expect.objectContaining({ newStatus: 'open' })],
      {
        reason: 'other',
        explanation: '  A new guest message needs follow-up.  ',
      },
    )
  })

  it('skips items with invalid transitions', async () => {
    const { useCase, seed, statuses } = setup()
    await seed(seedItem('ii-1', 'closed'), seedItem('ii-2', 'open'))

    const result = await useCase(
      { items: bulkCommands('ii-1', 'ii-2'), newStatus: 'open' },
      ctxFor('AccountAdmin'),
    )

    // ii-1: closed→open (valid), ii-2: open→open (invalid — same status)
    expect(result.updated).toBe(1)
    expect(result.results).toEqual([
      { inboxItemId: itemId('ii-1'), outcome: 'reopened' },
      { inboxItemId: itemId('ii-2'), outcome: 'already_open' },
    ])
    expect(await statuses('ii-1', 'ii-2')).toEqual(['open', 'open'])
  })

  it('returns 0 when all transitions are invalid', async () => {
    const { useCase, seed } = setup()
    await seed(seedItem('ii-1', 'open'))

    const result = await useCase(
      {
        items: bulkCommands('ii-1'),
        newStatus: 'open', // open → open is invalid
      },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(0)
    expect(result.results).toEqual([
      { inboxItemId: itemId('ii-1'), outcome: 'already_open' },
    ])
  })

  it('reports a stale client revision without mutating or recording a fact', async () => {
    const { useCase, seed, statuses } = setup()
    await seed(seedItem('ii-1', 'closed'))

    const result = await useCase(
      {
        items: [{ inboxItemId: itemId('ii-1'), expectedCommandRevision: 2 }],
        newStatus: 'open',
      },
      ctxFor('AccountAdmin'),
    )

    expect(result).toEqual({
      updated: 0,
      results: [{ inboxItemId: itemId('ii-1'), outcome: 'revision_conflict' }],
    })
    expect(await statuses('ii-1')).toEqual(['closed'])
    expect(
      await readOutboxFacts(pool, ORG_ID, 'inbox.inbox_item.bulk_status_changed'),
    ).toEqual([])
  })

  it('rejects duplicate command IDs at the application boundary', async () => {
    const { useCase } = setup()
    const duplicate = bulkCommands('ii-1', 'ii-1')

    await expect(
      useCase({ items: duplicate, newStatus: 'open' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
  })

  it('records one bulk status fact per updated item with a shared bulkId', async () => {
    const { useCase, seed } = setup()
    await seed(seedItem('ii-1', 'closed'), seedItem('ii-2', 'closed'))

    await useCase(
      { items: bulkCommands('ii-1', 'ii-2'), newStatus: 'open' },
      ctxFor('AccountAdmin'),
    )

    const facts = await readOutboxFacts(
      pool,
      ORG_ID,
      'inbox.inbox_item.bulk_status_changed',
    )
    expect(facts).toHaveLength(2)
    const bulkIds = facts.map((fact) => fact.bulkId)
    expect(bulkIds[0]).toBeTruthy()
    expect(new Set(bulkIds).size).toBe(1)
  })

  it('reopens both review and feedback items without a source-type guard', async () => {
    const { useCase, seed, statuses } = setup()
    await seed(
      seedItem('ii-1', 'closed', PROP_1, 'review'),
      seedItem('ii-2', 'closed', PROP_1, 'feedback'),
    )

    const result = await useCase(
      { items: bulkCommands('ii-1', 'ii-2'), newStatus: 'open' },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(2)
    expect(await statuses('ii-1', 'ii-2')).toEqual(['open', 'open'])
  })

  it('updates only source families the caller is allowed to handle', async () => {
    const { useCase, seed, statuses } = setup()
    await seed(
      seedItem('ii-review', 'closed', PROP_1, 'review'),
      seedItem('ii-feedback', 'closed', PROP_1, 'feedback'),
    )

    const result = await useCase(
      { items: bulkCommands('ii-review', 'ii-feedback'), newStatus: 'open' },
      ctxWith('inbox.write', 'review.read'),
    )

    expect(result.updated).toBe(1)
    expect(result.results).toEqual([
      { inboxItemId: itemId('ii-review'), outcome: 'reopened' },
      { inboxItemId: itemId('ii-feedback'), outcome: 'unavailable' },
    ])
    expect(await statuses('ii-review', 'ii-feedback')).toEqual(['open', 'closed'])
  })

  it('does not treat feedback.read as permission to handle private feedback', async () => {
    const { useCase, seed, statuses } = setup()
    await seed(seedItem('ii-feedback', 'closed', PROP_1, 'feedback'))

    const result = await useCase(
      { items: bulkCommands('ii-feedback'), newStatus: 'open' },
      ctxWith('inbox.write', 'feedback.read'),
    )

    expect(result.updated).toBe(0)
    expect(result.results).toEqual([
      { inboxItemId: itemId('ii-feedback'), outcome: 'unavailable' },
    ])
    expect(await statuses('ii-feedback')).toEqual(['closed'])
  })

  it('intersects each source handling scope across a mixed batch', async () => {
    const peopleApi: StaffPublicApi = {
      ...defaultStaffApi,
      getAccessiblePropertyIds: async () => [PROP_1],
    }
    const { useCase, seed, statuses } = setup(peopleApi)
    await seed(
      seedItem('review-2', 'closed', PROP_2, 'review'),
      seedItem('feedback-1', 'closed', PROP_1, 'feedback'),
      seedItem('feedback-2', 'closed', PROP_2, 'feedback'),
    )

    const result = await useCase(
      {
        items: bulkCommands('review-2', 'feedback-1', 'feedback-2'),
        newStatus: 'open',
      },
      createScopedAuthContext({
        organizationId: ORG_ID,
        userId: USER_ID,
        permissions: [
          ['inbox.write', 'organization'],
          ['review.read', 'organization'],
          ['feedback.handle', 'assigned-properties'],
        ],
      }),
    )

    expect(result.updated).toBe(2)
    expect(await statuses('review-2', 'feedback-1', 'feedback-2')).toEqual([
      'open',
      'open',
      'closed',
    ])
  })

  it('denies access to all items when PropertyManager has no Property access grants', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
    }
    const { useCase, seed, statuses } = setup(peopleApi)
    await seed(seedItem('ii-1', 'closed', PROP_1), seedItem('ii-2', 'closed', PROP_2))

    const result = await useCase(
      { items: bulkCommands('ii-1', 'ii-2'), newStatus: 'open' },
      ctxFor('PropertyManager'),
    )

    expect(result.updated).toBe(0)
    expect(result.results).toEqual([
      { inboxItemId: itemId('ii-1'), outcome: 'unavailable' },
      { inboxItemId: itemId('ii-2'), outcome: 'unavailable' },
    ])
    expect(await statuses('ii-1', 'ii-2')).toEqual(['closed', 'closed'])
  })

  it('filters out items from inaccessible properties for PropertyManager', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_1],
      getAssignedPortals: async () => [],
    }
    const { useCase, seed, statuses } = setup(peopleApi)
    await seed(seedItem('ii-1', 'closed', PROP_1), seedItem('ii-2', 'closed', PROP_2))

    const result = await useCase(
      { items: bulkCommands('ii-1', 'ii-2'), newStatus: 'open' },
      ctxFor('PropertyManager'),
    )

    expect(result.updated).toBe(1)
    expect(await statuses('ii-1', 'ii-2')).toEqual(['open', 'closed'])
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_1],
      getAssignedPortals: async () => [],
    }
    const { useCase, seed, statuses } = setup(peopleApi)
    await seed(seedItem('ii-1', 'closed', PROP_1), seedItem('ii-2', 'closed', PROP_2))

    const result = await useCase(
      { items: bulkCommands('ii-1', 'ii-2'), newStatus: 'open' },
      ctxFor('PropertyManager'),
    )

    expect(result.updated).toBe(1)
    expect(await statuses('ii-1', 'ii-2')).toEqual(['open', 'closed'])
  })

  it('skips all items for PropertyManager with no property assignments', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
    }
    const { useCase, seed, statuses } = setup(peopleApi)
    await seed(seedItem('ii-1', 'closed', PROP_1))

    const result = await useCase(
      { items: bulkCommands('ii-1'), newStatus: 'open' },
      ctxFor('PropertyManager'),
    )

    expect(result.updated).toBe(0)
    expect(await statuses('ii-1')).toEqual(['closed'])
  })

  it('processes all items for AccountAdmin', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => {
        throw new Error('Should not be called for AccountAdmin')
      },
      getAssignedPortals: async () => [],
    }
    const { useCase, seed, statuses } = setup(peopleApi)
    await seed(seedItem('ii-1', 'closed', PROP_1), seedItem('ii-2', 'closed', PROP_2))

    const result = await useCase(
      { items: bulkCommands('ii-1', 'ii-2'), newStatus: 'open' },
      ctxFor('AccountAdmin'),
    )

    expect(result.updated).toBe(2)
    expect(await statuses('ii-1', 'ii-2')).toEqual(['open', 'open'])
  })

  // ── Tenant isolation ──────────────────────────────────────────────
  it('does not update items belonging to a different organization', async () => {
    const { useCase, seed, statuses } = setup()
    await seed(seedItem('ii-1', 'closed'), seedItem('ii-2', 'closed'))

    const result = await useCase(
      { items: bulkCommands('ii-1', 'ii-2'), newStatus: 'open' },
      ctxFor('AccountAdmin', OTHER_ORG_ID),
    )

    // Items belong to ORG_ID; caller is in OTHER_ORG_ID — zero updates, items unchanged
    expect(result.updated).toBe(0)
    expect(result.results).toEqual([
      { inboxItemId: itemId('ii-1'), outcome: 'unavailable' },
      { inboxItemId: itemId('ii-2'), outcome: 'unavailable' },
    ])
    expect(await statuses('ii-1', 'ii-2')).toEqual(['closed', 'closed'])
  })
})
