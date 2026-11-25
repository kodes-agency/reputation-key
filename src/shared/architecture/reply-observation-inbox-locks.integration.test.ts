import { describe, expect, it } from 'vitest'
import { handleInboxReplyObserved } from '#/contexts/reputation/inbox/outbox-consumers.server'
import { createReviewHandlingCycleStore } from '#/contexts/reputation/inbox/review-handling-cycle-store.server'
import { createReviewReplyObservationAuthority } from '#/contexts/reputation/reviews/reply-observation-authority.server'
import { openNextReviewCycleForTest } from '#/contexts/reputation/inbox/review-cycle-reopen.test-fixtures'
import { getDb } from '#/shared/db'
import {
  useReplyObservationSuite,
  createAtomicInboxCommandStore,
  ORG,
  ITEM,
  MANUAL_REOPEN_ACTOR,
  OBSERVED_AT,
  EVENT_LIVE,
  responseTargetPermit,
  EVENT_LOCK_ORDER,
  seed,
  insertObservation,
  seedDeliveryEvent,
  expectation,
  observedEvent,
  consumerDeps,
  command,
  applyObservation,
  observation,
  waitForInboxRowWaiters,
  waitForAdvisoryWaiter,
  startNewerObservationWriter,
} from '#/contexts/reputation/inbox/reply-observation-inbox.test-fixtures'

