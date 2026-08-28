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
import type { InboxItem } from '../domain/types'
import { inboxItemStatusChanged } from '../domain/events'
import { isInboxError } from '../domain/errors'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createFeedbackHandlingStore } from './feedback-handling.store'

const ORG = organizationId('org-feedback-handling-000000000001')
const OTHER_ORG = organizationId('org-feedback-handling-000000000002')
const PROPERTY = propertyId('6a000000-0000-4000-8000-000000000001')
const ITEM = inboxItemId('6a000000-0000-4000-8000-000000000002')
const FEEDBACK = feedbackId('6a000000-0000-4000-8000-000000000003')
const PORTAL = portalId('6a000000-0000-4000-8000-000000000004')
const MANAGER = userId('user-feedback-handling-manager-0001')
const OPENED_AT = new Date('2026-08-27T08:00:00.000Z')
const COMPLETED_AT = new Date('2026-08-27T09:00:00.000Z')
const CORRECTED_AT = new Date('2026-08-27T10:00:00.000Z')

const db = getDb()
let pool: Pool

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})

const createAtomicInboxCommandStore = (database: Database) =>
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

async function clean(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seed(): Promise<InboxItem> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Feedback handling test', 'feedback-handling-test', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Handling property', 'handling-property', 'UTC', 0, NOW(), NOW())`,
    [PROPERTY, ORG],
  )
  const item = makeItem()
  await createAtomicInboxCommandStore(db).createItem(item, null, {
    sourceRevision: 1,
    openedReason: 'feedback_submitted',
    actorType: 'guest',
    triggerEventId: null,
    openedAt: OPENED_AT,
  })
  return item
}

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

describe.sequential('private-feedback handling store (PostgreSQL)', () => {
  it('closes with one outcome, appends corrections, and preserves completion facts', async () => {
    const item = await seed()
    const store = createFeedbackHandlingStore(db, silentEvents, allowAllCommandAuthority)

    await expect(store.getState(ITEM, OTHER_ORG)).resolves.toBeNull()
    await expect(store.getState(ITEM, ORG)).resolves.toMatchObject({
      cycleNumber: 1,
      sourceRevision: 1,
      stateRevision: 1,
      status: 'open',
      currentOutcome: null,
      history: [],
    })

    const handled = await store.markHandled({
      item,
      outcomeId: '6a000000-0000-4000-8000-000000000010',
      outcome: 'follow_up_attempted',
      internalNote: 'Called the guest once.',
      actorUserId: MANAGER,
      recordedAt: COMPLETED_AT,
      expected: {
        commandRevision: 1,
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 1,
      },
    })
    expect(handled.item).toMatchObject({
      status: 'closed',
      rating: 2,
      commandRevision: 2,
    })
    expect(handled.feedbackHandling.currentOutcome).toMatchObject({
      outcomeRevision: 1,
      outcome: 'follow_up_attempted',
      internalNote: 'Called the guest once.',
      completionAt: COMPLETED_AT,
      deadlineResult: 'on_time',
      supersedesOutcomeId: null,
    })

    const corrected = await store.correctOutcome({
      item: handled.item,
      outcomeId: '6a000000-0000-4000-8000-000000000011',
      outcome: 'follow_up_completed',
      internalNote: 'Guest reached later.',
      actorUserId: MANAGER,
      recordedAt: CORRECTED_AT,
      expected: {
        commandRevision: 2,
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 2,
        outcomeId: '6a000000-0000-4000-8000-000000000010',
        outcomeRevision: 1,
      },
    })
    expect(corrected.item).toMatchObject({
      status: 'closed',
      closedAt: COMPLETED_AT,
      rating: 2,
      commandRevision: 3,
    })
    expect(corrected.feedbackHandling).toMatchObject({
      stateRevision: 2,
      status: 'closed',
    })
    expect(corrected.feedbackHandling.history).toEqual([
      expect.objectContaining({
        id: '6a000000-0000-4000-8000-000000000010',
        outcomeRevision: 1,
        completionAt: COMPLETED_AT,
        deadlineResult: 'on_time',
      }),
      expect.objectContaining({
        id: '6a000000-0000-4000-8000-000000000011',
        outcomeRevision: 2,
        completionAt: COMPLETED_AT,
        deadlineResult: 'on_time',
        supersedesOutcomeId: '6a000000-0000-4000-8000-000000000010',
      }),
    ])

    const persisted = await pool.query(
      `SELECT status, closed_at, rating, command_revision::int
       FROM inbox_items WHERE id = $1`,
      [ITEM],
    )
    expect(persisted.rows).toEqual([
      // Legacy Inbox content columns stay empty; the enriched rating returned
      // to the manager is preserved by both commands and never rewritten.
      { status: 'closed', closed_at: COMPLETED_AT, rating: null, command_revision: 3 },
    ])
    const payloads = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1
         AND event_type IN (
           'inbox.inbox_item.status_changed',
           'inbox.handling_cycle.closed'
         )`,
      [ORG],
    )
    expect(payloads.rows).toHaveLength(2)
    for (const { payload } of payloads.rows) {
      expect(payload).not.toHaveProperty('internalNote')
      expect(payload).not.toHaveProperty('outcome')
    }

    await expect(
      pool.query(
        `INSERT INTO inbox_feedback_handling_outcomes (
           id, inbox_item_id, cycle_number, outcome_revision, organization_id,
           property_id, source_type, feedback_id, source_revision, outcome,
           internal_note, recorded_by, recorded_at, completion_at,
           completion_state_revision, deadline_result, resulting_command_revision,
           supersedes_outcome_id, supersedes_outcome_revision
         ) VALUES (
           $1, $2, 1, 3, $3, $4, 'feedback', $5, 1,
           'follow_up_completed', NULL, $6, $7, $8, 2, 'late', 4, $9, 2
         )`,
        [
          '6a000000-0000-4000-8000-000000000012',
          ITEM,
          ORG,
          PROPERTY,
          FEEDBACK,
          MANAGER,
          new Date('2026-08-27T11:00:00.000Z'),
          COMPLETED_AT,
          '6a000000-0000-4000-8000-000000000011',
        ],
      ),
    ).rejects.toThrow('must preserve and directly supersede completion facts')

    await expect(
      pool.query(
        `UPDATE inbox_feedback_handling_outcomes
         SET internal_note = 'rewritten' WHERE inbox_item_id = $1`,
        [ITEM],
      ),
    ).rejects.toThrow('immutable')
    await expect(
      pool.query(
        'DELETE FROM inbox_feedback_handling_outcomes WHERE inbox_item_id = $1',
        [ITEM],
      ),
    ).rejects.toThrow('immutable')
    await expect(
      pool.query('TRUNCATE TABLE inbox_feedback_handling_outcomes'),
    ).rejects.toThrow('immutable')

    await pool.query('DELETE FROM inbox_items WHERE id = $1', [ITEM])
    const cascade = await pool.query(
      'SELECT count(*)::int AS count FROM inbox_feedback_handling_outcomes WHERE inbox_item_id = $1',
      [ITEM],
    )
    expect(cascade.rows).toEqual([{ count: 0 }])
  })

  it('serializes competing corrections so exactly one superseding fact lands', async () => {
    const item = await seed()
    const store = createFeedbackHandlingStore(db, silentEvents, allowAllCommandAuthority)
    const handled = await store.markHandled({
      item,
      outcomeId: '6a000000-0000-4000-8000-000000000020',
      outcome: 'reviewed_no_additional_step',
      internalNote: null,
      actorUserId: MANAGER,
      recordedAt: COMPLETED_AT,
      expected: {
        commandRevision: 1,
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 1,
      },
    })
    const command = {
      item: handled.item,
      outcome: 'handled_with_team' as const,
      internalNote: null,
      actorUserId: MANAGER,
      recordedAt: CORRECTED_AT,
      expected: {
        commandRevision: 2,
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 2,
        outcomeId: '6a000000-0000-4000-8000-000000000020',
        outcomeRevision: 1,
      },
    }
    const results = await Promise.allSettled([
      store.correctOutcome({
        ...command,
        outcomeId: '6a000000-0000-4000-8000-000000000021',
      }),
      store.correctOutcome({
        ...command,
        outcomeId: '6a000000-0000-4000-8000-000000000022',
      }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toBeDefined()
    if (rejected?.status === 'rejected') {
      expect(isInboxError(rejected.reason)).toBe(true)
      expect(rejected.reason).toMatchObject({ code: 'revision_conflict' })
    }
    const rows = await pool.query(
      `SELECT outcome_revision::int
       FROM inbox_feedback_handling_outcomes
       WHERE inbox_item_id = $1 ORDER BY outcome_revision`,
      [ITEM],
    )
    expect(rows.rows).toEqual([{ outcome_revision: 1 }, { outcome_revision: 2 }])
  })

  it('serializes competing completion commands so one close has exactly one outcome', async () => {
    const item = await seed()
    const store = createFeedbackHandlingStore(db, silentEvents, allowAllCommandAuthority)
    const command = {
      item,
      outcome: 'handled_with_team' as const,
      internalNote: null,
      actorUserId: MANAGER,
      recordedAt: COMPLETED_AT,
      expected: {
        commandRevision: 1,
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 1,
      },
    }
    const results = await Promise.allSettled([
      store.markHandled({
        ...command,
        outcomeId: '6a000000-0000-4000-8000-000000000030',
      }),
      store.markHandled({
        ...command,
        outcomeId: '6a000000-0000-4000-8000-000000000031',
      }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toBeDefined()
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toMatchObject({ code: 'revision_conflict' })
    }
    const rows = await pool.query(
      `SELECT outcome_revision::int
       FROM inbox_feedback_handling_outcomes WHERE inbox_item_id = $1`,
      [ITEM],
    )
    expect(rows.rows).toEqual([{ outcome_revision: 1 }])
  })

  it('keeps guest withdrawal separate and records no manager outcome', async () => {
    const item = await seed()
    const source = guestFeedbackRetracted({
      feedbackId: FEEDBACK,
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: PORTAL,
      supersedesSourceEventId: crypto.randomUUID(),
      occurredAt: COMPLETED_AT,
    })
    await createOutboxRepository(db).insert({
      ...toOutboxEvent(source),
      id: source.eventId,
    })
    await createAtomicInboxCommandStore(db).applySourceWithdrawnOnce({
      eventId: source.eventId,
      consumerName: 'inbox.feedback-handling.withdrawal-proof',
      item,
      sourceRevision: 1,
      now: COMPLETED_AT,
      fact: inboxItemStatusChanged({
        inboxItemId: ITEM,
        organizationId: ORG,
        propertyId: PROPERTY,
        oldStatus: 'open',
        newStatus: 'closed',
        occurredAt: COMPLETED_AT,
      }),
    })

    const store = createFeedbackHandlingStore(db, silentEvents, allowAllCommandAuthority)
    const state = await store.getState(ITEM, ORG)
    expect(state).toMatchObject({ status: 'closed', stateRevision: 2 })
    expect(state?.history).toEqual([])
    const target = await pool.query(
      `SELECT result, stop_reason, completion_at
       FROM inbox_handling_cycle_response_targets
       WHERE inbox_item_id = $1 AND cycle_number = 1`,
      [ITEM],
    )
    expect(target.rows).toEqual([
      {
        result: 'cancelled',
        stop_reason: 'guest_withdrawn',
        completion_at: COMPLETED_AT,
      },
    ])
    const reminders = await pool.query(
      `SELECT count(*)::int AS count
       FROM inbox_response_target_reminders
       WHERE inbox_item_id = $1 AND cancelled_at = $2`,
      [ITEM, COMPLETED_AT],
    )
    expect(reminders.rows).toEqual([{ count: 2 }])
    await expect(
      pool.query(
        `INSERT INTO inbox_feedback_handling_outcomes (
           id, inbox_item_id, cycle_number, outcome_revision, organization_id,
           property_id, source_type, feedback_id, source_revision, outcome,
           internal_note, recorded_by, recorded_at, completion_at,
           completion_state_revision, deadline_result, resulting_command_revision,
           supersedes_outcome_id, supersedes_outcome_revision
         ) VALUES (
           $1, $2, 1, 1, $3, $4, 'feedback', $5, 1,
           'reviewed_no_additional_step', NULL, $6, $7, $7, 2,
           'not_measured', 3, NULL, NULL
         )`,
        [
          '6a000000-0000-4000-8000-000000000041',
          ITEM,
          ORG,
          PROPERTY,
          FEEDBACK,
          MANAGER,
          COMPLETED_AT,
        ],
      ),
    ).rejects.toThrow('requires its private_feedback_handled completion transition')
    await expect(
      store.markHandled({
        item,
        outcomeId: '6a000000-0000-4000-8000-000000000040',
        outcome: 'reviewed_no_additional_step',
        internalNote: null,
        actorUserId: MANAGER,
        recordedAt: CORRECTED_AT,
        expected: {
          commandRevision: 2,
          cycleNumber: 1,
          sourceRevision: 1,
          stateRevision: 2,
        },
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    const transition = await pool.query(
      `SELECT transition_reason
       FROM inbox_handling_cycle_transitions
       WHERE inbox_item_id = $1 AND kind = 'closed'`,
      [ITEM],
    )
    expect(transition.rows).toEqual([{ transition_reason: 'guest_withdrawn' }])
  })
})
