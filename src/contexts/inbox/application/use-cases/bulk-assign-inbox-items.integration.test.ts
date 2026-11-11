import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { bulkAssignInboxItems } from './bulk-assign-inbox-items'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  clearInboxOrganization,
  createUseCaseCommandStore,
  createUseCaseDatabase,
  createUseCaseInboxRepository,
  dropInboxUseCaseTenant,
  openFixturePool,
  readOutboxFacts,
  runScopedId,
  seedInboxItem,
  seedInboxOrganization,
} from '../../infrastructure/inbox-database-fixtures'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { isInboxError } from '../../domain/errors'

const NOW = new Date('2026-08-27T10:00:00.000Z')
const ORG = organizationId('org-bulk-assign-inbox-items-test')
const ACTOR = userId('actor-1')
const ASSIGNEE = userId('assignee-1')
const PROP_A = propertyId(runScopedId('7e000000-0000-4000-8000-000000000001'))
const PROP_B = propertyId(runScopedId('7e000000-0000-4000-8000-000000000002'))
const BULK_ID = runScopedId('6a000000-0000-4000-8000-000000000001')

const adminCtx = {
  organizationId: ORG,
  userId: ACTOR,
  role: 'AccountAdmin',
} as AuthContext

const item = (
  id: string,
  prop = PROP_A,
  assignedTo: ReturnType<typeof userId> | null = null,
): InboxItem => ({
  id: inboxItemId(id),
  organizationId: ORG,
  propertyId: prop,
  sourceType: 'feedback',
  sourceId: feedbackId(id.replace('0000-4000-8000-0000', '1111-4000-8000-0000')),
  status: 'open',
  rating: 3,
  sourceDate: NOW,
  platform: null,
  snippet: null,
  assignedTo,
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
  createdAt: NOW,
  updatedAt: NOW,
})

const peopleApi = (accessible: readonly ReturnType<typeof propertyId>[] | null) =>
  ({
    getAccessiblePropertyIds: async () => accessible,
    getAssignedPortals: async () => [],
  }) satisfies StaffPublicApi

const commands = (...items: readonly InboxItem[]) =>
  items.map((entry) => ({
    inboxItemId: entry.id,
    expectedCommandRevision: entry.commandRevision,
  }))