describe.sequential('Inbox provider-observation authority (real PostgreSQL)', () => {
  const suite = useReplyObservationSuite()
  const live = observation()

  it('holds the Review writer fence until the Inbox callback commits', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    const store = createAtomicInboxCommandStore(getDb())
    const authority = createReviewReplyObservationAuthority(getDb())
    let callbackEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      callbackEntered = resolve
    })
    let allowInboxCommit!: () => void
    const inboxCommitAllowed = new Promise<void>((resolve) => {
      allowInboxCommit = resolve
    })
    const authorityResult = authority.withExactCurrent(
      expectation(live),
      async (permit) => {
        callbackEntered()
        await inboxCommitAllowed
        return store.applyReplyObservedOnce(command(item, EVENT_LIVE, permit))
      },
    )
    await entered

    const newerWriter = startNewerObservationWriter()

    await waitForAdvisoryWaiter()
    expect(newerWriter.settled()).toBe(false)

    allowInboxCommit()
    await expect(authorityResult).resolves.toEqual({
      status: 'current',
      value: 'applied',
    })
    await expect(newerWriter.result).resolves.toMatchObject({
      observationRevision: 2,
      resolution: 'external_current_live',
    })
    const committed = await suite.pool.query(
      `SELECT i.status, h.observation_revision
       FROM inbox_items i
       JOIN google_reply_observation_heads h ON h.review_id = i.source_id
       WHERE i.id = $1`,
      [ITEM],
    )
    expect(committed.rows[0]).toMatchObject({
      status: 'closed',
      observation_revision: '2',
    })
  })

  it('commits the Inbox write in the Review transaction, so the fence outlives it', async () => {
    await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    const deps = consumerDeps()
    let applied!: () => void
    const appliedInbox = new Promise<void>((resolve) => {
      applied = resolve
    })
    let allowReturn!: () => void
    const returnAllowed = new Promise<void>((resolve) => {
      allowReturn = resolve
    })
    const consumer = handleInboxReplyObserved(
      {
        ...deps,
        commandStore: {
          ...deps.commandStore,
          applyReplyObservedOnce: async (cmd, tx) => {
            const outcome = await deps.commandStore.applyReplyObservedOnce(cmd, tx)
            applied()
            await returnAllowed
            return outcome
          },
        },
      },
      observedEvent(EVENT_LIVE, live),
    )
    await appliedInbox

    const newerWriter = startNewerObservationWriter()
    await waitForAdvisoryWaiter()

    // The Inbox command has run, yet nothing it wrote is visible: it shares
    // Review's still-open transaction instead of committing on its own.
    const outside = await suite.pool.query(
      `SELECT i.status,
              (SELECT count(*)::int FROM event_consumer_receipts
               WHERE event_id = $2 AND consumer_name = 'inbox.on-reply-observed') AS receipts
       FROM inbox_items i WHERE i.id = $1`,
      [ITEM, EVENT_LIVE],
    )
    expect(outside.rows[0]).toMatchObject({ status: 'open', receipts: 0 })
    expect(newerWriter.settled()).toBe(false)

    allowReturn()
    await expect(consumer).resolves.toEqual({ status: 'applied' })
    await expect(newerWriter.result).resolves.toMatchObject({ observationRevision: 2 })
    const committed = await suite.pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_LIVE],
    )
    expect(committed.rows[0]).toMatchObject({
      status: 'closed',
      receipt_status: 'applied',
    })
  })

  it('takes the one Inbox row lock on the lent transaction without deadlocking', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')

    const newerLive = observation({ revision: 2, change: 'edited' })
    await insertObservation(newerLive)
    await seedDeliveryEvent(EVENT_LOCK_ORDER)

    const cycleStore = createReviewHandlingCycleStore(getDb())
    const closedHead = await cycleStore.findHead(ITEM, ORG)
    if (closedHead === null) throw new Error('seeded Handling Cycle is missing')

    const blocker = await suite.pool.connect()
    let blockerOpen = false
    let reopen: ReturnType<typeof openNextReviewCycleForTest> | null = null
    let observedClose: ReturnType<typeof handleInboxReplyObserved> | null = null
    try {
      await blocker.query('BEGIN')
      blockerOpen = true
      await blocker.query(
        `SELECT id
         FROM inbox_items
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [ITEM, ORG],
      )
      reopen = openNextReviewCycleForTest(getDb(), {
        inboxItemId: ITEM,
        organizationId: ORG,
        materialReviewRevision: 1,
        openedReason: 'manual_reopen',
        manualReopenReason: 'internal_follow_up_still_needed',
        manualReopenExplanation: null,
        openedBy: MANUAL_REOPEN_ACTOR,
        openedAt: OBSERVED_AT,
        responseTarget: responseTargetPermit(1),
      })
      await waitForInboxRowWaiters(1)
      observedClose = handleInboxReplyObserved(
        consumerDeps(),
        observedEvent(EVENT_LOCK_ORDER, newerLive),
      )
      await waitForInboxRowWaiters(2)

      await blocker.query('COMMIT')
      blockerOpen = false
      await expect(Promise.all([reopen, observedClose])).resolves.toMatchObject([
        { head: { currentCycleNumber: 2, status: 'open' } },
        { status: 'applied' },
      ])
    } finally {
      if (blockerOpen) await blocker.query('ROLLBACK')
      blocker.release()
      await Promise.allSettled([
        ...(reopen ? [reopen] : []),
        ...(observedClose ? [observedClose] : []),
      ])
    }

    const current = await suite.pool.query(
      `SELECT i.status, i.current_cycle_number,
              r.status AS receipt_status
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_LOCK_ORDER],
    )
    expect(current.rows[0]).toMatchObject({
      status: 'closed',
      current_cycle_number: '2',
      receipt_status: 'applied',
    })
  })

  it('serializes a manual cycle reopen before an observed close without deadlocking', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')

    const newerLive = observation({ revision: 2, change: 'edited' })
    await insertObservation(newerLive)
    await seedDeliveryEvent(EVENT_LOCK_ORDER)

    const cycleStore = createReviewHandlingCycleStore(getDb())
    const closedHead = await cycleStore.findHead(ITEM, ORG)
    if (closedHead === null) throw new Error('seeded Handling Cycle is missing')

    // Hold the shared first lock so both public command paths queue in a known
    // order. Once released, the reopen must take the row and commit;
    // the observed close then takes the same row and closes that new cycle.
    const blocker = await suite.pool.connect()
    let blockerOpen = false
    let reopen: ReturnType<typeof openNextReviewCycleForTest> | null = null
    let observedClose: Promise<'applied' | 'obsolete'> | null = null
    try {
      await blocker.query('BEGIN')
      blockerOpen = true
      await blocker.query(
        `SELECT id
         FROM inbox_items
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [ITEM, ORG],
      )

      reopen = openNextReviewCycleForTest(getDb(), {
        inboxItemId: ITEM,
        organizationId: ORG,
        materialReviewRevision: 1,
        openedReason: 'manual_reopen',
        manualReopenReason: 'internal_follow_up_still_needed',
        manualReopenExplanation: null,
        openedBy: MANUAL_REOPEN_ACTOR,
        openedAt: OBSERVED_AT,
        responseTarget: responseTargetPermit(1),
      })
      await waitForInboxRowWaiters(1)

      observedClose = applyObservation(item, EVENT_LOCK_ORDER, newerLive)
      await waitForInboxRowWaiters(2)

      await blocker.query('COMMIT')
      blockerOpen = false
      await expect(Promise.all([reopen, observedClose])).resolves.toMatchObject([
        { head: { currentCycleNumber: 2, status: 'open' } },
        'applied',
      ])
    } finally {
      if (blockerOpen) await blocker.query('ROLLBACK')
      blocker.release()
      await Promise.allSettled([
        ...(reopen ? [reopen] : []),
        ...(observedClose ? [observedClose] : []),
      ])
    }

    const current = await suite.pool.query(
      `SELECT i.status, i.current_cycle_number,
              i.state_revision, c.opened_reason, c.manual_reopen_reason,
              c.opened_by, r.status AS receipt_status
       FROM inbox_items i
       JOIN inbox_handling_cycles c
         ON c.inbox_item_id = i.id
        AND c.cycle_number = i.current_cycle_number
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_LOCK_ORDER],
    )
    expect(current.rows[0]).toMatchObject({
      status: 'closed',
      current_cycle_number: '2',
      state_revision: '4',
      opened_reason: 'manual_reopen',
      manual_reopen_reason: 'internal_follow_up_still_needed',
      opened_by: MANUAL_REOPEN_ACTOR,
      receipt_status: 'applied',
    })
  })
})
