import { reviewOpeningAnchor } from './review-opening-anchor.test-fixtures'
import { emptyLookupPorts } from '#/contexts/reputation/inbox/inbox-test-doubles.test-fixtures'
import { describe, it, expect, vi } from 'vitest'
import { inboxItemId, feedbackId, propertyId } from '#/shared/domain/ids'
import type {} from '#/contexts/reputation/domain/review-types'
import {
  inboxItemAssigned,
  inboxItemUnassigned,
  inboxItemEscalated,
  inboxItemEscalationResolved,
} from '#/contexts/reputation/domain/inbox-events'
import { createInboxRepository } from './inbox-repository.server'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from '#/contexts/reputation/inbox/command-store.server'
import { testReviewRepository } from '#/contexts/reputation/reviews/review-stores.test-fixtures'
import {
  ORG_A,
  PROP_A,
  PROP_B,
  USER_A,
  USER_B,
  NOW,
  createAtomicInboxCommandStore,
  db,
  makeItem,
  makeReview,
  seedReviewRevisionOne,
  pool,
  useInboxCommandStoreDb,
} from './inbox-command-store.test-fixtures'

useInboxCommandStoreDb()

describe.sequential('inboxCommandStore applyOnce (integration)', () => {
  it('eligibility reconciliation releases only denied Property assignments and is retry-safe', async () => {
    const repo = createInboxRepository(db, emptyLookupPorts)
    const denied = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000021'),
      propertyId: PROP_A,
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000031'),
      assignedTo: USER_A,
    })
    const retained = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000022'),
      propertyId: PROP_B,
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000032'),
      assignedTo: USER_A,
    })
    const seedingStore = createAtomicInboxCommandStore(db)
    await seedingStore.createItem(denied, {
      sourceRevision: 1,
      openedReason: 'legacy_backfill',
      actorType: 'system',
      triggerEventId: null,
      openedAt: NOW,
    })
    await seedingStore.createItem(retained, {
      sourceRevision: 1,
      openedReason: 'legacy_backfill',
      actorType: 'system',
      triggerEventId: null,
      openedAt: NOW,
    })
    const authorize: InboxCommandAuthority = vi.fn(async (_tx, input) =>
      input.requirements[0]?.propertyId === PROP_A
        ? { allowed: false as const, reason: 'assignee_assignment_denied' }
        : { allowed: true as const },
    )
    const store = createProductionInboxCommandStore(db, authorize)

    await expect(
      store.releaseIneligibleAssignmentsForUser({
        organizationId: ORG_A,
        userId: USER_A,
        actorId: USER_B,
        at: NOW,
      }),
    ).resolves.toEqual({ released: 1 })
    await expect(
      store.releaseIneligibleAssignmentsForUser({
        organizationId: ORG_A,
        userId: USER_A,
        actorId: USER_B,
        at: NOW,
      }),
    ).resolves.toEqual({ released: 0 })

    expect((await repo.findById(denied.id, ORG_A))?.assignedTo).toBeNull()
    expect((await repo.findById(retained.id, ORG_A))?.assignedTo).toBe(USER_A)
    const history = await pool.query(
      `SELECT inbox_item_id, property_id, reason
       FROM inbox_assignment_history
       WHERE inbox_item_id = ANY($1::uuid[])`,
      [[denied.id, retained.id]],
    )
    expect(history.rows).toEqual([
      {
        inbox_item_id: denied.id,
        property_id: PROP_A,
        reason: 'eligibility_lost',
      },
    ])
  })

  it('asks Accounts once for every retained key when all still hold authority', async () => {
    const seedingStore = createAtomicInboxCommandStore(db)
    for (const [index, property] of [PROP_A, PROP_B].entries()) {
      await seedingStore.createItem(
        makeItem({
          id: inboxItemId(`4d000000-0000-0000-0000-0000000000a${index}`),
          propertyId: property,
          sourceType: 'feedback',
          sourceId: feedbackId(`4d000000-0000-0000-0000-0000000000b${index}`),
          assignedTo: USER_A,
        }),
        {
          sourceRevision: 1,
          openedReason: 'legacy_backfill',
          actorType: 'system',
          triggerEventId: null,
          openedAt: NOW,
        },
      )
    }
    const authorize: InboxCommandAuthority = vi.fn(async () => ({
      allowed: true as const,
    }))
    const store = createProductionInboxCommandStore(db, authorize)

    await expect(
      store.releaseIneligibleAssignmentsForUser({
        organizationId: ORG_A,
        userId: USER_A,
        actorId: USER_B,
        at: NOW,
      }),
    ).resolves.toEqual({ released: 0 })

    expect(authorize).toHaveBeenCalledTimes(1)
    expect(vi.mocked(authorize).mock.calls[0]?.[1].requirements).toHaveLength(2)
  })

  describe('release for a removed member', () => {
    const seedAssigned = async (
      items: ReadonlyArray<{ id: string; property: typeof PROP_A; feedback: string }>,
    ) => {
      const seedingStore = createAtomicInboxCommandStore(db)
      for (const { id, property, feedback } of items) {
        await seedingStore.createItem(
          makeItem({
            id: inboxItemId(id),
            propertyId: property,
            sourceType: 'feedback',
            sourceId: feedbackId(feedback),
            assignedTo: USER_A,
          }),
          {
            sourceRevision: 1,
            openedReason: 'legacy_backfill',
            actorType: 'system',
            triggerEventId: null,
            openedAt: NOW,
          },
        )
      }
    }
    const removalRelease = (authorize: InboxCommandAuthority) =>
      createProductionInboxCommandStore(
        db,
        authorize,
      ).releaseIneligibleAssignmentsForUser({
        organizationId: ORG_A,
        userId: USER_A,
        actorId: null,
        releaseReason: 'member_offboarded',
        at: NOW,
      })

    it('releases every assignment with the offboarded reason, no actor and the close fact', async () => {
      await seedAssigned([
        {
          id: '4d000000-0000-0000-0000-000000000041',
          property: PROP_A,
          feedback: '4d000000-0000-0000-0000-000000000051',
        },
        {
          id: '4d000000-0000-0000-0000-000000000042',
          property: PROP_B,
          feedback: '4d000000-0000-0000-0000-000000000052',
        },
      ])
      const authorize: InboxCommandAuthority = async () => ({
        allowed: false as const,
        reason: 'assignee_assignment_denied',
      })

      await expect(removalRelease(authorize)).resolves.toEqual({ released: 2 })
      await expect(removalRelease(authorize)).resolves.toEqual({ released: 0 })

      const rows = await pool.query(
        `SELECT assigned_to FROM inbox_items WHERE organization_id = $1`,
        [ORG_A],
      )
      expect(rows.rows).toEqual([{ assigned_to: null }, { assigned_to: null }])
      const history = await pool.query(
        `SELECT reason, actor_user_id, previous_assignee, next_assignee
         FROM inbox_assignment_history WHERE organization_id = $1`,
        [ORG_A],
      )
      expect(history.rows).toHaveLength(2)
      for (const row of history.rows) {
        expect(row).toEqual({
          reason: 'eligibility_lost',
          actor_user_id: null,
          previous_assignee: USER_A,
          next_assignee: null,
        })
      }
      const facts = await pool.query(
        `SELECT event_type, payload FROM outbox_events
         WHERE organization_id = $1 AND event_type = 'inbox.inbox_items.assignments_released'`,
        [ORG_A],
      )
      expect(facts.rows).toHaveLength(1)
      expect(facts.rows[0].payload).toMatchObject({
        releasedFrom: USER_A,
        releaseReason: 'member_offboarded',
        count: 2,
      })
      expect(facts.rows[0].payload.userId ?? null).toBeNull()
    })

    const seedHandled = async (
      items: ReadonlyArray<{ property: typeof PROP_A; status: 'open' | 'closed' }>,
    ) => {
      const seedingStore = createAtomicInboxCommandStore(db)
      const seeded = items
        .map((entry) => ({
          ...entry,
          id: inboxItemId(crypto.randomUUID()),
          feedback: feedbackId(crypto.randomUUID()),
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
      for (const { id, property, feedback, status } of seeded) {
        await seedingStore.createItem(
          makeItem({
            id,
            propertyId: property,
            sourceType: 'feedback',
            sourceId: feedback,
            assignedTo: USER_A,
            status,
            closedAt: status === 'closed' ? NOW : null,
          }),
          {
            sourceRevision: 1,
            openedReason: 'legacy_backfill',
            actorType: 'system',
            triggerEventId: null,
            openedAt: NOW,
          },
        )
      }
      return seeded
    }
    const releasedFacts = async () =>
      (
        await pool.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM outbox_events
           WHERE organization_id = $1
             AND event_type = 'inbox.inbox_items.assignments_released'`,
          [ORG_A],
        )
      ).rows.map((row) => row.payload)
    const denyAll: InboxCommandAuthority = async () => ({
      allowed: false as const,
      reason: 'assignee_assignment_denied',
    })

    it('counts only the open items in the grouped release fact, though every assignment is cleared', async () => {
      const seeded = await seedHandled([
        { property: PROP_A, status: 'open' },
        { property: PROP_A, status: 'closed' },
        { property: PROP_A, status: 'closed' },
        { property: PROP_B, status: 'closed' },
      ])
      const open = seeded.find((entry) => entry.status === 'open')

      await expect(removalRelease(denyAll)).resolves.toEqual({ released: 4 })

      const remaining = await pool.query(
        `SELECT count(*)::int AS n FROM inbox_items
         WHERE organization_id = $1 AND assigned_to IS NOT NULL`,
        [ORG_A],
      )
      expect(remaining.rows[0].n).toBe(0)
      expect(await releasedFacts()).toEqual([
        expect.objectContaining({
          count: 1,
          releases: [{ propertyId: PROP_A, anchorInboxItemId: open?.id, count: 1 }],
        }),
      ])
    })

    it('records no grouped release fact when every released item was already closed', async () => {
      await seedHandled([
        { property: PROP_B, status: 'closed' },
        { property: PROP_B, status: 'closed' },
      ])

      await expect(removalRelease(denyAll)).resolves.toEqual({ released: 2 })

      expect(await releasedFacts()).toEqual([])
    })

    it('keeps the assignments of a member invited again before the fact was delivered', async () => {
      await seedAssigned([
        {
          id: '4d000000-0000-0000-0000-000000000043',
          property: PROP_A,
          feedback: '4d000000-0000-0000-0000-000000000053',
        },
      ])
      const authorize: InboxCommandAuthority = async () => ({ allowed: true as const })

      await expect(removalRelease(authorize)).resolves.toEqual({ released: 0 })

      const rows = await pool.query(
        `SELECT assigned_to FROM inbox_items WHERE organization_id = $1`,
        [ORG_A],
      )
      expect(rows.rows).toEqual([{ assigned_to: USER_A }])
      const facts = await pool.query(
        `SELECT 1 FROM outbox_events WHERE organization_id = $1
         AND event_type LIKE 'inbox.inbox_item%unassigned%'`,
        [ORG_A],
      )
      expect(facts.rowCount).toBe(0)
    })
  })

  it('releases a quarantined legacy Property assignment without a uuid cast', async () => {
    const legacyPropertyId = propertyId('legacy-property-key')
    const item = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000023'),
      propertyId: legacyPropertyId,
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000033'),
      assignedTo: USER_A,
    })
    await createAtomicInboxCommandStore(db).createItem(item)
    const authorize: InboxCommandAuthority = vi.fn(async () => ({
      allowed: true as const,
    }))

    await expect(
      createProductionInboxCommandStore(
        db,
        authorize,
      ).releaseIneligibleAssignmentsForUser({
        organizationId: ORG_A,
        userId: USER_A,
        actorId: USER_B,
        at: NOW,
      }),
    ).resolves.toEqual({ released: 1 })

    expect(authorize).not.toHaveBeenCalled()
    const rawItem = await pool.query(
      'SELECT assigned_to FROM inbox_items WHERE id = $1 AND organization_id = $2',
      [item.id, ORG_A],
    )
    expect(rawItem.rows).toEqual([{ assigned_to: null }])
    const history = await pool.query(
      `SELECT property_id, reason
       FROM inbox_assignment_history WHERE inbox_item_id = $1`,
      [item.id],
    )
    expect(history.rows).toEqual([
      { property_id: 'legacy-property-key', reason: 'eligibility_lost' },
    ])
  })

  it.each(['single', 'bulk'] as const)(
    '%s assignment records committed revisions across repeated and reversed clocks',
    async (mode) => {
      await seedReviewRevisionOne()
      const store = createAtomicInboxCommandStore(db)
      let item = makeItem()
      await store.createItem(item, reviewOpeningAnchor(item))
      const earlier = new Date(NOW.getTime() - 60_000)
      const decisions = [
        { assignedTo: USER_A, at: NOW },
        { assignedTo: USER_B, at: NOW },
        { assignedTo: USER_A, at: earlier },
        { assignedTo: null, at: earlier },
      ]
      for (const { assignedTo, at } of decisions) {
        const scope = {
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          userId: USER_B,
          occurredAt: at,
          commandRevision: 900,
        }
        const fact =
          assignedTo === null
            ? inboxItemUnassigned({ ...scope, previousAssignee: item.assignedTo! })
            : inboxItemAssigned({
                ...scope,
                assignedTo,
                previousAssignee: item.assignedTo,
              })
        if (mode === 'single') item = await store.assign(item, { assignedTo }, fact)
        else {
          await expect(
            store.bulkAssign({
              items: [item],
              assignedTo,
              actorId: USER_B,
              bulkId: crypto.randomUUID(),
              occurredAt: at,
            }),
          ).resolves.toMatchObject({ updated: 1 })
          const repo = createInboxRepository(db, emptyLookupPorts)
          item = (await repo.findById(item.id, ORG_A))!
        }
      }

      const facts = await pool.query(
        `SELECT payload->>'commandRevision' AS revision, payload->>'assignedTo' AS assignee
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type IN ('inbox.inbox_item.assigned', 'inbox.inbox_item.unassigned')
       ORDER BY (payload->>'commandRevision')::bigint`,
        [ORG_A],
      )
      expect(facts.rows).toEqual([
        { revision: '2', assignee: USER_A },
        { revision: '3', assignee: USER_B },
        { revision: '4', assignee: USER_A },
        { revision: '5', assignee: null },
      ])
      const history = await pool.query(
        `SELECT resulting_command_revision::text AS revision, next_assignee AS assignee
       FROM inbox_assignment_history WHERE inbox_item_id = $1
       ORDER BY resulting_command_revision`,
        [item.id],
      )
      expect(history.rows).toEqual(facts.rows)
      expect(item.commandRevision).toBe(5)
    },
  )

  it('anchors a human Review assignment to its current Handling Cycle', async () => {
    const reviewRepo = testReviewRepository(db)
    await reviewRepo.upsert(
      makeReview({
        sourceRevision: 1,
        analysisSequence: 1,
      }),
      NOW,
      'a'.repeat(64),
    )
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()
    await store.createItem(item, reviewOpeningAnchor(item))

    const assigned = await store.assign(
      item,
      { assignedTo: USER_A },
      inboxItemAssigned({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: USER_A,
        assignedTo: USER_A,
        source: 'web',
        occurredAt: NOW,
      }),
    )

    const facts = await pool.query(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.assigned'`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([
      { payload: expect.objectContaining({ commandRevision: 2 }) },
    ])
    expect(assigned.commandRevision).toBe(2)
    const history = await pool.query(
      `SELECT resulting_command_revision::text, handling_cycle_number::text,
              previous_assignee, next_assignee, reason
       FROM inbox_assignment_history
       WHERE inbox_item_id = $1`,
      [item.id],
    )
    expect(history.rows).toEqual([
      {
        resulting_command_revision: '2',
        handling_cycle_number: '1',
        previous_assignee: null,
        next_assignee: USER_A,
        reason: 'claim',
      },
    ])
  })

  it('appends one escalation history row per decision, co-committed with the item and fact', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()
    await store.createItem(item, reviewOpeningAnchor(item))

    const escalated = await store.escalate(
      item,
      { escalatedBy: USER_A },
      inboxItemEscalated({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: USER_A,
        occurredAt: NOW,
      }),
    )
    const resolvedAt = new Date(NOW.getTime() + 60_000)
    const resolved = await store.resolveEscalation(
      escalated,
      { resolvedBy: USER_B },
      inboxItemEscalationResolved({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: USER_B,
        occurredAt: resolvedAt,
      }),
    )

    // Escalation stays orthogonal to status (ADR 0055).
    expect(escalated.status).toBe('open')
    expect(resolved.status).toBe('open')
    expect(escalated.commandRevision).toBe(2)
    expect(resolved.commandRevision).toBe(3)

    const history = await pool.query(
      `SELECT resulting_command_revision::text, handling_cycle_number::text,
              kind, actor_user_id, occurred_at
       FROM inbox_escalation_history
       WHERE inbox_item_id = $1
       ORDER BY resulting_command_revision`,
      [item.id],
    )
    expect(history.rows).toEqual([
      {
        resulting_command_revision: '2',
        handling_cycle_number: '1',
        kind: 'escalated',
        actor_user_id: USER_A,
        occurred_at: NOW,
      },
      {
        resulting_command_revision: '3',
        handling_cycle_number: '1',
        kind: 'resolved',
        actor_user_id: USER_B,
        occurred_at: resolvedAt,
      },
    ])

    const facts = await pool.query(
      `SELECT event_type FROM outbox_events
       WHERE organization_id = $1 AND event_type LIKE 'inbox.inbox_item.escalat%'
       ORDER BY event_type`,
      [ORG_A],
    )
    expect(facts.rows.map((row) => String(row.event_type))).toEqual([
      'inbox.inbox_item.escalated',
      'inbox.inbox_item.escalation_resolved',
    ])

    const kinds = await pool.query(
      `SELECT kind FROM inbox_escalation_history
       WHERE inbox_item_id = $1 AND organization_id = $2
       ORDER BY occurred_at, resulting_command_revision`,
      [item.id, item.organizationId],
    )
    expect(kinds.rows.map((row) => row.kind)).toEqual(['escalated', 'resolved'])
    const head = await pool.query('SELECT is_escalated FROM inbox_items WHERE id = $1', [
      item.id,
    ])
    expect(head.rows[0]).toEqual({ is_escalated: false })
  })

  it('rolls the escalation history row back with the item when the fact insert fails', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()
    await store.createItem(item, reviewOpeningAnchor(item))

    const ghost = {
      ...inboxItemEscalated({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: USER_A,
        occurredAt: NOW,
      }),
      _tag: 'inbox.inbox_item.ghost_escalated',
    } as unknown as Parameters<typeof store.escalate>[2]

    await expect(store.escalate(item, { escalatedBy: USER_A }, ghost)).rejects.toThrow(
      /is not registered for the outbox/u,
    )

    const history = await pool.query(
      'SELECT 1 FROM inbox_escalation_history WHERE inbox_item_id = $1',
      [item.id],
    )
    expect(history.rows).toHaveLength(0)
    const rows = await pool.query(
      'SELECT is_escalated, command_revision::text FROM inbox_items WHERE id = $1',
      [item.id],
    )
    expect(rows.rows[0]).toEqual({ is_escalated: false, command_revision: '1' })
  })
})
