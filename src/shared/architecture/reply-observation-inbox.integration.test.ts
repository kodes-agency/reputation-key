import { reviewOpeningAnchor } from '#/contexts/reputation/inbox/review-opening-anchor.test-fixtures'
import { describe, expect, it } from 'vitest'
import {
  replyScopeEffects,
  eraseReviewSourceContent,
} from '#/contexts/reputation/public-api'
import { handleInboxReplyObserved } from '#/contexts/reputation/inbox/outbox-consumers.server'
import { getDb } from '#/shared/db'
import {
  useReplyObservationSuite,
  ORG,
  PROPERTY,
  REVIEW,
  ITEM,
  OBSERVED_AT,
  EVENT_LIVE,
  EVENT_DELETED,
  EVENT_EXTERNAL_EDITED,
  EVENT_STALE,
  EVENT_AHEAD,
  EVENT_OLDER,
  EVENT_REVIEW_ADVANCED,
  EVENT_LEGACY_DIVERGED,
  EVENT_INACTIVE_DELETED,
  EVENT_EPOCH_CARRY,
  EVENT_EPOCH_MATERIAL_CHANGE,
  seed,
  insertObservation,
  insertMaterialRevision,
  advanceMaterialRevisionToEpochOne,
  seedDeliveryEvent,
  observedEvent,
  consumerDeps,
  applyObservation,
  observation,
  openMaterialRevisionCycle,
} from '#/contexts/reputation/inbox/reply-observation-inbox.test-fixtures'

