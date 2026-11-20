// The manager-priority server function, called as signed-in members over
// PostgreSQL with the real tenant resolution, execution policy and Inbox API.
// The priority rules sit in use-cases/set-inbox-item-priority.integration.test.ts;
// this file holds the boundary: who may call, the fences and the rows left behind.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { REVIEW_SEED_TABLES } from '#/shared/testing/server-function-review-seeds'
import type { TestInboxItem } from '#/shared/testing/server-function-review-seeds'
import { PRIORITY_CHANGED_MESSAGE } from '../../reputation/domain/inbox-errors'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { setInboxItemPriorityFn } from './inbox-priority'

const harness = setupServerFunctionHarness({ cleanupTables: [...REVIEW_SEED_TABLES] })

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  const review = await harness.seedReview(property)
  const item = await harness.seedInboxItem({ review })
  return { organization, admin, manager, property, item }
}

const choose = (item: TestInboxItem, data: object = {}) => ({
  data: {
    inboxItemId: item.id,
    expectedCommandRevision: item.commandRevision,
    expectedPriority: null,
    priority: 'urgent' as const,
    ...data,
  },
})

async function stored(item: TestInboxItem) {
  const { rows } = await harness.pool().query<{
    manager_priority: string | null
    manager_priority_set_by: string | null
    command_revision: string
  }>(
    `SELECT manager_priority, manager_priority_set_by, command_revision
       FROM inbox_items WHERE id = $1`,
    [item.id],
  )
  return rows[0]!
}

async function facts(organizationId: string) {
  const { rows } = await harness.pool().query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM outbox_events
      WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.priority_changed'`,
    [organizationId],
  )
  return rows.map((row) => row.payload)
}

describe('setInboxItemPriorityFn', () => {
  it('is a POST', () => {
    expect(setInboxItemPriorityFn).toHaveProperty('method', 'POST')
  })

  it('sets the level for a PropertyManager and records who chose it and one fact', async () => {
    const { organization, manager, item } = await hotel()

    await harness.callAs(manager, () => setInboxItemPriorityFn(choose(item)))

    expect(await stored(item)).toEqual({
      manager_priority: 'urgent',
      manager_priority_set_by: manager.userId,
      command_revision: '2',
    })
    expect(await facts(organization.id)).toEqual([
      expect.objectContaining({
        inboxItemId: item.id,
        userId: manager.userId,
        priority: 'urgent',
        previousPriority: null,
      }),
    ])
  })

  it('sets the level for an AccountAdmin', async () => {
    const { admin, item } = await hotel()

    await harness.callAs(admin, () =>
      setInboxItemPriorityFn(choose(item, { priority: 'low' })),
    )

    expect(await stored(item)).toMatchObject({ manager_priority: 'low' })
  })

  it('writes nothing when the level asked for is already held', async () => {
    const { organization, manager, item } = await hotel()
    await harness.callAs(manager, () => setInboxItemPriorityFn(choose(item)))

    await harness.callAs(manager, () =>
      setInboxItemPriorityFn(
        choose(item, { expectedCommandRevision: 2, expectedPriority: 'urgent' }),
      ),
    )

    expect(await stored(item)).toMatchObject({ command_revision: '2' })
    expect(await facts(organization.id)).toHaveLength(1)
  })

  it('answers a stale command revision as a result for the client to retry', async () => {
    const { organization, manager, item } = await hotel()

    const result = await harness.callAs(manager, () =>
      setInboxItemPriorityFn(choose(item, { expectedCommandRevision: 9 })),
    )

    expect(result).toEqual({
      ok: false,
      code: 'revision_conflict',
      currentCommandRevision: 1,
      currentStatus: 'open',
    })
    expect(await stored(item)).toMatchObject({ manager_priority: null })
    expect(await facts(organization.id)).toEqual([])
  })

  it("refuses a colleague's change to the priority itself with a 409 the retry never replays", async () => {
    const { organization, admin, manager, item } = await hotel()
    await harness.callAs(admin, () =>
      setInboxItemPriorityFn(choose(item, { priority: 'high' })),
    )

    await expect(
      harness.callAs(manager, () =>
        setInboxItemPriorityFn(choose(item, { expectedCommandRevision: 2 })),
      ),
    ).rejects.toMatchObject({
      _tag: 'InboxError',
      code: 'priority_changed',
      status: 409,
      message: PRIORITY_CHANGED_MESSAGE,
    })
    expect(await stored(item)).toMatchObject({ manager_priority: 'high' })
    expect(await facts(organization.id)).toHaveLength(1)
  })

  it('refuses a PropertyManager without a grant on the Property and writes nothing', async () => {
    const { organization, item } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () => setInboxItemPriorityFn(choose(item))),
    ).rejects.toMatchObject({ status: 403 })
    expect(await stored(item)).toMatchObject({ manager_priority: null })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, item } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () => setInboxItemPriorityFn(choose(item))),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    expect(await stored(item)).toMatchObject({ manager_priority: null })
  })

  it('does not find the item for an AccountAdmin of another Organization', async () => {
    const { item } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () => setInboxItemPriorityFn(choose(item))),
    ).rejects.toMatchObject({ status: 404 })
    expect(await stored(item)).toMatchObject({ manager_priority: null })
  })

  it('refuses a caller with no session', async () => {
    const { item } = await hotel()

    await expect(
      harness.callAs(null, () => setInboxItemPriorityFn(choose(item))),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})
