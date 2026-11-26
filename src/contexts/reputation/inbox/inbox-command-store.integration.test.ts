// Inbox command store + rebuild integration tests (real Postgres).
//
// Crash-boundary proofs on the real database:
//   1. applySourceCreatedOnce commits item + created fact + receipt in ONE
//      transaction; a forced outbox failure (unregistered fact type) or a
//      forced receipt failure (missing source event row → FK violation)
//      rolls back EVERYTHING — no item row survives.
//   2. Duplicate delivery: exactly one item, one fact, receipt present.
//   3. legacy review.expired: source-content scrub + receipt are atomic and
//      replay-safe without changing current workflow status.
//   4. rebuildInboxProjection heals a corrupted projection from canonical
//      review/reply data; dryRun writes nothing.

import { reviewOpeningAnchor } from './review-opening-anchor.test-fixtures'
import { describe, it, expect } from 'vitest'
import { inboxItemId } from '#/shared/domain/ids'
import type {} from '#/contexts/reputation/domain/review-types'
import { reviewCreated, reviewUpdated } from '#/contexts/reputation/domain/review-events'
import { createReviewResponseTargetAuthority } from '#/contexts/reputation/reviews/response-target-authority.server'
import { testReviewRepository } from '#/contexts/reputation/reviews/review-stores.test-fixtures'
import {
  ORG_A,
  ORG_B,
  PROP_A,
  PROP_C,
  REVIEW_A,
  ITEM_A,
  NOW,
  CONSUMER,
  createAtomicInboxCommandStore,
  db,
  makeItem,
  makeReview,
  insertSourceEvent,
  seedReviewRevisionOne,
  createdFact,
  pool,
  useInboxCommandStoreDb,
} from './inbox-command-store.test-fixtures'

useInboxCommandStoreDb()