describe.sequential('Inbox provider-observation authority (real PostgreSQL)', () => {
  const suite = useReplyObservationSuite()
  const live = observation()

  it('closes once from the exact current live observation and a replay cannot re-close', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')
    const closed = await suite.pool.query(
      `SELECT status, closed_at, first_reply_published_at
       FROM inbox_items WHERE id = $1`,
      [ITEM],
    )
    expect(closed.rows[0]).toMatchObject({
      status: 'closed',
      closed_at: OBSERVED_AT,
      first_reply_published_at: OBSERVED_AT,
    })

    const deleted = observation({
      revision: 2,
      state: 'absent',
      change: 'deleted',
      resolution: 'absent',
      provenance: 'none',
    })
    await insertObservation(deleted)
    await seedDeliveryEvent(EVENT_DELETED)
    expect(await applyObservation(item, EVENT_DELETED, deleted)).toBe('applied')

    const reopened = await suite.pool.query(
      `SELECT status, closed_at, first_reply_published_at
       FROM inbox_items WHERE id = $1`,
      [ITEM],
    )
    expect(reopened.rows[0]).toMatchObject({
      status: 'open',
      closed_at: null,
      first_reply_published_at: OBSERVED_AT,
    })
    const cycles = await suite.pool.query(
      `SELECT cycle_number, opened_reason
       FROM inbox_handling_cycles WHERE inbox_item_id = $1 ORDER BY cycle_number`,
      [ITEM],
    )
    expect(cycles.rows).toMatchObject([
      { cycle_number: '1', opened_reason: 'review_observed' },
      { cycle_number: '2', opened_reason: 'provider_reply_deleted' },
    ])
    const facts = await suite.pool.query(
      `SELECT count(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.status_changed'`,
      [ORG],
    )
    expect(facts.rows[0].n).toBe(2)
  })

  it('keeps work closed when the current external live reply is edited', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    await applyObservation(item, EVENT_LIVE, live)

    const externalEdit = observation({ revision: 2, change: 'edited' })
    await insertObservation(externalEdit)
    await seedDeliveryEvent(EVENT_EXTERNAL_EDITED)
    expect(await applyObservation(item, EVENT_EXTERNAL_EDITED, externalEdit)).toBe(
      'applied',
    )

    const current = await suite.pool.query(
      `SELECT i.status, i.current_cycle_number, c.opened_reason,
              (SELECT count(*)::int
               FROM outbox_events e
               WHERE e.organization_id = i.organization_id
                 AND e.event_type = 'inbox.inbox_item.status_changed') AS status_fact_count
       FROM inbox_items i
       JOIN inbox_handling_cycles c
         ON c.inbox_item_id = i.id
        AND c.cycle_number = i.current_cycle_number
       WHERE i.id = $1`,
      [ITEM],
    )
    expect(current.rows[0]).toMatchObject({
      status: 'closed',
      current_cycle_number: '1',
      opened_reason: 'review_observed',
      status_fact_count: 1,
    })
  })

  it('applies an epoch-carried reply observation without reopening closed work', async () => {
    await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    await expect(
      handleInboxReplyObserved(consumerDeps(), observedEvent(EVENT_LIVE, live)),
    ).resolves.toEqual({ status: 'applied' })

    await advanceMaterialRevisionToEpochOne('1'.repeat(64), 'review text')
    const carried = observation({
      revision: 2,
      sourceEpoch: 1,
      materialReviewRevision: 2,
    })
    await insertObservation(carried)
    await seedDeliveryEvent(EVENT_EPOCH_CARRY)

    await expect(
      handleInboxReplyObserved(consumerDeps(), observedEvent(EVENT_EPOCH_CARRY, carried)),
    ).resolves.toEqual({ status: 'applied' })

    const current = await suite.pool.query(
      `SELECT i.status, i.current_cycle_number,
              i.current_source_revision,
              i.state_revision,
              r.status AS receipt_status,
              (SELECT count(*)::int
               FROM inbox_handling_cycles c
               WHERE c.inbox_item_id = i.id) AS cycle_count,
              (SELECT count(*)::int
               FROM outbox_events e
               WHERE e.organization_id = i.organization_id
                 AND e.event_type = 'inbox.inbox_item.status_changed') AS status_fact_count
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_EPOCH_CARRY],
    )
    expect(current.rows[0]).toMatchObject({
      status: 'closed',
      current_cycle_number: '1',
      current_source_revision: '2',
      state_revision: '2',
      receipt_status: 'applied',
      cycle_count: 1,
      status_fact_count: 1,
    })
  })

  it('refuses an epoch-crossing material change while its Inbox projection is stale', async () => {
    await seed()
    await advanceMaterialRevisionToEpochOne('2'.repeat(64), 'changed review text')
    const changed = observation({
      revision: 2,
      sourceEpoch: 1,
      materialReviewRevision: 2,
    })
    await insertObservation(changed)
    await seedDeliveryEvent(EVENT_EPOCH_MATERIAL_CHANGE)

    await expect(
      handleInboxReplyObserved(
        consumerDeps(),
        observedEvent(EVENT_EPOCH_MATERIAL_CHANGE, changed),
      ),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      message: 'Current reply observation is waiting for the Inbox material revision',
    })

    const current = await suite.pool.query(
      `SELECT i.status, i.current_source_revision,
              r.status AS receipt_status
       FROM inbox_items i
       LEFT JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_EPOCH_MATERIAL_CHANGE],
    )
    expect(current.rows[0]).toMatchObject({
      status: 'open',
      current_source_revision: '1',
      receipt_status: null,
    })
  })

  it('receipts a retained legacy live divergence without reopening work', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')

    const legacyDiverged = observation({
      revision: 2,
      change: 'edited',
      resolution: 'diverged',
    })
    await insertObservation(legacyDiverged)
    await seedDeliveryEvent(EVENT_LEGACY_DIVERGED)
    expect(await applyObservation(item, EVENT_LEGACY_DIVERGED, legacyDiverged)).toBe(
      'applied',
    )

    const result = await suite.pool.query(
      `SELECT i.status, i.current_cycle_number, r.status AS receipt_status,
              (SELECT count(*)::int
               FROM outbox_events e
               WHERE e.organization_id = i.organization_id
                 AND e.event_type = 'inbox.inbox_item.status_changed') AS status_fact_count
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_LEGACY_DIVERGED],
    )
    expect(result.rows[0]).toMatchObject({
      status: 'closed',
      current_cycle_number: '1',
      receipt_status: 'applied',
      status_fact_count: 1,
    })
  })

  it('marks a delayed non-head observation obsolete without changing Inbox', async () => {
    const item = await seed()
    await insertObservation(live)
    const newer = observation({ revision: 2, change: 'edited', resolution: 'diverged' })
    await insertObservation(newer)
    await seedDeliveryEvent(EVENT_STALE)
    expect(await applyObservation(item, EVENT_STALE, live)).toBe('obsolete')
    const row = await suite.pool.query('SELECT status FROM inbox_items WHERE id = $1', [
      ITEM,
    ])
    expect(row.rows[0].status).toBe('open')
  })

  it('refuses a retained reply head after the current Review material revision advances', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_REVIEW_ADVANCED)
    await insertMaterialRevision(2)

    expect(await applyObservation(item, EVENT_REVIEW_ADVANCED, live)).toBe('obsolete')
    const result = await suite.pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_REVIEW_ADVANCED],
    )
    expect(result.rows[0]).toMatchObject({
      status: 'open',
      receipt_status: 'obsolete',
    })
  })

  it.each(['source_expired', 'provider_deleted'] as const)(
    'consumes and idempotently replays the identifier-only current head after %s erasure',
    async (erasedState) => {
      const item = await seed()
      await insertObservation(live)
      await seedDeliveryEvent(EVENT_LIVE)

      await getDb().transaction(async (tx) => {
        expect(
          await eraseReviewSourceContent(
            tx,
            {
              reviewId: REVIEW,
              organizationId: ORG,
              propertyId: PROPERTY,
              sourceEpoch: 0,
              expectedSourceRevision: 1,
              state: erasedState,
            },
            replyScopeEffects,
          ),
        ).toBe(true)
      })
      const redacted = await suite.pool.query(
        `SELECT content_state, content_erased_at, normalized_text, normalized_digest
       FROM google_reply_observations
       WHERE organization_id = $1 AND review_id = $2 AND observation_revision = 1`,
        [ORG, REVIEW],
      )
      expect(redacted.rows[0]).toMatchObject({
        content_state: erasedState,
        normalized_text: null,
        normalized_digest: null,
      })
      expect(redacted.rows[0].content_erased_at).toBeInstanceOf(Date)

      expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')
      expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')
      const inbox = await suite.pool.query(
        'SELECT status FROM inbox_items WHERE id = $1',
        [ITEM],
      )
      expect(inbox.rows[0].status).toBe('closed')
      const facts = await suite.pool.query(
        `SELECT count(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.status_changed'`,
        [ORG],
      )
      expect(facts.rows[0].n).toBe(1)
    },
  )

  it('does not reopen a closed item from a deleted-reply observation after the Review source becomes ineligible', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')

    const deleted = observation({
      revision: 2,
      state: 'absent',
      change: 'deleted',
      resolution: 'absent',
      provenance: 'none',
    })
    await insertObservation(deleted)
    await getDb().transaction(async (tx) => {
      expect(
        await eraseReviewSourceContent(
          tx,
          {
            reviewId: REVIEW,
            organizationId: ORG,
            propertyId: PROPERTY,
            sourceEpoch: 0,
            expectedSourceRevision: 1,
            state: 'provider_deleted',
          },
          replyScopeEffects,
        ),
      ).toBe(true)
    })
    await seedDeliveryEvent(EVENT_INACTIVE_DELETED)

    expect(await applyObservation(item, EVENT_INACTIVE_DELETED, deleted)).toBe('applied')
    const inbox = await suite.pool.query(
      `SELECT status, closed_at FROM inbox_items WHERE id = $1`,
      [ITEM],
    )
    expect(inbox.rows[0]).toMatchObject({ status: 'closed', closed_at: OBSERVED_AT })
    const cycles = await suite.pool.query(
      `SELECT count(*)::int AS n FROM inbox_handling_cycles WHERE inbox_item_id = $1`,
      [ITEM],
    )
    expect(cycles.rows[0].n).toBe(1)
  })

  it('retries an exact current observation until its earlier review.created is projected', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    await suite.pool.query('DELETE FROM inbox_items WHERE id = $1', [ITEM])
    const deps = consumerDeps()
    const event = observedEvent(EVENT_LIVE, live)

    await expect(handleInboxReplyObserved(deps, event)).rejects.toMatchObject({
      code: 'not_found',
    })
    const beforeProjection = await suite.pool.query(
      `SELECT status FROM event_consumer_receipts
       WHERE event_id = $1 AND consumer_name = 'inbox.on-reply-observed'`,
      [EVENT_LIVE],
    )
    expect(beforeProjection.rows).toEqual([])

    await deps.commandStore.createItem(item, reviewOpeningAnchor(item))
    await expect(handleInboxReplyObserved(deps, event)).resolves.toEqual({
      status: 'applied',
    })
    const afterReplay = await suite.pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_LIVE],
    )
    expect(afterReplay.rows[0]).toMatchObject({
      status: 'closed',
      receipt_status: 'applied',
    })
  })

  it('retries without a receipt until Inbox reaches the observation material revision', async () => {
    await seed()
    await insertMaterialRevision(2)
    const ahead = { ...live, materialReviewRevision: 2 }
    await insertObservation(ahead)
    await seedDeliveryEvent(EVENT_AHEAD)
    const deps = consumerDeps()
    const event = observedEvent(EVENT_AHEAD, ahead)

    await expect(handleInboxReplyObserved(deps, event)).rejects.toMatchObject({
      code: 'revision_conflict',
    })
    const beforeAdvance = await suite.pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       LEFT JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_AHEAD],
    )
    expect(beforeAdvance.rows[0]).toMatchObject({
      status: 'open',
      receipt_status: null,
    })

    await openMaterialRevisionCycle(deps, 2)

    await expect(handleInboxReplyObserved(deps, event)).resolves.toEqual({
      status: 'applied',
    })
    const afterAdvance = await suite.pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_AHEAD],
    )
    expect(afterAdvance.rows[0]).toMatchObject({
      status: 'closed',
      receipt_status: 'applied',
    })
  })

  it('receipts an exact current observation obsolete when Inbox is already newer', async () => {
    await seed()
    await insertObservation(live)
    await insertMaterialRevision(2)
    const deps = consumerDeps()
    await openMaterialRevisionCycle(deps, 2)
    await seedDeliveryEvent(EVENT_OLDER)

    await expect(
      handleInboxReplyObserved(deps, observedEvent(EVENT_OLDER, live)),
    ).resolves.toEqual({ status: 'obsolete' })
    const result = await suite.pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_OLDER],
    )
    expect(result.rows[0]).toMatchObject({
      status: 'open',
      receipt_status: 'obsolete',
    })
  })
})
