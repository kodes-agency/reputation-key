// Response Target reminders — time travel, not slot creation.
//
// Creating two reminder rows proves scheduling arithmetic. It does not prove
// that the scheduler seam releases them at the right moment, that finishing the
// work silences them, or that a released reminder cannot re-arm itself. Those
// are time-dependent facts, so this file drives the real use case
// (`releaseDueResponseTargetReminders`) through a mutable fake clock and walks
// it across every boundary: before halfway, exactly halfway, between, exactly
// the target, and far past it.
//
// The endless-loop assertion matters most. A reminder job that re-selects a
// delivered slot bills the tenant an alert every five minutes forever, and the
// symptom in production is indistinguishable from a busy Inbox.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'

import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { guestFeedbackRetracted } from '#/contexts/guest/domain/events'
import { propertyArchived, propertyRestored } from '#/contexts/property/domain/events'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createConsumerRegistry, type ConsumerEvent } from '#/shared/outbox'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildInboxContext, type InboxContextBuildInput } from '../build'
import type { ReviewLookupPort } from '../application/ports/review-lookup.port'
import { releaseDueResponseTargetReminders } from '../application/use-cases/release-response-target-reminders'
import type { InboxItem } from '../domain/types'
import { inboxItemStatusChanged } from '../domain/events'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createFeedbackHandlingStore } from './feedback-handling.store'
import { createResponseTargetStore } from './response-target.store'

const ORG = organizationId('org-reminder-time-travel-000000001')
const PROPERTY = propertyId('6c000000-0000-4000-8000-000000000001')
const ITEM = inboxItemId('6c000000-0000-4000-8000-000000000002')
const FEEDBACK = feedbackId('6c000000-0000-4000-8000-000000000003')
const PORTAL = portalId('6c000000-0000-4000-8000-000000000004')
const MANAGER = userId('user-reminder-time-travel-000001')

/** Four hours, so halfway and target are both exact and far apart. */
const DURATION_MINUTES = 240
const OPENED_AT = new Date('2026-08-27T08:00:00.000Z')
const BEFORE_HALFWAY = new Date('2026-08-27T09:59:59.999Z')
const HALFWAY = new Date('2026-08-27T10:00:00.000Z')
const BETWEEN = new Date('2026-08-27T11:00:00.000Z')
const BEFORE_TARGET = new Date('2026-08-27T11:59:59.999Z')
const TARGET = new Date('2026-08-27T12:00:00.000Z')
const WELL_PAST_TARGET = new Date('2026-09-27T12:00:00.000Z')

const db = getDb()
let pool: Pool

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({ allowed: true })

const commandStore = (database: Database) =>
  createProductionInboxCommandStore(database, allowAllCommandAuthority, () => OPENED_AT)

const makeItem = (): InboxItem => ({
  id: ITEM,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceType: 'feedback',
  sourceId: FEEDBACK,
  status: 'open',
  rating: 2,
  sourceDate: OPENED_AT,
  platform: null,
  snippet: 'Private feedback',
  reviewerName: null,
  propertyName: null,
  assignedTo: null,
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: OPENED_AT,
  updatedAt: OPENED_AT,
})

/**
 * The production scheduler seam: a job with no arguments that asks the clock
 * what time it is. Advancing `travel` is the only way this test moves time,
 * which is exactly the coupling the hosted scheduler has.
 */
function createTimeTraveller() {
  let current = OPENED_AT
  const releaseDue = releaseDueResponseTargetReminders({
    targetStore: createResponseTargetStore(db),
    clock: () => current,
  })
  return {
    travelTo: (at: Date) => {
      current = at
    },
    tick: () => releaseDue(),
    now: () => current,
  }
}

/**
 * The durable consumers Inbox's worker registers, reading the traveller's
 * clock. Only consumer registration is exercised, so foreign sources stay
 * unimplemented.
 */