describe.sequential('inboxCommandStore applyOnce (integration)', () => {
  it('applySourceCreatedOnce commits item + fact + receipt in one transaction', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: NOW,
    })
    await insertSourceEvent(source)

    const item = makeItem()
    const fact = createdFact(item)
    const outcome = await store.applySourceCreatedOnce({
      eventId: source.eventId,
      consumerName: CONSUMER,
      item,
      fact,
      cycleAnchor: { ...reviewOpeningAnchor(item), triggerEventId: source.eventId },
    })

    expect(outcome).toBe('applied')
    const items = await pool.query(
      'SELECT * FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(1)
    const facts = await pool.query(
      `SELECT id, event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.created'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(1)
    expect(facts.rows[0].id).toBe(fact.eventId)
    const receipts = await pool.query(
      `SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1`,
      [source.eventId],
    )
    expect(receipts.rows).toEqual([{ consumer_name: CONSUMER, status: 'applied' }])
  })

  // The receipt key is the fence between a delivery and a fact that supersedes
  // it (a guest withdrawing the feedback a submission carried): the create
  // reserves the key before it creates anything, and the superseding fact
  // settles the delivery under the same key, so exactly one of them wins.
  const submittedSource = async () => {
    await seedReviewRevisionOne()
    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: NOW,
    })
    await insertSourceEvent(source)
    return source
  }
  const receiptsOf = async (eventId: string) =>
    (
      await pool.query(
        `SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1`,
        [eventId],
      )
    ).rows

  it('applySourceCreatedOnce creates nothing for a delivery a superseding fact already settled', async () => {
    const source = await submittedSource()
    const store = createAtomicInboxCommandStore(db)
    await store.settleSupersededDelivery(source.eventId, CONSUMER, ORG_A)

    const item = makeItem()
    const outcome = await store.applySourceCreatedOnce({
      eventId: source.eventId,
      consumerName: CONSUMER,
      item,
      fact: createdFact(item),
      cycleAnchor: { ...reviewOpeningAnchor(item), triggerEventId: source.eventId },
    })

    expect(outcome).toBe('duplicate')
    const created = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM inbox_items WHERE organization_id = $1) AS items,
         (SELECT count(*)::int FROM outbox_events
           WHERE organization_id = $1
             AND event_type = 'inbox.inbox_item.created') AS facts`,
      [ORG_A],
    )
    expect(created.rows).toEqual([{ items: 0, facts: 0 }])
    expect(await receiptsOf(source.eventId)).toEqual([
      { consumer_name: CONSUMER, status: 'obsolete' },
    ])
  })

  it('settleSupersededDelivery waits for an apply that holds the receipt key, then leaves its receipt', async () => {
    const source = await submittedSource()
    const store = createAtomicInboxCommandStore(db)
    let settled = false
    const applying = await pool.connect()
    const openApply = async () => {
      try {
        await applying.query('BEGIN')
        // What an apply transaction does first.
        await applying.query(
          `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
           VALUES ($1, $2, 'applied')`,
          [source.eventId, CONSUMER],
        )
        const settling = store
          .settleSupersededDelivery(source.eventId, CONSUMER, ORG_A)
          .then(() => {
            settled = true
          })
        await applying.query('SELECT pg_sleep(0.2)')
        const settledWhileApplyWasOpen = settled
        await applying.query('COMMIT')
        return { settling, settledWhileApplyWasOpen }
      } finally {
        applying.release()
      }
    }

    const observed = await openApply()
    await observed.settling

    expect(observed.settledWhileApplyWasOpen).toBe(false)
    expect(await receiptsOf(source.eventId)).toEqual([
      { consumer_name: CONSUMER, status: 'applied' },
    ])
  })

  it('settleSupersededDelivery records nothing for an event that is no longer stored', async () => {
    const store = createAtomicInboxCommandStore(db)
    const purgedEventId = crypto.randomUUID()

    await store.settleSupersededDelivery(purgedEventId, CONSUMER, ORG_A)

    expect(await receiptsOf(purgedEventId)).toEqual([])
  })

  // The superseding fact names the delivery by event id, and that id is only
  // payload. A wrong one must not silence another Organization's delivery.
  it('settleSupersededDelivery records nothing for an event stored for another Organization', async () => {
    const store = createAtomicInboxCommandStore(db)
    const otherOrganizationSource = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_C,
      organizationId: ORG_B,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: NOW,
    })
    await insertSourceEvent(otherOrganizationSource)
    try {
      await store.settleSupersededDelivery(
        otherOrganizationSource.eventId,
        CONSUMER,
        ORG_A,
      )

      expect(await receiptsOf(otherOrganizationSource.eventId)).toEqual([])
    } finally {
      await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_B])
    }
  })

  it('rolls back the item insert when the fact insert fails (unregistered type)', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: NOW,
    })
    await insertSourceEvent(source)

    const ghost = {
      ...createdFact(makeItem()),
      _tag: 'inbox.inbox_item.ghost',
    } as unknown as Parameters<typeof store.applySourceCreatedOnce>[0]['fact']

    await expect(
      store.applySourceCreatedOnce({
        eventId: source.eventId,
        consumerName: CONSUMER,
        item: makeItem(),
        fact: ghost,
        cycleAnchor: {
          ...reviewOpeningAnchor(makeItem()),
          triggerEventId: source.eventId,
        },
      }),
    ).rejects.toThrow(
      /Event type inbox\.inbox_item\.ghost:v1 is not registered for the outbox/,
    )

    const items = await pool.query(
      'SELECT id FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(0)
    const receipts = await pool.query(
      'SELECT event_id FROM event_consumer_receipts WHERE event_id = $1',
      [source.eventId],
    )
    expect(receipts.rows).toHaveLength(0)
  })

  it('rolls back item + fact when the receipt insert fails (source event row missing)', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    // No source outbox row — the receipt FK to outbox_events.id fails inside
    // the transaction, proving state+fact+receipt are one commit.
    const ghostEventId = crypto.randomUUID()

    await expect(
      store.applySourceCreatedOnce({
        eventId: ghostEventId,
        consumerName: CONSUMER,
        item: makeItem(),
        fact: createdFact(makeItem()),
        cycleAnchor: { ...reviewOpeningAnchor(makeItem()), triggerEventId: ghostEventId },
      }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        /insert or update on table "event_consumer_receipts" violates foreign key constraint/.test(
          e.cause.message,
        ),
    )

    const items = await pool.query(
      'SELECT id FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(0)
    const facts = await pool.query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.created'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it('duplicate delivery: exactly one item, one fact, receipt present', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: NOW,
    })
    await insertSourceEvent(source)

    const item = makeItem()
    const first = await store.applySourceCreatedOnce({
      eventId: source.eventId,
      consumerName: CONSUMER,
      item,
      fact: createdFact(item),
      cycleAnchor: { ...reviewOpeningAnchor(item), triggerEventId: source.eventId },
    })
    // Same delivered event again (replay after the receipt pre-check raced).
    const second = await store.applySourceCreatedOnce({
      eventId: source.eventId,
      consumerName: CONSUMER,
      item: makeItem({ id: inboxItemId(crypto.randomUUID()) }),
      fact: createdFact(item),
      cycleAnchor: {
        ...reviewOpeningAnchor(makeItem({ id: inboxItemId(crypto.randomUUID()) })),
        triggerEventId: source.eventId,
      },
    })

    expect(first).toBe('applied')
    expect(second).toBe('duplicate')
    const items = await pool.query(
      'SELECT id FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(1)
    const facts = await pool.query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.created'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(1)
    const receipts = await pool.query(
      'SELECT event_id FROM event_consumer_receipts WHERE event_id = $1',
      [source.eventId],
    )
    expect(receipts.rows).toHaveLength(1)
  })

  it('co-commits a genuine material Review cycle and makes replay inert', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db)
    const item = makeItem()
    await store.createItem(item, reviewOpeningAnchor(item))

    await testReviewRepository(db).upsert(
      makeReview({
        sourceRevision: 2,
        analysisSequence: 2,
        text: 'Materially revised review',
        updatedAt: new Date(NOW.getTime() + 1_000),
      }),
      new Date(NOW.getTime() + 1_000),
      '2'.repeat(64),
    )
    const source = reviewUpdated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 2,
      analysisSequence: 2,
      occurredAt: new Date(NOW.getTime() + 1_000),
    })
    await insertSourceEvent(source)

    const apply = () =>
      createReviewResponseTargetAuthority(db).withInboxProjection(
        {
          organizationId: ORG_A,
          propertyId: PROP_A,
          reviewId: REVIEW_A,
          sourceEpoch: 0,
          eventSourceRevision: 2,
          eventKind: 'updated',
        },
        (projection) =>
          store.applyReviewProjectionOnce({
            eventId: source.eventId,
            consumerName: 'inbox.on-review-updated',
            eventKind: 'updated',
            item,
            fact: createdFact(item),
            projection,
            now: source.occurredAt,
          }),
      )
    await expect(apply()).resolves.toMatchObject({ status: 'current', value: 'applied' })
    await expect(apply()).resolves.toMatchObject({
      status: 'current',
      value: 'duplicate',
    })

    const lifecycle = await pool.query(
      `SELECT state_revision::int, cycle_number::int, kind, transition_reason,
              source_revision::int, trigger_event_id::text
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
        transition_reason: 'review_observed',
        source_revision: 1,
        trigger_event_id: null,
      },
      {
        state_revision: 2,
        cycle_number: 1,
        kind: 'closed',
        transition_reason: 'superseded_by_source_revision',
        source_revision: 1,
        trigger_event_id: null,
      },
      {
        state_revision: 3,
        cycle_number: 2,
        kind: 'opened',
        transition_reason: 'material_revision_changed',
        source_revision: 2,
        trigger_event_id: null,
      },
    ])
    const facts = await pool.query<{
      event_type: string
      payload: Record<string, unknown>
    }>(
      `SELECT event_type, payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type IN (
           'inbox.handling_cycle.closed',
           'inbox.handling_cycle.opened'
         )
       ORDER BY payload->>'stateRevision'`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([
      expect.objectContaining({
        event_type: 'inbox.handling_cycle.closed',
        payload: expect.objectContaining({
          cycleNumber: 1,
          stateRevision: 2,
          closeReason: 'superseded_by_source_revision',
          sourceRevision: 1,
          triggerEventId: null,
        }),
      }),
      expect.objectContaining({
        event_type: 'inbox.handling_cycle.opened',
        payload: expect.objectContaining({
          cycleNumber: 2,
          stateRevision: 3,
          openReason: 'material_revision_changed',
          sourceRevision: 2,
          triggerEventId: null,
        }),
      }),
    ])
    const receipt = await pool.query(
      `SELECT count(*)::int AS count
       FROM event_consumer_receipts
       WHERE event_id = $1 AND consumer_name = 'inbox.on-review-updated'`,
      [source.eventId],
    )
    expect(receipt.rows).toEqual([{ count: 1 }])
  })
})
