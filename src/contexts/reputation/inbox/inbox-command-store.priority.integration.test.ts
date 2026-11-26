import { reviewOpeningAnchor } from './review-opening-anchor.test-fixtures'
import { describe, it, expect } from 'vitest'
import {} from '#/shared/domain/ids'
import type { InboxItem, InboxPriority } from '#/contexts/reputation/domain/inbox-types'
import {
  inboxItemAssigned,
  inboxItemEscalated,
  inboxItemEscalationResolved,
  inboxItemPriorityChanged,
} from '#/contexts/reputation/domain/inbox-events'
import { isInboxError } from '#/contexts/reputation/domain/inbox-errors'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from '#/contexts/reputation/inbox/command-store.server'
import {
  ORG_A,
  PROP_A,
  USER_A,
  USER_B,
  NOW,
  createAtomicInboxCommandStore,
  db,
  makeItem,
  seedReviewRevisionOne,
  pool,
  useInboxCommandStoreDb,
} from './inbox-command-store.test-fixtures'

useInboxCommandStoreDb()

// ─── Manager priority (ADR 0071) ───────────────────────────────────────────

const priorityFact = (
  item: InboxItem,
  priority: InboxPriority | null,
  previousPriority: InboxPriority | null,
  actor = USER_A,
  at = NOW,
) =>
  inboxItemPriorityChanged({
    inboxItemId: item.id,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    userId: actor,
    priority,
    previousPriority,
    occurredAt: at,
  })

async function priorityHistory(itemId: string) {
  const result = await pool.query(
    `SELECT resulting_command_revision::text, handling_cycle_number::text,
            priority, previous_priority, actor_user_id
       FROM inbox_priority_history
      WHERE inbox_item_id = $1 AND organization_id = $2
      ORDER BY resulting_command_revision`,
    [itemId, ORG_A],
  )
  return result.rows
}

async function priorityColumns(itemId: string) {
  const result = await pool.query(
    `SELECT manager_priority, manager_priority_set_by, manager_priority_set_at,
            command_revision::text
       FROM inbox_items WHERE id = $1 AND organization_id = $2`,
    [itemId, ORG_A],
  )
  return result.rows[0]
}