function inboxWorkerConsumers(clock: () => Date) {
  const registry = createConsumerRegistry()
  buildInboxContext({
    db,
    clock,
    idGen: () => crypto.randomUUID(),
    staffPublicApi: {} as StaffPublicApi,
    reviewLookup: {} as ReviewLookupPort,
    sources: {
      feedback: {},
      property: {},
      reply: {},
      review: {},
      replyObservationAuthority: {},
      responseTargetAuthority: {},
      sourceTransitionAuthority: {},
    } as InboxContextBuildInput['sources'],
    logger: createMockLogger(),
    authorizeCommand: async () => ({ allowed: true }),
  }).worker.registerOutboxConsumers(registry)
  return registry
}

/**
 * Resolves 'waiting' once a backend is blocked reading the Property row under
 * a lock, or 'gave_up' when `stop` reports the delivery already settled.
 */
async function waitForPropertyLockWait(
  stop: () => boolean,
): Promise<'waiting' | 'gave_up'> {
  for (;;) {
    const waiting = await pool.query(
      `SELECT 1
       FROM pg_stat_activity
       WHERE wait_event_type = 'Lock'
         AND query ILIKE '%from "properties"%for share%'`,
    )
    if (waiting.rowCount === 1) return 'waiting'
    if (stop()) return 'gave_up'
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Record a Property lifecycle fact and return it as the dispatcher delivers it. */
async function recordLifecycleFact(
  fact: ReturnType<typeof propertyArchived> | ReturnType<typeof propertyRestored>,
): Promise<ConsumerEvent> {
  const row = toOutboxEvent(fact)
  await createOutboxRepository(db).insert({ ...row, id: fact.eventId })
  return {
    eventId: fact.eventId,
    eventType: fact._tag,
    eventVersion: 1,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceContext: 'property',
    sourceAggregateId: PROPERTY,
    occurredAt: fact.occurredAt.toISOString(),
    payload: row.payload,
  }
}

/**
 * Commit the Property's lifecycle state the way its lifecycle command does,
 * then hand the content-free fact to every Inbox consumer registered for it,
 * as the durable dispatcher would.
 */
async function transitionProperty(
  scheduler: ReturnType<typeof createTimeTraveller>,
  to: 'archived' | 'active',
): Promise<void> {
  const { rows } = await pool.query<{ source_epoch: number }>(
    `UPDATE properties
        SET lifecycle_state = $2, source_epoch = source_epoch + 1
      WHERE id = $1
      RETURNING source_epoch`,
    [PROPERTY, to],
  )
  const scope = {
    organizationId: ORG,
    propertyId: PROPERTY,
    userId: MANAGER,
    sourceEpoch: rows[0].source_epoch,
    occurredAt: scheduler.now(),
  }
  const event = await recordLifecycleFact(
    to === 'archived'
      ? propertyArchived({
          ...scope,
          previousState: 'active',
          recoveryDeadline: WELL_PAST_TARGET,
        })
      : propertyRestored({
          ...scope,
          previousState: 'archived',
          googleBindingReadiness: 'ready',
        }),
  )
  for (const consumer of inboxWorkerConsumers(scheduler.now).listFor(event.eventType)) {
    await consumer.handler(event)
  }
}

async function clean(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query(
    'DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seed(): Promise<InboxItem> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Reminder time travel', $2, NOW())`,
    [ORG, `reminder-time-travel-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Reminder property', $3, 'UTC', 0, NOW(), NOW())`,
    [PROPERTY, ORG, `reminder-time-travel-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO inbox_response_target_organization_policies (
       organization_id, target_kind, duration_minutes, policy_version,
       updated_by, created_at, updated_at
     ) VALUES ($1, 'private_feedback_handling', $2, 5, $3, $4, $4)`,
    [ORG, DURATION_MINUTES, MANAGER, OPENED_AT],
  )
  const item = makeItem()
  await commandStore(db).createItem(item, null, {
    sourceRevision: 1,
    openedReason: 'feedback_submitted',
    actorType: 'guest',
    triggerEventId: null,
    openedAt: OPENED_AT,
  })
  return item
}

type ReminderRow = Readonly<{
  reminder_kind: string
  scheduled_for: Date
  delivered_at: Date | null
  cancelled_at: Date | null
}>

const reminderRows = async (): Promise<ReminderRow[]> =>
  (
    await pool.query<ReminderRow>(
      `SELECT reminder_kind, scheduled_for, delivered_at, cancelled_at
       FROM inbox_response_target_reminders
       WHERE inbox_item_id = $1 ORDER BY scheduled_for`,
      [ITEM],
    )
  ).rows

const releasedFactKinds = async (): Promise<string[]> =>
  (
    await pool.query<{ reminder_kind: string }>(
      `SELECT payload->>'reminderKind' AS reminder_kind
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.response_target.reminder_due'
       ORDER BY payload->>'scheduledFor'`,
      [ORG],
    )
  ).rows.map((row) => row.reminder_kind)

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
  const client = await pool.connect()
  client.release()
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await clean()
  clearEventSchemas()
  await pool.end()
})

