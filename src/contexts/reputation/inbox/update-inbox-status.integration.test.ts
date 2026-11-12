import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { updateInboxStatus } from './update-inbox-status.server'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { isInboxError } from '#/contexts/inbox/domain/errors'
import { inboxItemId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '#/contexts/inbox/domain/types'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
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

const SCOPE = 'update-inbox-status'
const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const PROVIDER_TIME = new Date('2026-04-10T12:00:00Z')
const ORG_ID = organizationId('org-update-inbox-status-test')
const ITEM_ID = inboxItemId(fixtureUuid(SCOPE, 'ii-1'))
const USER_ID = userId('user-1')
const PROP_1 = propertyId(fixtureUuid(SCOPE, 'prop-1'))
const PROP_OTHER = propertyId(fixtureUuid(SCOPE, 'prop-other'))
const PROP_ASSIGNED = propertyId(fixtureUuid(SCOPE, 'prop-assigned'))

const ctxFor = (role: Role): AuthContext =>
  ({ organizationId: ORG_ID, userId: USER_ID, role }) as AuthContext

const ctxWith = (...permissions: Permission[]): AuthContext => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'Member',
  effectivePermissions: new Set(permissions),
  scopeByPermission: new Map(
    permissions.map((permission) => [permission, 'organization' as const]),
  ),
})

function seedOpen(overrides?: Partial<InboxItem>): InboxItem {
  return buildFixtureItem({
    organizationId: ORG_ID,
    scope: SCOPE,
    label: 'ii-1',
    status: (overrides?.status ?? 'open') as InboxStatus,
    propertyId: PROP_1,
    sourceType: (overrides?.sourceType ?? 'feedback') as SourceType,
    at: FIXED_TIME,
    overrides: { id: ITEM_ID, ...overrides },
  })
}

const staffApiAllAccess: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })

const setup = (peopleApi: StaffPublicApi = staffApiAllAccess) => {
  const { repo, commandStore, cycleStore } = createInboxDatabaseStores(
    () => FIXED_TIME,
    createMockLogger(),
  )
  const reviewSourceLookup: ReviewSourceLookupPort = {
    getReviewSourceMetaById: async (id) => ({
      id,
      propertyId: PROP_1,
      platform: 'google',
      sourceEpoch: 0,
      sourceDate: FIXED_TIME,
      contentExpiresAt: null,
      materialReviewRevision: 1,
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
        materialReviewRevision: 1,
        eligibility: 'measured',
        responseTargetStartAt: PROVIDER_TIME,
        rating: null,
      }),
    }),
    withInboxProjection: async () => ({ status: 'obsolete' }),
    withExactCurrentBatch: async () => ({ status: 'obsolete' }),
  }
  const execute = updateInboxStatus({
    repo,
    commandStore,
    clock: () => FIXED_TIME,
    staffPublicApi: peopleApi,
    cycleStore,
    reviewSourceLookup,
    responseTargetAuthority,
  })
  type CommandInput = Parameters<typeof execute>[0]
  const useCase = async (
    input: Omit<CommandInput, 'expectedCommandRevision'> &
      Partial<Pick<CommandInput, 'expectedCommandRevision'>>,
    ctx: AuthContext,
  ) =>
    execute(
      {
        ...input,
        expectedCommandRevision:
          input.expectedCommandRevision ??
          (await repo.findById(input.inboxItemId, ORG_ID))?.commandRevision ??
          1,
      },
      ctx,
    )
  const stored = async () => (await repo.findById(ITEM_ID, ORG_ID))!
  const seed = (...items: InboxItem[]) =>
    seedInboxScope(pool, ORG_ID, [PROP_1, PROP_OTHER, PROP_ASSIGNED], items, FIXED_TIME)
  return { useCase, seed, stored, commandStore }
}

