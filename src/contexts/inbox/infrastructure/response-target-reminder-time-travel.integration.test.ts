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
import type { EventBus } from '#/shared/events/event-bus'
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

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({ allowed: true })

const commandStore = (database: Database) =>
  createProductionInboxCommandStore(
    database,
    silentEvents,
    allowAllCommandAuthority,
    () => OPENED_AT,
  )

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
    targetStore: createResponseTargetStore(db, silentEvents),
    clock: () => current,
  })
  return {
    travelTo: (at: Date) => {
      current = at
    },
    tick: () => releaseDue(),
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

    await createFeedbackHandlingStore(
      db,
      silentEvents,
      allowAllCommandAuthority,
    ).markHandled({
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
      createResponseTargetStore(db, silentEvents).getPrivateFeedbackAnalytics({
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
})