beforeEach(async () => {
  await clean()
})

describe.sequential('Response Target reminder time travel (PostgreSQL)', () => {
  it('releases nothing before a boundary, exactly one fact at each boundary, and never re-arms', async () => {
    await seed()
    const scheduler = createTimeTraveller()

    expect(await reminderRows()).toEqual([
      {
        reminder_kind: 'halfway',
        scheduled_for: HALFWAY,
        delivered_at: null,
        cancelled_at: null,
      },
      {
        reminder_kind: 'target_passed',
        scheduled_for: TARGET,
        delivered_at: null,
        cancelled_at: null,
      },
    ])

    // A slot that exists is not a slot that is due.
    scheduler.travelTo(OPENED_AT)
    await expect(scheduler.tick()).resolves.toEqual({ released: 0 })
    scheduler.travelTo(BEFORE_HALFWAY)
    await expect(scheduler.tick()).resolves.toEqual({ released: 0 })

    scheduler.travelTo(HALFWAY)
    await expect(scheduler.tick()).resolves.toEqual({ released: 1 })
    await expect(scheduler.tick()).resolves.toEqual({ released: 0 })

    scheduler.travelTo(BETWEEN)
    await expect(scheduler.tick()).resolves.toEqual({ released: 0 })
    scheduler.travelTo(BEFORE_TARGET)
    await expect(scheduler.tick()).resolves.toEqual({ released: 0 })

    scheduler.travelTo(TARGET)
    await expect(scheduler.tick()).resolves.toEqual({ released: 1 })

    // No endless loop: a month of ticks past the target releases nothing more.
    scheduler.travelTo(WELL_PAST_TARGET)
    for (let tick = 0; tick < 5; tick += 1) {
      await expect(scheduler.tick()).resolves.toEqual({ released: 0 })
    }

    expect(await releasedFactKinds()).toEqual(['halfway', 'target_passed'])
    expect(await reminderRows()).toEqual([
      {
        reminder_kind: 'halfway',
        scheduled_for: HALFWAY,
        delivered_at: HALFWAY,
        cancelled_at: null,
      },
      {
        reminder_kind: 'target_passed',
        scheduled_for: TARGET,
        delivered_at: TARGET,
        cancelled_at: null,
      },
    ])
  })

  it('cancels the remaining slot the moment the work is marked as handled', async () => {
    const item = await seed()
    const scheduler = createTimeTraveller()

    scheduler.travelTo(HALFWAY)
    await expect(scheduler.tick()).resolves.toEqual({ released: 1 })

    await createFeedbackHandlingStore(db, allowAllCommandAuthority).markHandled({
      item,
      outcomeId: '6c000000-0000-4000-8000-000000000010',
      outcome: 'follow_up_completed',
      internalNote: null,
      actorUserId: MANAGER,
      recordedAt: BETWEEN,
      expected: {
        commandRevision: 1,
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 1,
      },
    })

    scheduler.travelTo(TARGET)
    await expect(scheduler.tick()).resolves.toEqual({ released: 0 })
    scheduler.travelTo(WELL_PAST_TARGET)
    await expect(scheduler.tick()).resolves.toEqual({ released: 0 })

    expect(await releasedFactKinds()).toEqual(['halfway'])
    expect(await reminderRows()).toEqual([
      {
        reminder_kind: 'halfway',
        scheduled_for: HALFWAY,
        delivered_at: HALFWAY,
        cancelled_at: null,
      },
      {
        reminder_kind: 'target_passed',
        scheduled_for: TARGET,
        delivered_at: null,
        cancelled_at: BETWEEN,
      },
    ])
  })

  it('cancels every slot on guest withdrawal and excludes the cycle from performance', async () => {
    const item = await seed()
    const scheduler = createTimeTraveller()

    const source = guestFeedbackRetracted({
      feedbackId: FEEDBACK,
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      supersedesSourceEventId: crypto.randomUUID(),
      occurredAt: BEFORE_HALFWAY,
    })
    await createOutboxRepository(db).insert({
      ...toOutboxEvent(source),
      id: source.eventId,
    })
    await commandStore(db).applySourceWithdrawnOnce({
      eventId: source.eventId,
      consumerName: 'inbox.reminder-time-travel.withdrawal',
      item,
      sourceRevision: 1,
      now: BEFORE_HALFWAY,
      fact: inboxItemStatusChanged({
        inboxItemId: ITEM,
        organizationId: ORG,
        propertyId: PROPERTY,
        oldStatus: 'open',
        newStatus: 'closed',
        occurredAt: BEFORE_HALFWAY,
      }),
    })

    for (const at of [HALFWAY, BETWEEN, TARGET, WELL_PAST_TARGET]) {
      scheduler.travelTo(at)
      await expect(scheduler.tick()).resolves.toEqual({ released: 0 })
    }

    expect(await releasedFactKinds()).toEqual([])
    expect(await reminderRows()).toEqual([
      {
        reminder_kind: 'halfway',
        scheduled_for: HALFWAY,
        delivered_at: null,
        cancelled_at: BEFORE_HALFWAY,
      },
      {
        reminder_kind: 'target_passed',
        scheduled_for: TARGET,
        delivered_at: null,
        cancelled_at: BEFORE_HALFWAY,
      },
    ])
    await expect(
      createResponseTargetStore(db).getPrivateFeedbackAnalytics({
        organizationId: ORG,
        propertyIds: null,
        now: WELL_PAST_TARGET,
      }),
    ).resolves.toMatchObject({
      activeCount: 0,
      currentOverdueCount: 0,
      handledOnTimeCount: 0,
      handledLateCount: 0,
      averageTimeToFirstHandlingMinutes: null,
    })
  })

  it('cancels every pending slot when the Property is archived, and Restore does not re-arm them', async () => {
    await seed()
    const scheduler = createTimeTraveller()

    scheduler.travelTo(BEFORE_HALFWAY)
    await transitionProperty(scheduler, 'archived')
    for (const at of [HALFWAY, BETWEEN]) {
      scheduler.travelTo(at)
      await expect(scheduler.tick()).resolves.toEqual({ released: 0 })
    }
    await transitionProperty(scheduler, 'active')
    for (const at of [TARGET, WELL_PAST_TARGET]) {
      scheduler.travelTo(at)
      await expect(scheduler.tick()).resolves.toEqual({ released: 0 })
    }

    expect(await releasedFactKinds()).toEqual([])
    expect(await reminderRows()).toEqual([
      {
        reminder_kind: 'halfway',
        scheduled_for: HALFWAY,
        delivered_at: null,
        cancelled_at: BEFORE_HALFWAY,
      },
      {
        reminder_kind: 'target_passed',
        scheduled_for: TARGET,
        delivered_at: null,
        cancelled_at: BEFORE_HALFWAY,
      },
    ])
  })

  it('leaves a released reminder delivered and cancels only what is still pending', async () => {
    await seed()
    const scheduler = createTimeTraveller()

    scheduler.travelTo(HALFWAY)
    await expect(scheduler.tick()).resolves.toEqual({ released: 1 })
    scheduler.travelTo(BETWEEN)
    await transitionProperty(scheduler, 'archived')
    scheduler.travelTo(WELL_PAST_TARGET)
    await expect(scheduler.tick()).resolves.toEqual({ released: 0 })

    expect(await releasedFactKinds()).toEqual(['halfway'])
    expect(await reminderRows()).toEqual([
      {
        reminder_kind: 'halfway',
        scheduled_for: HALFWAY,
        delivered_at: HALFWAY,
        cancelled_at: null,
      },
      {
        reminder_kind: 'target_passed',
        scheduled_for: TARGET,
        delivered_at: null,
        cancelled_at: BETWEEN,
      },
    ])
  })

  // A Restore racing the delivery: the consumer must decide on the state the
  // Restore commits, not on the archived row it could read before, or it
  // cancels the slots of a Property that is active again.
  it('waits for a Restore in flight and then cancels nothing', async () => {
    await seed()
    const scheduler = createTimeTraveller()
    scheduler.travelTo(BEFORE_HALFWAY)
    await pool.query(
      `UPDATE properties SET lifecycle_state = 'archived', source_epoch = 1 WHERE id = $1`,
      [PROPERTY],
    )
    const archive = await recordLifecycleFact(
      propertyArchived({
        organizationId: ORG,
        propertyId: PROPERTY,
        userId: MANAGER,
        previousState: 'active',
        sourceEpoch: 1,
        recoveryDeadline: WELL_PAST_TARGET,
        occurredAt: BEFORE_HALFWAY,
      }),
    )
    const restore = await pool.connect()
    try {
      await restore.query('BEGIN')
      await restore.query(
        `UPDATE properties SET lifecycle_state = 'active', source_epoch = 2 WHERE id = $1`,
        [PROPERTY],
      )
      const [consumer] = inboxWorkerConsumers(scheduler.now).listFor('property.archived')
      let settled = false
      const delivery = consumer!.handler(archive).finally(() => {
        settled = true
      })

      const first = await Promise.race([
        delivery.then(() => 'delivered' as const),
        waitForPropertyLockWait(() => settled),
      ])
      await restore.query('COMMIT')

      expect(first).toBe('waiting')
      await expect(delivery).resolves.toEqual({ status: 'obsolete' })
    } finally {
      await restore.query('ROLLBACK').catch(() => undefined)
      restore.release()
    }

    scheduler.travelTo(HALFWAY)
    await expect(scheduler.tick()).resolves.toEqual({ released: 1 })
    expect(await releasedFactKinds()).toEqual(['halfway'])
  })

  it('ignores an archive fact delivered after the Property was restored', async () => {
    await seed()
    const scheduler = createTimeTraveller()

    // Archived and restored again before the dispatcher delivered the fact.
    scheduler.travelTo(BEFORE_HALFWAY)
    const lateArchive = await recordLifecycleFact(
      propertyArchived({
        organizationId: ORG,
        propertyId: PROPERTY,
        userId: MANAGER,
        previousState: 'active',
        sourceEpoch: 1,
        recoveryDeadline: WELL_PAST_TARGET,
        occurredAt: OPENED_AT,
      }),
    )
    const consumers = inboxWorkerConsumers(scheduler.now).listFor('property.archived')
    expect(consumers).toHaveLength(1)
    await expect(consumers[0].handler(lateArchive)).resolves.toEqual({
      status: 'obsolete',
    })

    scheduler.travelTo(HALFWAY)
    await expect(scheduler.tick()).resolves.toEqual({ released: 1 })
    expect(await releasedFactKinds()).toEqual(['halfway'])
  })
})
