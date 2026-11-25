import { reviewOpeningAnchor } from './review-opening-anchor.test-fixtures'
import { describe, it, expect, vi } from 'vitest'
import { inboxItemId, feedbackId, reviewId } from '#/shared/domain/ids'
import type { InboxItem } from '#/contexts/reputation/domain/inbox-types'
import type {} from '#/contexts/reputation/domain/review-types'
import {
  inboxItemBulkStatusChanged,
  inboxItemStatusChanged,
} from '#/contexts/reputation/domain/inbox-events'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from '#/contexts/reputation/inbox/command-store.server'
import { testReviewRepository } from '#/contexts/reputation/reviews/review-stores.test-fixtures'
import {
  ORG_A,
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
  it('decides the actor and the assignee of a manual reopen in one Accounts call', async () => {
    await seedReviewRevisionOne()
    const seedingStore = createAtomicInboxCommandStore(db)
    const closed = makeItem({ status: 'closed', closedAt: NOW, assignedTo: USER_A })
    await seedingStore.createItem(closed, null, reviewOpeningAnchor(closed))
    const authorize: InboxCommandAuthority = vi.fn(async () => ({
      allowed: true as const,
    }))
    const store = createProductionInboxCommandStore(db, authorize, () => NOW)

    await store.reopenReviewCycle({
      item: closed,
      expected: { cycleNumber: 1, sourceRevision: 1, stateRevision: 1 },
      reason: 'other',
      explanation: 'A new guest message needs a response.',
      fact: inboxItemStatusChanged({
        inboxItemId: closed.id,
        organizationId: closed.organizationId,
        propertyId: closed.propertyId,
        oldStatus: 'closed',
        newStatus: 'open',
        userId: USER_B,
        occurredAt: NOW,
      }),
      now: NOW,
    })

    expect(authorize).toHaveBeenCalledTimes(1)
    const purposes = vi
      .mocked(authorize)
      .mock.calls[0]?.[1].requirements.map((requirement) => requirement.purpose)
    expect(purposes?.slice().sort()).toEqual(['actor', 'assignee'])
  })

  describe('manual reopen authority races', () => {
    const seedClosedAssigned = async () => {
      await seedReviewRevisionOne()
      const closed = makeItem({ status: 'closed', closedAt: NOW, assignedTo: USER_A })
      await createAtomicInboxCommandStore(db).createItem(
        closed,
        null,
        reviewOpeningAnchor(closed),
      )
      const command = {
        item: closed,
        expected: { cycleNumber: 1, sourceRevision: 1, stateRevision: 1 },
        reason: 'other' as const,
        explanation: 'A new guest message needs a response.',
        fact: inboxItemStatusChanged({
          inboxItemId: closed.id,
          organizationId: closed.organizationId,
          propertyId: closed.propertyId,
          oldStatus: 'closed',
          newStatus: 'open',
          userId: USER_B,
          occurredAt: NOW,
        }),
        now: NOW,
      }
      return { closed, command }
    }
    const readItem = async (id: string) =>
      (
        await pool.query(
          `SELECT status, assigned_to, command_revision::int AS command_revision,
                  (SELECT count(*)::int FROM inbox_handling_cycles c
                   WHERE c.inbox_item_id = item.id) AS cycle_count
             FROM inbox_items item WHERE item.id = $1`,
          [id],
        )
      ).rows[0]
    const purposesOf = (authorize: InboxCommandAuthority) =>
      vi
        .mocked(authorize)
        .mock.calls.map((call) =>
          call[1].requirements
            .map((requirement: { purpose: string }) => requirement.purpose)
            .sort(),
        )

    it('refuses with forbidden and changes nothing when the actor loses authority after the item was read', async () => {
      const { closed, command } = await seedClosedAssigned()
      const authorize: InboxCommandAuthority = vi.fn(async () => ({
        allowed: false as const,
        reason: 'grant_revoked',
      }))
      const store = createProductionInboxCommandStore(db, authorize, () => NOW)

      await expect(store.reopenReviewCycle(command)).rejects.toMatchObject({
        code: 'forbidden',
      })

      expect(purposesOf(authorize)).toEqual([['actor', 'assignee'], ['actor']])
      expect(await readItem(closed.id)).toEqual({
        status: 'closed',
        assigned_to: USER_A,
        command_revision: 1,
        cycle_count: 1,
      })
    })

    it('reopens and unassigns when only the assignee lost eligibility', async () => {
      const { closed, command } = await seedClosedAssigned()
      const authorize: InboxCommandAuthority = vi.fn(async (_tx, input) =>
        input.requirements.some(
          (requirement: { purpose: string }) => requirement.purpose === 'assignee',
        )
          ? { allowed: false as const, reason: 'assignee_assignment_denied' }
          : { allowed: true as const },
      )
      const store = createProductionInboxCommandStore(db, authorize, () => NOW)

      await store.reopenReviewCycle(command)

      expect(purposesOf(authorize)).toEqual([
        ['actor', 'assignee'],
        ['actor'],
        ['assignee'],
      ])
      expect(await readItem(closed.id)).toMatchObject({
        status: 'open',
        assigned_to: null,
        cycle_count: 2,
      })
    })

    it('answers revision_conflict and keeps the item closed when the assignee authority changes mid-command', async () => {
      const { closed, command } = await seedClosedAssigned()
      const authorize: InboxCommandAuthority = vi.fn(async (_tx, input) => {
        const asksAssignee = input.requirements.some(
          (requirement: { purpose: string }) => requirement.purpose === 'assignee',
        )
        if (!asksAssignee) return { allowed: true as const }
        return { allowed: false as const, reason: 'authority_changed' }
      })
      const store = createProductionInboxCommandStore(db, authorize, () => NOW)

      await expect(store.reopenReviewCycle(command)).rejects.toMatchObject({
        code: 'revision_conflict',
      })

      expect(await readItem(closed.id)).toEqual({
        status: 'closed',
        assigned_to: USER_A,
        command_revision: 1,
        cycle_count: 1,
      })
    })
  })

  it('answers not_found, not a revision conflict, when a reopen names another source', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const closed = makeItem({ status: 'closed', closedAt: NOW })
    await store.createItem(closed, null, reviewOpeningAnchor(closed))

    await expect(
      store.reopenReviewCycle({
        item: { ...closed, sourceId: reviewId('4d000000-0000-0000-0000-0000000000ff') },
        // A stale expectation too: the source check must come first.
        expected: { cycleNumber: 9, sourceRevision: 9, stateRevision: 9 },
        reason: 'other',
        explanation: 'A new guest message needs a response.',
        fact: inboxItemStatusChanged({
          inboxItemId: closed.id,
          organizationId: closed.organizationId,
          propertyId: closed.propertyId,
          oldStatus: 'closed',
          newStatus: 'open',
          userId: USER_B,
          occurredAt: NOW,
        }),
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('lets exactly one concurrent governed Review reopen advance the canonical head', async () => {
    const reviewRepo = testReviewRepository(db)
    await reviewRepo.upsert(
      makeReview({ sourceRevision: 1, analysisSequence: 1 }),
      NOW,
      'c'.repeat(64),
    )
    const store = createAtomicInboxCommandStore(db)
    const closed = makeItem({
      status: 'closed',
      closedAt: NOW,
      assignedTo: USER_A,
    })
    await store.createItem(closed, null, reviewOpeningAnchor(closed))
    const fact = inboxItemStatusChanged({
      inboxItemId: closed.id,
      organizationId: closed.organizationId,
      propertyId: closed.propertyId,
      oldStatus: 'closed',
      newStatus: 'open',
      userId: USER_B,
      occurredAt: NOW,
    })
    const command = {
      item: closed,
      expected: {
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 1,
      },
      reason: 'other' as const,
      explanation: '  A new guest message needs a response.  ',
      fact,
      now: NOW,
    }

    const outcomes = await Promise.allSettled([
      store.reopenReviewCycle(command),
      store.reopenReviewCycle(command),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toMatchObject({ code: 'revision_conflict' })
    }
    await expect(store.reopenReviewCycle(command)).rejects.toMatchObject({
      code: 'revision_conflict',
    })

    const proof = await pool.query(
      `SELECT
         item.status AS item_status,
         item.closed_at,
         item.assigned_to,
         item.command_revision::int AS command_revision,
         head.status AS head_status,
         head.current_cycle_number::int AS cycle_number,
         head.state_revision::int AS state_revision,
         cycle.opened_reason,
         cycle.manual_reopen_reason,
         cycle.manual_reopen_explanation,
         cycle.opened_by,
         (SELECT count(*)::int FROM inbox_handling_cycles all_cycles
          WHERE all_cycles.inbox_item_id = item.id) AS cycle_count,
         (SELECT count(*)::int FROM outbox_events event
          WHERE event.organization_id = item.organization_id
            AND event.event_type = 'inbox.inbox_item.status_changed'
            AND event.payload->>'inboxItemId' = item.id::text) AS fact_count
       FROM inbox_items item
       JOIN inbox_handling_cycle_heads head ON head.inbox_item_id = item.id
       JOIN inbox_handling_cycles cycle
         ON cycle.inbox_item_id = head.inbox_item_id
        AND cycle.cycle_number = head.current_cycle_number
       WHERE item.id = $1`,
      [closed.id],
    )
    expect(proof.rows).toEqual([
      {
        item_status: 'open',
        closed_at: null,
        assigned_to: USER_A,
        command_revision: 2,
        head_status: 'open',
        cycle_number: 2,
        state_revision: 2,
        opened_reason: 'manual_reopen',
        manual_reopen_reason: 'other',
        manual_reopen_explanation: 'A new guest message needs a response.',
        opened_by: USER_B,
        cycle_count: 2,
        fact_count: 1,
      },
    ])
  })

  it('bulk reopen reports a stale row and records a fact only for the landed CAS', async () => {
    const first = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000026'),
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000016'),
      platform: null,
      status: 'closed',
      closedAt: NOW,
    })
    const second = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000027'),
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000017'),
      platform: null,
      status: 'closed',
      closedAt: NOW,
    })
    const store = createAtomicInboxCommandStore(db)
    for (const item of [first, second]) {
      await store.createItem(item, null, {
        sourceRevision: 1,
        openedReason: 'legacy_backfill',
        actorType: 'system',
        triggerEventId: null,
        openedAt: NOW,
      })
    }

    // Represents a writer that won after the client loaded revision 1 while
    // preserving the same visible status.
    await pool.query(`UPDATE inbox_items SET command_revision = 2 WHERE id = $1`, [
      second.id,
    ])
    const events = [first, second].map((item) =>
      inboxItemBulkStatusChanged({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        oldStatus: 'closed',
        newStatus: 'open',
        bulkId: 'bulk-stale-row',
        userId: USER_A,
        occurredAt: NOW,
      }),
    )

    const result = await store.bulkUpdateStatus([first, second], events, {
      reason: 'new_information',
      explanation: null,
    })

    expect(result).toEqual({
      updated: 1,
      results: [
        { inboxItemId: first.id, outcome: 'reopened' },
        { inboxItemId: second.id, outcome: 'revision_conflict' },
      ],
    })
    const rows = await pool.query(
      `SELECT id, status, command_revision::text
       FROM inbox_items WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[first.id, second.id]],
    )
    expect(rows.rows).toEqual([
      { id: first.id, status: 'open', command_revision: '2' },
      { id: second.id, status: 'closed', command_revision: '2' },
    ])
    const facts = await pool.query(
      `SELECT payload->>'inboxItemId' AS inbox_item_id
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.inbox_item.bulk_status_changed'`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([{ inbox_item_id: first.id }])
  })

  it('closes a bulk reopen with one fact naming only the cycles it reopened', async () => {
    const [landed, stale] = [
      '4d000000-0000-0000-0000-00000000002a',
      '4d000000-0000-0000-0000-00000000002b',
    ].map((id, index) =>
      makeItem({
        id: inboxItemId(id),
        sourceType: 'feedback',
        sourceId: feedbackId(`4d000000-0000-0000-0000-00000000001${index + 6}`),
        platform: null,
        status: 'closed',
        closedAt: NOW,
      }),
    ) as [InboxItem, InboxItem]
    const store = createAtomicInboxCommandStore(db)
    for (const item of [landed, stale]) {
      await store.createItem(item, null, {
        sourceRevision: 1,
        openedReason: 'legacy_backfill',
        actorType: 'system',
        triggerEventId: null,
        openedAt: NOW,
      })
    }
    await pool.query(`UPDATE inbox_items SET command_revision = 2 WHERE id = $1`, [
      stale.id,
    ])
    const bulkId = '4d000000-0000-4000-8000-0000000000b1'

    await store.bulkUpdateStatus(
      [landed, stale],
      [landed, stale].map((item) =>
        inboxItemBulkStatusChanged({
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          oldStatus: 'closed',
          newStatus: 'open',
          bulkId,
          userId: USER_A,
          occurredAt: NOW,
        }),
      ),
      { reason: 'new_information', explanation: null },
    )

    const head = await pool.query(
      `SELECT current_cycle_number::int AS "cycleNumber",
              current_source_revision::int AS "sourceRevision",
              state_revision::int AS "stateRevision"
       FROM inbox_handling_cycle_heads WHERE inbox_item_id = $1`,
      [landed.id],
    )
    const completed = await pool.query(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.inbox_items.bulk_reopen_completed'`,
      [ORG_A],
    )
    expect(completed.rows).toEqual([
      {
        payload: expect.objectContaining({
          userId: USER_A,
          bulkId,
          count: 1,
          reopened: [
            {
              inboxItemId: landed.id,
              propertyId: landed.propertyId,
              sourceType: 'feedback',
              sourceId: landed.sourceId,
              ...head.rows[0],
            },
          ],
        }),
      },
    ])
    const reopened = await pool.query(
      `SELECT payload->>'inboxItemId' AS "inboxItemId", payload->>'bulkId' AS "bulkId"
       FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.handling_cycle.reopened'`,
      [ORG_A],
    )
    expect(reopened.rows).toEqual([{ inboxItemId: landed.id, bulkId }])
  })

  it('serializes opposite-order bulk reopen batches without a row-lock cycle', async () => {
    const reviewRepo = testReviewRepository(db)
    const firstReviewId = reviewId('4d000000-0000-0000-0000-000000000018')
    const secondReviewId = reviewId('4d000000-0000-0000-0000-000000000019')
    await reviewRepo.upsert(
      makeReview({ id: firstReviewId, sourceRevision: 1, analysisSequence: 1 }),
      NOW,
      'd'.repeat(64),
    )
    await reviewRepo.upsert(
      makeReview({ id: secondReviewId, sourceRevision: 1, analysisSequence: 1 }),
      NOW,
      'e'.repeat(64),
    )
    const first = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000028'),
      sourceId: firstReviewId,
      status: 'closed',
      closedAt: NOW,
    })
    const second = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000029'),
      sourceId: secondReviewId,
      status: 'closed',
      closedAt: NOW,
    })
    const store = createAtomicInboxCommandStore(db)
    await store.createItem(first, null, reviewOpeningAnchor(first))
    await store.createItem(second, null, reviewOpeningAnchor(second))
    const command = (items: readonly InboxItem[], bulkId: string) =>
      store.bulkUpdateStatus(
        items,
        items.map((item) =>
          inboxItemBulkStatusChanged({
            inboxItemId: item.id,
            organizationId: item.organizationId,
            propertyId: item.propertyId,
            oldStatus: 'closed',
            newStatus: 'open',
            bulkId,
            userId: USER_A,
            occurredAt: NOW,
          }),
        ),
        { reason: 'new_information', explanation: null },
      )

    const [forward, reverse] = await Promise.all([
      command([first, second], 'bulk-forward'),
      command([second, first], 'bulk-reverse'),
    ])

    expect(forward.updated + reverse.updated).toBe(2)
    expect(forward.results.map((result) => result.inboxItemId)).toEqual([
      first.id,
      second.id,
    ])
    expect(reverse.results.map((result) => result.inboxItemId)).toEqual([
      second.id,
      first.id,
    ])
    const rows = await pool.query(
      `SELECT item.id, item.status, item.command_revision::int,
              head.status AS head_status,
              head.current_cycle_number::int AS cycle_number,
              head.state_revision::int AS state_revision,
              cycle.opened_reason,
              cycle.manual_reopen_reason
       FROM inbox_items item
       JOIN inbox_handling_cycle_heads head ON head.inbox_item_id = item.id
       JOIN inbox_handling_cycles cycle
         ON cycle.inbox_item_id = head.inbox_item_id
        AND cycle.cycle_number = head.current_cycle_number
       WHERE item.id = ANY($1::uuid[]) ORDER BY item.id`,
      [[first.id, second.id]],
    )
    expect(rows.rows).toEqual([
      {
        id: first.id,
        status: 'open',
        command_revision: 2,
        head_status: 'open',
        cycle_number: 2,
        state_revision: 2,
        opened_reason: 'manual_reopen',
        manual_reopen_reason: 'new_information',
      },
      {
        id: second.id,
        status: 'open',
        command_revision: 2,
        head_status: 'open',
        cycle_number: 2,
        state_revision: 2,
        opened_reason: 'manual_reopen',
        manual_reopen_reason: 'new_information',
      },
    ])
    const facts = await pool.query(
      `SELECT payload->>'inboxItemId' AS inbox_item_id
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.inbox_item.bulk_status_changed'
       ORDER BY payload->>'inboxItemId'`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([
      { inbox_item_id: first.id },
      { inbox_item_id: second.id },
    ])
  })
})