describe.sequential('updateInboxStatus', () => {
  beforeAll(async () => {
    registerAllEventSchemas()
  })

  beforeEach(() => dropInboxOrganization(pool, ORG_ID))

  afterAll(async () => {
    await dropInboxOrganization(pool, ORG_ID)
    await pool.end()
  })

  it('routes private-feedback close through the outcome-specific command', async () => {
    const { useCase, seed, stored } = setup()
    await seed(seedOpen())

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
    expect(await stored()).toMatchObject({ status: 'open', commandRevision: 1 })
  })

  it('transitions closed → open (reopen)', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen({ status: 'closed' }))

    const updated = await useCase(
      {
        inboxItemId: ITEM_ID,
        newStatus: 'open',
        reopenReason: 'internal_follow_up_still_needed',
      },
      ctxFor('AccountAdmin'),
    )

    expect(updated.status).toBe('open')
  })

  it('throws invalid_transition for same-status transition', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen({ status: 'open' }))

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'open' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (e: unknown) => isInboxError(e) && e.code === 'invalid_transition',
    )
  })

  it('throws not_found for missing item', async () => {
    const { useCase } = setup()

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })

  it('records inbox.status.changed when a governed reopen succeeds', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen({ status: 'closed', closedAt: FIXED_TIME }))

    await useCase(
      {
        inboxItemId: ITEM_ID,
        newStatus: 'open',
        reopenReason: 'new_information',
      },
      ctxFor('AccountAdmin'),
    )

    const facts = await readOutboxFacts(pool, ORG_ID, 'inbox.inbox_item.status_changed')
    expect(facts).toHaveLength(1)
  })

  it('rejects manual close on a Review because Google observation owns closure', async () => {
    const { useCase, seed, stored } = setup()
    await seed(seedOpen({ sourceType: 'review' as SourceType }))

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
    expect((await stored())?.status).toBe('open')
  })

  it('reopens a closed Review only with a governed neutral reason', async () => {
    const { useCase, seed, commandStore } = setup()
    const reopen = vi.spyOn(commandStore, 'reopenReviewCycle')
    await seed(
      seedOpen({
        sourceType: 'review',
        status: 'closed',
        closedAt: FIXED_TIME,
      }),
    )

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'open' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          newStatus: 'open',
          reopenReason: 'new_information',
        },
        ctxFor('AccountAdmin'),
      ),
    ).resolves.toMatchObject({ status: 'open', closedAt: null })
    expect(reopen).toHaveBeenCalledWith(
      expect.objectContaining({
        responseTarget: expect.objectContaining({
          reviewAuthority: expect.objectContaining({
            eligibility: 'measured',
            responseTargetStartAt: PROVIDER_TIME,
            rating: null,
          }),
          targetStart: { basis: 'operational_reopen', at: FIXED_TIME },
        }),
      }),
    )
  })

  it('rejects generic manual close on a feedback item', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen({ sourceType: 'feedback' as SourceType }))

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
  })

  it('requires feedback.handle to change private-feedback workflow status', async () => {
    const { useCase, seed, stored } = setup()
    await seed(seedOpen({ sourceType: 'feedback' }))

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, newStatus: 'closed' },
        ctxWith('inbox.write', 'feedback.read'),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
    expect((await stored()).status).toBe('open')
  })

  it('still requires the outcome-specific command with feedback.handle', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen({ sourceType: 'feedback' }))

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, newStatus: 'closed' },
        ctxWith('inbox.write', 'feedback.handle'),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
  })

  it('intersects feedback.handle scope before changing workflow status', async () => {
    const peopleApi: StaffPublicApi = {
      ...staffApiAllAccess,
      getAccessiblePropertyIds: async () => [PROP_OTHER],
    }
    const { useCase, seed, stored } = setup(peopleApi)
    await seed(seedOpen({ sourceType: 'feedback' }))

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, newStatus: 'closed' },
        createScopedAuthContext({
          organizationId: ORG_ID,
          userId: USER_ID,
          permissions: [
            ['inbox.write', 'organization'],
            ['feedback.handle', 'assigned-properties'],
          ],
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
    expect((await stored()).status).toBe('open')
  })

  it('denies access without inbox.write permission for inaccessible property', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [],
      getAssignedPortals: async () => [],
    }
    const { useCase, seed } = setup(peopleApi)
    await seed(seedOpen())

    await expect(
      useCase(
        { inboxItemId: ITEM_ID, newStatus: 'closed' },
        ctxFor('Guest' as unknown as Role),
      ),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('allows update when user has access to the property', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_1],
      getAssignedPortals: async () => [],
    }
    const { useCase, seed } = setup(peopleApi)
    await seed(seedOpen({ status: 'closed', closedAt: FIXED_TIME }))

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          newStatus: 'open',
          reopenReason: 'new_information',
        },
        ctxFor('PropertyManager'),
      ),
    ).resolves.toBeDefined()
  })

  it('scopes PropertyManager to assigned properties (PM is NOT org-wide for inbox)', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_ASSIGNED],
      getAssignedPortals: async () => [],
    }
    const { useCase, seed, stored } = setup(peopleApi)
    await seed(seedOpen({ propertyId: PROP_OTHER }))

    await expect(
      useCase({ inboxItemId: ITEM_ID, newStatus: 'closed' }, ctxFor('PropertyManager')),
    ).rejects.toMatchObject({ _tag: 'InboxError', code: 'forbidden' })

    expect((await stored()).status).toBe('open')
  })

  it('allows PropertyManager to update status for an assigned property', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => [PROP_1],
      getAssignedPortals: async () => [],
    }
    const { useCase, seed } = setup(peopleApi)
    await seed(seedOpen({ status: 'closed', closedAt: FIXED_TIME }))

    const updated = await useCase(
      {
        inboxItemId: ITEM_ID,
        newStatus: 'open',
        reopenReason: 'new_information',
      },
      ctxFor('PropertyManager'),
    )

    expect(updated.status).toBe('open')
  })

  it('skips property check for AccountAdmin role', async () => {
    const peopleApi: StaffPublicApi = {
      getAccessiblePropertyIds: async () => {
        throw new Error('Should not be called')
      },
      getAssignedPortals: async () => [],
    }
    const { useCase, seed } = setup(peopleApi)
    await seed(seedOpen({ status: 'closed', closedAt: FIXED_TIME }))

    await expect(
      useCase(
        {
          inboxItemId: ITEM_ID,
          newStatus: 'open',
          reopenReason: 'new_information',
        },
        ctxFor('AccountAdmin'),
      ),
    ).resolves.toBeDefined()
  })
})
