import { reviewOpeningAnchor } from './review-opening-anchor.test-fixtures'
import { describe, it, expect } from 'vitest'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {} from '#/shared/domain/ids'
import type {} from '#/contexts/reputation/domain/review-types'
import { inboxItemStatusChanged } from '#/contexts/reputation/domain/inbox-events'
import {
  reviewExpired,
  reviewSourceTransitioned,
} from '#/contexts/reputation/domain/review-events'
import { guestFeedbackRetracted } from '#/contexts/guest/domain/events'
import { testReviewRepository } from '#/contexts/reputation/reviews/review-stores.test-fixtures'
import {
  ORG_A,
  ORG_B,
  PROP_A,
  PROP_C,
  USER_A,
  REVIEW_A,
  ITEM_A,
  ITEM_B,
  FEEDBACK_A,
  FEEDBACK_B,
  PORTAL_A,
  NOW,
  createAtomicInboxCommandStore,
  db,
  makeItem,
  makeReview,
  insertSourceEvent,
  seedReviewRevisionOne,
  pool,
  useInboxCommandStoreDb,
} from './inbox-command-store.test-fixtures'

useInboxCommandStoreDb()

describe.sequential('inboxCommandStore applyOnce (integration)', () => {
  it('closes a Review projection once on source expiry while preserving identity, assignment and notes', async () => {
    await seedReviewRevisionOne()
    const legacy = makeItem({
      assignedTo: USER_A,
      commandRevision: Number.MAX_SAFE_INTEGER,
    })
    const store = createAtomicInboxCommandStore(db)
    await store.createItem(legacy, null, reviewOpeningAnchor(legacy))
    const noteId = '4d000000-0000-0000-0000-000000000099'
    await pool.query(
      `INSERT INTO inbox_notes (
           id, inbox_item_id, organization_id, author_user_id, text, created_at
         ) VALUES ($1, $2, $3, $4, 'Manager-owned history', $5)`,
      [noteId, legacy.id, ORG_A, USER_A, NOW],
    )

    const source = reviewSourceTransitioned({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      sourceEpoch: 1,
      sourceRevision: 2,
      analysisSequence: 2,
      change: 'source_expired',
      occurredAt: NOW,
    })
    await insertSourceEvent(source)
    const command = {
      eventId: source.eventId,
      consumerName: 'inbox.on-review-source-transitioned',
      item: legacy,
      transitionedAt: NOW,
      closeIfOpen: true,
      closeFact: inboxItemStatusChanged({
        inboxItemId: legacy.id,
        organizationId: legacy.organizationId,
        propertyId: legacy.propertyId,
        oldStatus: 'open',
        newStatus: 'closed',
        occurredAt: NOW,
      }),
    } as const
    await expect(store.applyReviewSourceTransitionedOnce(command)).resolves.toBe(
      'applied',
    )
    await expect(store.applyReviewSourceTransitionedOnce(command)).resolves.toBe(
      'applied',
    )

    const proof = await pool.query(
      `SELECT
           item.id,
           item.source_id,
           item.status,
           item.assigned_to,
           item.command_revision::text AS command_revision,
           (SELECT count(*)::int FROM inbox_notes note
            WHERE note.inbox_item_id = item.id) AS note_count,
           (SELECT count(*)::int FROM event_consumer_receipts receipt
            WHERE receipt.event_id = $2
              AND receipt.consumer_name = 'inbox.on-review-source-transitioned')
             AS receipt_count,
           (SELECT count(*)::int FROM outbox_events fact
            WHERE fact.organization_id = $3
              AND fact.event_type = 'inbox.inbox_item.status_changed'
              AND fact.payload->>'inboxItemId' = item.id::text) AS status_fact_count
         FROM inbox_items item
         WHERE item.id = $1`,
      [legacy.id, source.eventId, ORG_A],
    )
    expect(proof.rows).toEqual([
      {
        id: legacy.id,
        source_id: REVIEW_A,
        status: 'closed',
        assigned_to: USER_A,
        command_revision: String(Number.MAX_SAFE_INTEGER),
        note_count: 1,
        receipt_count: 1,
        status_fact_count: 1,
      },
    ])
  })

  it('expiry replay without closeIfOpen leaves the open item and Handling Cycle untouched', async () => {
    const reviewRepo = testReviewRepository(db)
    await reviewRepo.upsert(
      makeReview({ sourceRevision: 1, analysisSequence: 1 }),
      NOW,
      'b'.repeat(64),
    )
    const legacy = makeItem({
      assignedTo: USER_A,
      commandRevision: Number.MAX_SAFE_INTEGER,
    })
    const store = createAtomicInboxCommandStore(db)
    await store.createItem(legacy, null, reviewOpeningAnchor(legacy))
    const noteId = '4d000000-0000-0000-0000-000000000098'
    await pool.query(
      `INSERT INTO inbox_notes (
           id, inbox_item_id, organization_id, author_user_id, text, created_at
         ) VALUES ($1, $2, $3, $4, 'Current manager history', $5)`,
      [noteId, legacy.id, ORG_A, USER_A, NOW],
    )

    const source = reviewExpired({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      occurredAt: new Date('2026-06-01T12:05:00.000Z'),
    })
    await insertSourceEvent(source)
    const command = {
      eventId: source.eventId,
      consumerName: 'inbox.on-review-expired',
      item: legacy,
      transitionedAt: source.occurredAt,
      closeIfOpen: false,
      closeFact: inboxItemStatusChanged({
        inboxItemId: legacy.id,
        organizationId: legacy.organizationId,
        propertyId: legacy.propertyId,
        oldStatus: 'open',
        newStatus: 'closed',
        occurredAt: source.occurredAt,
      }),
    } as const

    await expect(store.applyReviewSourceTransitionedOnce(command)).resolves.toBe(
      'applied',
    )
    await expect(store.applyReviewSourceTransitionedOnce(command)).resolves.toBe(
      'applied',
    )

    const proof = await pool.query(
      `SELECT
           item.id,
           item.source_id,
           item.status AS item_status,
           head.status AS cycle_status,
           head.current_cycle_number::int AS cycle_number,
           item.assigned_to,
           item.command_revision::text AS command_revision,
           (SELECT count(*)::int FROM inbox_notes note
            WHERE note.inbox_item_id = item.id) AS note_count,
           (SELECT count(*)::int FROM event_consumer_receipts receipt
            WHERE receipt.event_id = $2
              AND receipt.consumer_name = 'inbox.on-review-expired') AS receipt_count,
           (SELECT count(*)::int FROM outbox_events fact
            WHERE fact.organization_id = $3
              AND fact.event_type = 'inbox.inbox_item.status_changed'
              AND fact.payload->>'inboxItemId' = item.id::text) AS status_fact_count
         FROM inbox_items item
         JOIN inbox_handling_cycle_heads head ON head.inbox_item_id = item.id
         WHERE item.id = $1`,
      [legacy.id, source.eventId, ORG_A],
    )
    expect(proof.rows).toEqual([
      {
        id: legacy.id,
        source_id: REVIEW_A,
        item_status: 'open',
        cycle_status: 'open',
        cycle_number: 1,
        assigned_to: USER_A,
        command_revision: String(Number.MAX_SAFE_INTEGER),
        note_count: 1,
        receipt_count: 1,
        status_fact_count: 0,
      },
    ])
  })

  it('applySourceWithdrawnOnce closes feedback work with fact + receipt atomically', async () => {
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem({
      sourceType: 'feedback',
      sourceId: FEEDBACK_A,
      platform: null,
    })
    await store.createItem(item, null, {
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: null,
      openedAt: NOW,
    })
    const source = guestFeedbackRetracted({
      feedbackId: FEEDBACK_A,
      organizationId: ORG_A,
      propertyId: PROP_A,
      portalId: PORTAL_A,
      supersedesSourceEventId: crypto.randomUUID(),
      occurredAt: NOW,
    })
    await insertSourceEvent(source)
    const fact = inboxItemStatusChanged({
      inboxItemId: ITEM_A,
      organizationId: ORG_A,
      propertyId: PROP_A,
      oldStatus: 'open',
      newStatus: 'closed',
      occurredAt: NOW,
    })

    await expect(
      store.applySourceWithdrawnOnce({
        eventId: source.eventId,
        consumerName: 'inbox.on-guest-feedback-retracted',
        item,
        sourceRevision: 1,
        now: NOW,
        fact,
      }),
    ).resolves.toBe('applied')

    const rows = await pool.query(
      'SELECT status, closed_at FROM inbox_items WHERE id = $1',
      [ITEM_A],
    )
    expect(rows.rows).toEqual([{ status: 'closed', closed_at: NOW }])
    const facts = await pool.query(`SELECT id FROM outbox_events WHERE id = $1`, [
      fact.eventId,
    ])
    expect(facts.rows).toHaveLength(1)
    const receipts = await pool.query(
      `SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1`,
      [source.eventId],
    )
    expect(receipts.rows).toEqual([
      { consumer_name: 'inbox.on-guest-feedback-retracted', status: 'applied' },
    ])
    const lifecycle = await pool.query(
      `SELECT state_revision::int, cycle_number::int, kind, transition_reason,
              actor_type
       FROM inbox_handling_cycle_transitions
       WHERE inbox_item_id = $1
       ORDER BY state_revision`,
      [ITEM_A],
    )
    expect(lifecycle.rows).toEqual([
      {
        state_revision: 1,
        cycle_number: 1,
        kind: 'opened',
        transition_reason: 'feedback_submitted',
        actor_type: 'guest',
      },
      {
        state_revision: 2,
        cycle_number: 1,
        kind: 'closed',
        transition_reason: 'guest_withdrawn',
        actor_type: 'guest',
      },
    ])
  })

  // The head is found by its source identity before the source revision is
  // compared: a withdrawal for another source is obsolete, never a revision
  // conflict, and a stale revision for the right source leaves the cycle open.
  describe.each([
    ['another source', FEEDBACK_B, 1],
    ['a stale source revision', FEEDBACK_A, 2],
  ] as const)(
    'applySourceWithdrawnOnce for %s',
    (_label, withdrawnSourceId, revision) => {
      it('settles the delivery as obsolete and leaves the open cycle untouched', async () => {
        const store = createAtomicInboxCommandStore(db)
        const item = makeItem({
          sourceType: 'feedback',
          sourceId: FEEDBACK_A,
          platform: null,
        })
        await store.createItem(item, null, {
          sourceRevision: 1,
          openedReason: 'feedback_submitted',
          actorType: 'guest',
          triggerEventId: null,
          openedAt: NOW,
        })
        const source = guestFeedbackRetracted({
          feedbackId: withdrawnSourceId,
          organizationId: ORG_A,
          propertyId: PROP_A,
          portalId: PORTAL_A,
          supersedesSourceEventId: crypto.randomUUID(),
          occurredAt: NOW,
        })
        await insertSourceEvent(source)
        const fact = inboxItemStatusChanged({
          inboxItemId: ITEM_A,
          organizationId: ORG_A,
          propertyId: PROP_A,
          oldStatus: 'open',
          newStatus: 'closed',
          occurredAt: NOW,
        })

        await expect(
          store.applySourceWithdrawnOnce({
            eventId: source.eventId,
            consumerName: 'inbox.on-guest-feedback-retracted',
            item: { ...item, sourceId: withdrawnSourceId },
            sourceRevision: revision,
            now: NOW,
            fact,
          }),
        ).resolves.toBe('obsolete')

        const rows = await pool.query(
          'SELECT status, command_revision::int AS command_revision FROM inbox_items WHERE id = $1',
          [ITEM_A],
        )
        expect(rows.rows).toEqual([{ status: 'open', command_revision: 1 }])
        const facts = await pool.query(`SELECT id FROM outbox_events WHERE id = $1`, [
          fact.eventId,
        ])
        expect(facts.rows).toHaveLength(0)
      })
    },
  )

  it('applySourceWithdrawnOnce closes the item from its own cycle and settles a drifted head mirror', async () => {
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem({
      sourceType: 'feedback',
      sourceId: FEEDBACK_A,
      platform: null,
    })
    await store.createItem(item, null, {
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: null,
      openedAt: NOW,
    })
    await pool.query(
      `UPDATE inbox_handling_cycle_heads SET status = 'closed' WHERE inbox_item_id = $1`,
      [item.id],
    )
    const source = guestFeedbackRetracted({
      feedbackId: FEEDBACK_A,
      organizationId: ORG_A,
      propertyId: PROP_A,
      portalId: PORTAL_A,
      supersedesSourceEventId: crypto.randomUUID(),
      occurredAt: NOW,
    })
    await insertSourceEvent(source)
    const fact = inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      oldStatus: 'open',
      newStatus: 'closed',
      occurredAt: NOW,
    })

    await expect(
      store.applySourceWithdrawnOnce({
        eventId: source.eventId,
        consumerName: 'inbox.on-guest-feedback-retracted',
        item,
        sourceRevision: 1,
        now: NOW,
        fact,
      }),
    ).resolves.toBe('applied')

    const proof = await pool.query(
      `SELECT item.status AS item_status, item.closed_at,
              head.status AS head_status, head.state_revision::int,
              (SELECT count(*)::int FROM outbox_events WHERE id = $2) AS fact_count,
              (SELECT count(*)::int FROM event_consumer_receipts
               WHERE event_id = $3
                 AND consumer_name = 'inbox.on-guest-feedback-retracted') AS receipt_count
       FROM inbox_items item
       JOIN inbox_handling_cycle_heads head ON head.inbox_item_id = item.id
       WHERE item.id = $1`,
      [item.id, fact.eventId, source.eventId],
    )
    expect(proof.rows).toEqual([
      {
        item_status: 'closed',
        closed_at: NOW,
        head_status: 'closed',
        state_revision: 2,
        fact_count: 1,
        receipt_count: 1,
      },
    ])
  })

  it('isolates the same feedback source identity and lifecycle by tenant', async () => {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Other Inbox Cycle Org', 'other-inbox-cycle-org', NOW())`,
      [ORG_B],
    )
    await pool.query(
      `INSERT INTO properties (
         id, organization_id, name, slug, timezone, created_at, updated_at
       ) VALUES ($1, $2, 'Other Cycle Property', 'other-cycle-property',
                 'UTC', NOW(), NOW())`,
      [PROP_C, ORG_B],
    )
    try {
      const store = createAtomicInboxCommandStore(db)
      const first = makeItem({
        sourceType: 'feedback',
        sourceId: FEEDBACK_A,
        platform: null,
      })
      const second = makeItem({
        id: ITEM_B,
        organizationId: ORG_B,
        propertyId: PROP_C,
        sourceType: 'feedback',
        sourceId: FEEDBACK_A,
        platform: null,
      })
      const anchor = {
        sourceRevision: 1,
        openedReason: 'feedback_submitted' as const,
        actorType: 'guest' as const,
        triggerEventId: null,
        openedAt: NOW,
      }
      await store.createItem(first, null, anchor)
      await store.createItem(second, null, anchor)

      const source = guestFeedbackRetracted({
        feedbackId: FEEDBACK_A,
        organizationId: ORG_A,
        propertyId: PROP_A,
        portalId: PORTAL_A,
        supersedesSourceEventId: crypto.randomUUID(),
        occurredAt: NOW,
      })
      await insertSourceEvent(source)
      await store.applySourceWithdrawnOnce({
        eventId: source.eventId,
        consumerName: 'inbox.on-guest-feedback-retracted',
        item: first,
        sourceRevision: 1,
        now: NOW,
        fact: inboxItemStatusChanged({
          inboxItemId: first.id,
          organizationId: first.organizationId,
          propertyId: first.propertyId,
          oldStatus: 'open',
          newStatus: 'closed',
          occurredAt: NOW,
        }),
      })

      const heads = await pool.query(
        `SELECT organization_id, inbox_item_id::text, status, state_revision::int
         FROM inbox_handling_cycle_heads
         WHERE source_type = 'feedback' AND source_id = $1
         ORDER BY organization_id`,
        [FEEDBACK_A],
      )
      expect(heads.rows).toEqual([
        {
          organization_id: ORG_A,
          inbox_item_id: ITEM_A,
          status: 'closed',
          state_revision: 2,
        },
        {
          organization_id: ORG_B,
          inbox_item_id: ITEM_B,
          status: 'open',
          state_revision: 1,
        },
      ])
      const otherTransitions = await pool.query(
        `SELECT kind, transition_reason
         FROM inbox_handling_cycle_transitions
         WHERE inbox_item_id = $1 ORDER BY state_revision`,
        [ITEM_B],
      )
      expect(otherTransitions.rows).toEqual([
        { kind: 'opened', transition_reason: 'feedback_submitted' },
      ])
    } finally {
      await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG_B])
      await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG_B])
      await deleteTestOrganizations(pool, [ORG_B])
    }
  })
})