describe.sequential('inboxCommandStore setPriority (integration)', () => {
  it('commits the level, its history row and the fact together, through set, change and reset', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()
    await store.createItem(item, reviewOpeningAnchor(item))

    const set = await store.setPriority(
      item,
      { priority: 'urgent', setBy: USER_A },
      priorityFact(item, 'urgent', null),
    )
    const changedAt = new Date(NOW.getTime() + 60_000)
    const changed = await store.setPriority(
      set,
      { priority: 'low', setBy: USER_B },
      priorityFact(set, 'low', 'urgent', USER_B, changedAt),
    )
    const reset = await store.setPriority(
      changed,
      { priority: null, setBy: USER_A },
      priorityFact(changed, null, 'low'),
    )

    expect(set).toMatchObject({
      managerPriority: 'urgent',
      managerPrioritySetBy: USER_A,
      managerPrioritySetAt: NOW,
      commandRevision: 2,
      status: 'open',
    })
    expect(changed).toMatchObject({
      managerPriority: 'low',
      managerPrioritySetBy: USER_B,
    })
    expect(reset).toMatchObject({
      managerPriority: null,
      managerPrioritySetBy: null,
      managerPrioritySetAt: null,
      commandRevision: 4,
    })
    expect(await priorityHistory(item.id)).toEqual([
      {
        resulting_command_revision: '2',
        handling_cycle_number: '1',
        priority: 'urgent',
        previous_priority: null,
        actor_user_id: USER_A,
      },
      {
        resulting_command_revision: '3',
        handling_cycle_number: '1',
        priority: 'low',
        previous_priority: 'urgent',
        actor_user_id: USER_B,
      },
      {
        resulting_command_revision: '4',
        handling_cycle_number: '1',
        priority: null,
        previous_priority: 'low',
        actor_user_id: USER_A,
      },
    ])
    const facts = await pool.query(
      `SELECT payload->>'priority' AS priority, payload->>'previousPriority' AS previous
         FROM outbox_events
        WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.priority_changed'
        ORDER BY created_at, payload->>'occurredAt'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(3)
    expect(facts.rows.map((row) => row.priority)).toEqual(
      expect.arrayContaining(['urgent', 'low', null]),
    )
  })

  it('answers a stale revision with a conflict and writes nothing', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()
    await store.createItem(item, reviewOpeningAnchor(item))
    await store.escalate(
      item,
      { escalatedBy: USER_B },
      inboxItemEscalated({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: USER_B,
        occurredAt: NOW,
      }),
    )

    const refusal: unknown = await store
      .setPriority(
        item,
        { priority: 'high', setBy: USER_A },
        priorityFact(item, 'high', null),
      )
      .then(
        () => null,
        (error: unknown) => error,
      )

    expect(isInboxError(refusal) && refusal.code).toBe('revision_conflict')
    expect(await priorityHistory(item.id)).toEqual([])
    expect((await priorityColumns(item.id))?.manager_priority).toBeNull()
  })

  it('re-authorizes the actor inside the transaction and refuses one who lost authority', async () => {
    await seedReviewRevisionOne()
    const asked: unknown[] = []
    const revoked: InboxCommandAuthority = async (_tx, input) => {
      asked.push(input.requirements)
      return { allowed: false, reason: 'grant_revoked' }
    }
    const store = createProductionInboxCommandStore(db, revoked)
    const item = makeItem()
    await createAtomicInboxCommandStore(db).createItem(item, reviewOpeningAnchor(item))

    const refusal: unknown = await store
      .setPriority(
        item,
        { priority: 'urgent', setBy: USER_A },
        priorityFact(item, 'urgent', null),
      )
      .then(
        () => null,
        (error: unknown) => error,
      )

    expect(isInboxError(refusal) && refusal.code).toBe('forbidden')
    expect(asked).toEqual([
      [
        {
          userId: USER_A,
          permissions: ['inbox.write', 'review.read'],
          purpose: 'actor',
          propertyId: PROP_A,
        },
      ],
    ])
    expect(await priorityHistory(item.id)).toEqual([])
    expect(await priorityColumns(item.id)).toMatchObject({
      manager_priority: null,
      command_revision: '1',
    })
  })

  it('fails closed on a fact that names no signed-in manager', async () => {
    await seedReviewRevisionOne()
    // An authority that would allow anything: the refusal must not depend on it.
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()
    await store.createItem(item, reviewOpeningAnchor(item))
    const withoutWebActor = {
      ...priorityFact(item, 'urgent', null),
      source: 'import',
    } as unknown as Parameters<typeof store.setPriority>[2]
    const someoneElse = priorityFact(item, 'urgent', null, USER_B)

    for (const fact of [withoutWebActor, someoneElse]) {
      const refusal: unknown = await store
        .setPriority(item, { priority: 'urgent', setBy: USER_A }, fact)
        .then(
          () => null,
          (error: unknown) => error,
        )
      expect(isInboxError(refusal) && refusal.code).toBe('forbidden')
    }
    expect(await priorityHistory(item.id)).toEqual([])
    const facts = await pool.query(
      `SELECT 1 FROM outbox_events
        WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.priority_changed'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it('rolls the history row and the level back when the fact insert fails', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()
    await store.createItem(item, reviewOpeningAnchor(item))
    const ghost = {
      ...priorityFact(item, 'urgent', null),
      _tag: 'inbox.inbox_item.ghost_priority_changed',
    } as unknown as Parameters<typeof store.setPriority>[2]

    await expect(
      store.setPriority(item, { priority: 'urgent', setBy: USER_A }, ghost),
    ).rejects.toThrow(/is not registered for the outbox/u)

    expect(await priorityHistory(item.id)).toEqual([])
    expect(await priorityColumns(item.id)).toMatchObject({
      manager_priority: null,
      command_revision: '1',
    })
  })

  it('leaves the level alone under every other item command', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()
    await store.createItem(item, reviewOpeningAnchor(item))
    let current = await store.setPriority(
      item,
      { priority: 'high', setBy: USER_A },
      priorityFact(item, 'high', null),
    )

    current = await store.escalate(
      current,
      { escalatedBy: USER_A },
      inboxItemEscalated({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: USER_A,
        occurredAt: NOW,
      }),
    )
    current = await store.resolveEscalation(
      current,
      { resolvedBy: USER_A },
      inboxItemEscalationResolved({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: USER_A,
        occurredAt: NOW,
      }),
    )
    current = await store.assign(
      current,
      { assignedTo: USER_B },
      inboxItemAssigned({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: USER_A,
        assignedTo: USER_B,
        source: 'web',
        occurredAt: NOW,
      }),
    )

    expect(current).toMatchObject({
      managerPriority: 'high',
      managerPrioritySetBy: USER_A,
      managerPrioritySetAt: NOW,
    })
    expect(await priorityHistory(item.id)).toHaveLength(1)
  })

  it('refuses a half-stamped level at the database (inbox_items_manager_priority_stamped)', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()
    await store.createItem(item, reviewOpeningAnchor(item))

    await expect(
      pool.query(`UPDATE inbox_items SET manager_priority = 'urgent' WHERE id = $1`, [
        item.id,
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'inbox_items_manager_priority_stamped',
    })
  })
})
