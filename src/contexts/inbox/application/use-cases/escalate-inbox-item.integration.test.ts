import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest'
import type { Pool } from 'pg'
import { escalateInboxItem } from './escalate-inbox-item'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  dropInboxUseCaseTenant,
  runScopedId,
} from '../../infrastructure/inbox-database-fixtures-use-case-ids'
import {
  clearInboxUseCaseRows,
  createUseCaseCommandStore,
  createUseCaseDatabase,
  createUseCaseInboxRepository,
  openFixturePool,
  readCommittedFacts,
} from '../../infrastructure/inbox-database-fixtures-use-cases'
import {
  seedInboxItem,
  seedInboxOrganization,
} from '../../infrastructure/inbox-database-fixtures'
import { isInboxError } from '../../domain/errors'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  feedbackId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { Role } from '#/shared/domain/roles'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'

const FIXED_TIME = new Date('2026-04-15T12:00:00Z')
const ORG_ID = organizationId('org-escalate-inbox-item-test')
const ITEM_ID = inboxItemId(runScopedId('7c000000-0000-4000-8000-000000000011'))
const USER_ID = userId('user-1')
const PROP_1 = propertyId(runScopedId('7c000000-0000-4000-8000-000000000001'))
const PROP_OTHER = propertyId(runScopedId('7c000000-0000-4000-8000-000000000002'))
const REVIEW_ID = reviewId(runScopedId('7c000000-0000-4000-8000-000000000021'))
const FEEDBACK_ID = feedbackId(runScopedId('7c000000-0000-4000-8000-000000000022'))

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
  return {
    id: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: PROP_1,
    sourceType: 'review',
    sourceId: REVIEW_ID,
    status: 'open',
    rating: 4,
    sourceDate: new Date('2026-04-10T00:00:00Z'),
    platform: 'google',
    snippet: 'Great!',
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
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  }
}

const allAccess: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

describe.sequential('escalateInboxItem', () => {
  const db = createUseCaseDatabase()
  let pool: Pool

  const setup = (staffPublicApi: StaffPublicApi = allAccess) => {
    const repo = createUseCaseInboxRepository(db, () => FIXED_TIME)
    const execute = escalateInboxItem({
      repo,
      commandStore: createUseCaseCommandStore(db, () => FIXED_TIME),
      clock: () => FIXED_TIME,
      staffPublicApi,
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
    const seed = (item: InboxItem) => seedInboxItem(pool, db, item, () => FIXED_TIME)
    return { useCase, seed }
  }

  beforeAll(async () => {
    pool = openFixturePool()
    clearEventSchemas()
    registerAllEventSchemas()
    await seedInboxOrganization(pool, ORG_ID, [PROP_1, PROP_OTHER])
  })

  beforeEach(() => clearInboxUseCaseRows(pool, ORG_ID))

  afterAll(async () => {
    clearEventSchemas()
    await dropInboxUseCaseTenant(pool, ORG_ID, [PROP_1, PROP_OTHER])
    await pool.end()
  })

  it('sets the escalation flag', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen())

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.isEscalated).toBe(true)
    expect(updated.escalatedAt).toEqual(FIXED_TIME)
    expect(updated.escalationResolvedAt).toBeNull()
    expect(updated.commandRevision).toBe(2)
  })

  it('records the standalone escalated fact without oldStatus', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen())

    await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    const facts = await readCommittedFacts(pool, ORG_ID)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.eventType).toBe('inbox.inbox_item.escalated')
    expect(facts[0]!.payload).not.toHaveProperty('oldStatus')
  })

  it('is idempotent when already actively escalated', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen({ isEscalated: true, escalatedAt: FIXED_TIME }))

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.isEscalated).toBe(true)
    expect(await readCommittedFacts(pool, ORG_ID)).toHaveLength(0)
  })

  it('re-escalates a resolved escalation', async () => {
    const { useCase, seed } = setup()
    await seed(
      seedOpen({
        isEscalated: false,
        escalationResolvedAt: new Date('2026-04-12'),
      }),
    )

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.isEscalated).toBe(true)
    expect(updated.escalationResolvedAt).toBeNull()
  })

  it('does not change status (escalation is orthogonal)', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen({ status: 'closed' }))

    const updated = await useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin'))

    expect(updated.status).toBe('closed')
    expect(updated.isEscalated).toBe(true)
  })

  it('throws not_found for missing item', async () => {
    const { useCase } = setup()

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
  })

  it('denies access without inbox.write permission', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen())

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxFor('Guest' as unknown as Role)),
    ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'forbidden')
  })

  it('requires feedback.handle to escalate private feedback', async () => {
    const { useCase, seed } = setup()
    await seed(seedOpen({ sourceType: 'feedback', sourceId: FEEDBACK_ID }))

    await expect(
      useCase({ inboxItemId: ITEM_ID }, ctxWith('inbox.write', 'feedback.read')),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
  })

  it('intersects feedback.handle scope before escalating', async () => {
    const { useCase, seed } = setup({
      ...allAccess,
      getAccessiblePropertyIds: async () => [PROP_OTHER],
    })
    await seed(seedOpen({ sourceType: 'feedback', sourceId: FEEDBACK_ID }))

    await expect(
      useCase(
        { inboxItemId: ITEM_ID },
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
  })
})