describe.sequential('bulkAssignInboxItems', () => {
  const db = createUseCaseDatabase()
  let pool: Pool

  const setup = (accessible: readonly ReturnType<typeof propertyId>[] | null = null) => {
    const repo = createUseCaseInboxRepository(db, () => NOW)
    const commandStore = createUseCaseCommandStore(db, () => NOW)
    const execute = bulkAssignInboxItems({
      repo,
      commandStore,
      staffPublicApi: peopleApi(accessible),
      clock: () => NOW,
      idGen: () => BULK_ID,
    })
    const seed = async (...items: InboxItem[]) => {
      for (const entry of items) await seedInboxItem(pool, db, entry, () => NOW)
    }
    const assignees = async () =>
      (
        await pool.query<{ assigned_to: string | null }>(
          'SELECT assigned_to FROM inbox_items WHERE organization_id = $1 ORDER BY id',
          [ORG],
        )
      ).rows.map((row) => row.assigned_to)
    const factsOf = async (eventType: string) =>
      (await readOutboxFacts(pool, ORG)).filter((fact) => fact.eventType === eventType)
    return { seed, assignees, factsOf, commandStore, execute }
  }

  beforeAll(async () => {
    pool = openFixturePool()
    clearEventSchemas()
    registerAllEventSchemas()
    await seedInboxOrganization(pool, ORG, [PROP_A, PROP_B])
  })

  beforeEach(() => clearInboxOrganization(pool, ORG))

  afterAll(async () => {
    clearEventSchemas()
    await dropInboxUseCaseTenant(pool, ORG, [PROP_A, PROP_B])
    await pool.end()
  })

  it('assigns the complete set and closes it with one sorted content-free fact', async () => {
    const { seed, assignees, factsOf, execute } = setup()
    const second = item(runScopedId('00000000-0000-4000-8000-000000000002'), PROP_B)
    const first = item(runScopedId('00000000-0000-4000-8000-000000000001'))
    await seed(second, first)

    const result = await execute(
      { items: commands(second, first), assignedToUserId: ASSIGNEE },
      adminCtx,
    )

    expect(result).toEqual({
      updated: 2,
      bulkId: BULK_ID,
      results: [
        { inboxItemId: second.id, outcome: 'assigned' },
        { inboxItemId: first.id, outcome: 'assigned' },
      ],
    })
    expect(await assignees()).toEqual([ASSIGNEE, ASSIGNEE])
    const perItem = await factsOf('inbox.inbox_item.assigned')
    expect(perItem).toHaveLength(2)
    expect(perItem.every((fact) => fact.payload.bulkId === BULK_ID)).toBe(true)
    expect(
      (await factsOf('inbox.inbox_items.bulk_assignment_completed')).map(
        (fact) => fact.payload,
      ),
    ).toEqual([
      expect.objectContaining({
        bulkId: BULK_ID,
        count: 2,
        transitions: [
          expect.objectContaining({ inboxItemId: first.id, nextAssignee: ASSIGNEE }),
          expect.objectContaining({ inboxItemId: second.id, nextAssignee: ASSIGNEE }),
        ],
      }),
    ])
  })

  it('releases and reassigns with explicit per-item outcomes', async () => {
    const { seed, execute } = setup()
    const assigned = item(
      runScopedId('00000000-0000-4000-8000-000000000003'),
      PROP_A,
      ASSIGNEE,
    )
    await seed(assigned)

    await expect(
      execute({ items: commands(assigned), assignedToUserId: null }, adminCtx),
    ).resolves.toMatchObject({
      updated: 1,
      results: [{ inboxItemId: assigned.id, outcome: 'released' }],
    })
  })

  it('does not write any row when one selected item is stale', async () => {
    const { seed, assignees, factsOf, execute, commandStore } = setup()
    const first = item(runScopedId('00000000-0000-4000-8000-000000000004'))
    const second = item(runScopedId('00000000-0000-4000-8000-000000000005'), PROP_B)
    await seed(first, { ...second, commandRevision: 2 })
    const storeCall = vi.spyOn(commandStore, 'bulkAssign')

    const result = await execute(
      { items: commands(first, second), assignedToUserId: ASSIGNEE },
      adminCtx,
    )

    expect(result).toEqual({
      updated: 0,
      bulkId: null,
      results: [
        { inboxItemId: first.id, outcome: 'batch_aborted' },
        { inboxItemId: second.id, outcome: 'revision_conflict' },
      ],
    })
    expect(storeCall).not.toHaveBeenCalled()
    expect((await assignees()).every((assignee) => assignee === null)).toBe(true)
    expect(await factsOf('inbox.inbox_item.assigned')).toEqual([])
  })

  it('does not disclose or mutate an inaccessible item and aborts the visible peer', async () => {
    const { seed, assignees, execute } = setup([PROP_A])
    const first = item(runScopedId('00000000-0000-4000-8000-000000000006'))
    const second = item(runScopedId('00000000-0000-4000-8000-000000000007'), PROP_B)
    await seed(first, second)
    const scopedManager = { ...adminCtx, role: 'PropertyManager' } as AuthContext

    await expect(
      execute(
        { items: commands(first, second), assignedToUserId: ASSIGNEE },
        scopedManager,
      ),
    ).resolves.toEqual({
      updated: 0,
      bulkId: null,
      results: [
        { inboxItemId: first.id, outcome: 'batch_aborted' },
        { inboxItemId: second.id, outcome: 'unavailable' },
      ],
    })
    expect((await assignees()).every((assignee) => assignee === null)).toBe(true)
  })

  it('keeps unchanged items in the validated batch without recording a false transition', async () => {
    const { seed, factsOf, execute } = setup()
    const current = item(
      runScopedId('00000000-0000-4000-8000-000000000008'),
      PROP_A,
      ASSIGNEE,
    )
    await seed(current)

    await expect(
      execute({ items: commands(current), assignedToUserId: ASSIGNEE }, adminCtx),
    ).resolves.toEqual({
      updated: 0,
      bulkId: BULK_ID,
      results: [{ inboxItemId: current.id, outcome: 'unchanged' }],
    })
    expect(await factsOf('inbox.inbox_item.assigned')).toEqual([])
    expect(await factsOf('inbox.inbox_items.bulk_assignment_completed')).toEqual([])
  })

  it('rejects duplicate selections and callers without assignment management', async () => {
    const { seed, execute } = setup()
    const current = item(runScopedId('00000000-0000-4000-8000-000000000009'))
    await seed(current)
    await expect(
      execute(
        { items: commands(current, current), assignedToUserId: ASSIGNEE },
        adminCtx,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
    )
    await expect(
      execute({ items: commands(current), assignedToUserId: ASSIGNEE }, {
        ...adminCtx,
        role: 'Member',
      } as AuthContext),
    ).rejects.toSatisfy(
      (error: unknown) => isInboxError(error) && error.code === 'forbidden',
    )
  })
})
