// Retention, redaction and source-unavailable is NEVER manager handling.
//
// The database already refuses an outcome row without a matching
// `private_feedback_handled` completion transition, and `markHandled` already
// refuses a closed cycle. Neither covers the live hole this file closes: a
// guest withdrawal (or retention purge) closes cycle 1, a manager reopens the
// item for internal follow-up, and cycle 2 is open and structurally handleable
// — so a Private Feedback Handling Outcome could be recorded about a body that
// no longer exists. That is the same fabricated-outcome failure the legacy
// classifier guards against, and it must fail closed for LIVE rows too.

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
import type { InboxItem } from '../domain/types'
import { inboxItemStatusChanged } from '../domain/events'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createFeedbackHandlingStore } from './feedback-handling.store'

const ORG = organizationId('org-manager-handling-authority-0001')
const PROPERTY = propertyId('6b000000-0000-4000-8000-000000000001')
const WITHDRAWN_ITEM = inboxItemId('6b000000-0000-4000-8000-000000000002')
const WITHDRAWN_FEEDBACK = feedbackId('6b000000-0000-4000-8000-000000000003')
const LIVE_ITEM = inboxItemId('6b000000-0000-4000-8000-000000000004')
const LIVE_FEEDBACK = feedbackId('6b000000-0000-4000-8000-000000000005')
const PORTAL = portalId('6b000000-0000-4000-8000-000000000006')
const MANAGER = userId('user-manager-handling-authority-01')

const OPENED_AT = new Date('2026-08-27T08:00:00.000Z')
const WITHDRAWN_AT = new Date('2026-08-27T09:00:00.000Z')
const REOPENED_AT = new Date('2026-08-27T10:00:00.000Z')
const ATTEMPTED_AT = new Date('2026-08-27T11:00:00.000Z')

const db = getDb()
let pool: Pool

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({ allowed: true })

const commandStore = (database: Database) =>
  createProductionInboxCommandStore(database, allowAllCommandAuthority, () => OPENED_AT)

const makeItem = (id: InboxItem['id'], sourceId: InboxItem['sourceId']): InboxItem => ({
  id,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceType: 'feedback',
  sourceId,
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

async function seedScope(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Manager handling authority', $2, NOW())`,
    [ORG, `manager-handling-authority-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Handling property', $3, 'UTC', 0, NOW(), NOW())`,
    [PROPERTY, ORG, `manager-handling-authority-${process.pid}`],
  )
}

async function openFeedbackCycle(
  id: InboxItem['id'],
  sourceId: InboxItem['sourceId'],
): Promise<InboxItem> {
  const item = makeItem(id, sourceId)
  await commandStore(db).createItem(item, null, {
    sourceRevision: 1,
    openedReason: 'feedback_submitted',
    actorType: 'guest',
    triggerEventId: null,
    openedAt: OPENED_AT,
  })
  return item
}

/** Guest withdrawal is the live retention/redaction closure for private feedback. */
async function withdraw(item: InboxItem): Promise<void> {
  const source = guestFeedbackRetracted({
    feedbackId: feedbackId(item.sourceId),
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: PORTAL,
    supersedesSourceEventId: crypto.randomUUID(),
    occurredAt: WITHDRAWN_AT,
  })
  await createOutboxRepository(db).insert({
    ...toOutboxEvent(source),
    id: source.eventId,
  })
  await commandStore(db).applySourceWithdrawnOnce({
    eventId: source.eventId,
    consumerName: 'inbox.manager-handling-authority.withdrawal',
    item,
    sourceRevision: 1,
    now: WITHDRAWN_AT,
    fact: inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: ORG,
      propertyId: PROPERTY,
      oldStatus: 'open',
      newStatus: 'closed',
      occurredAt: WITHDRAWN_AT,
    }),
  })
}

/** Manual reopen for internal follow-up — legitimate work, illegitimate outcome. */
async function reopen(item: InboxItem, closedStateRevision: number): Promise<InboxItem> {
  const [row] = (
    await pool.query<{ command_revision: string }>(
      'SELECT command_revision FROM inbox_items WHERE id = $1',
      [item.id],
    )
  ).rows
  const current: InboxItem = {
    ...item,
    status: 'closed',
    closedAt: WITHDRAWN_AT,
    commandRevision: Number(row!.command_revision),
  }
  return commandStore(db).reopenReviewCycle({
    item: current,
    expected: { cycleNumber: 1, sourceRevision: 1, stateRevision: closedStateRevision },
    reason: 'internal_follow_up_still_needed',
    explanation: null,
    fact: inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: ORG,
      propertyId: PROPERTY,
      oldStatus: 'closed',
      newStatus: 'open',
      userId: MANAGER,
      occurredAt: REOPENED_AT,
    }),
    now: REOPENED_AT,
  })
}

const countOutcomes = async (id: InboxItem['id']): Promise<number> =>
  Number(
    (
      await pool.query<{ count: string }>(
        'SELECT count(*) AS count FROM inbox_feedback_handling_outcomes WHERE inbox_item_id = $1',
        [id],
      )
    ).rows[0]!.count,
  )

const closeReasons = async (id: InboxItem['id']): Promise<string[]> =>
  (
    await pool.query<{ transition_reason: string }>(
      `SELECT transition_reason FROM inbox_handling_cycle_transitions
       WHERE inbox_item_id = $1 AND kind = 'closed' ORDER BY state_revision`,
      [id],
    )
  ).rows.map((row) => row.transition_reason)

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
  await seedScope()
})

describe.sequential('Manager handling authority (PostgreSQL)', () => {
  it('refuses a manager outcome on a cycle reopened after the source was withdrawn', async () => {
    const item = await openFeedbackCycle(WITHDRAWN_ITEM, WITHDRAWN_FEEDBACK)
    await withdraw(item)
    const reopened = await reopen(item, 2)
    expect(reopened.status).toBe('open')

    const handling = createFeedbackHandlingStore(db, allowAllCommandAuthority)
    const state = await handling.getState(item.id, ORG)
    expect(state).toMatchObject({ cycleNumber: 2, status: 'open' })

    await expect(
      handling.markHandled({
        item: reopened,
        outcomeId: '6b000000-0000-4000-8000-000000000010',
        outcome: 'follow_up_completed',
        internalNote: null,
        actorUserId: MANAGER,
        recordedAt: ATTEMPTED_AT,
        expected: {
          commandRevision: reopened.commandRevision,
          cycleNumber: state!.cycleNumber,
          sourceRevision: state!.sourceRevision,
          stateRevision: state!.stateRevision,
        },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      context: { unavailableCloseReasons: ['guest_withdrawn'] },
    })

    // The refusal must leave no trace of manager judgement anywhere.
    expect(await countOutcomes(item.id)).toBe(0)
    expect(await closeReasons(item.id)).toEqual(['guest_withdrawn'])
    await expect(handling.getState(item.id, ORG)).resolves.toMatchObject({
      cycleNumber: 2,
      status: 'open',
      currentOutcome: null,
    })
  })

  it('still refuses once the reopened cycle has been closed and a correction is attempted', async () => {
    const item = await openFeedbackCycle(WITHDRAWN_ITEM, WITHDRAWN_FEEDBACK)
    await withdraw(item)
    const reopened = await reopen(item, 2)
    const handling = createFeedbackHandlingStore(db, allowAllCommandAuthority)
    const state = await handling.getState(item.id, ORG)

    await expect(
      handling.correctOutcome({
        item: reopened,
        outcomeId: '6b000000-0000-4000-8000-000000000011',
        outcome: 'handled_with_team',
        internalNote: null,
        actorUserId: MANAGER,
        recordedAt: ATTEMPTED_AT,
        expected: {
          commandRevision: reopened.commandRevision,
          cycleNumber: state!.cycleNumber,
          sourceRevision: state!.sourceRevision,
          stateRevision: state!.stateRevision,
          outcomeRevision: 1,
          outcomeId: '6b000000-0000-4000-8000-000000000010',
        },
      }),
    ).rejects.toMatchObject({ _tag: 'InboxError' })
    expect(await countOutcomes(item.id)).toBe(0)
  })

  it('permits a manager outcome on a reopened cycle whose source was never unavailable', async () => {
    const item = await openFeedbackCycle(LIVE_ITEM, LIVE_FEEDBACK)
    const handling = createFeedbackHandlingStore(db, allowAllCommandAuthority)
    const handled = await handling.markHandled({
      item,
      outcomeId: '6b000000-0000-4000-8000-000000000020',
      outcome: 'follow_up_attempted',
      internalNote: null,
      actorUserId: MANAGER,
      recordedAt: WITHDRAWN_AT,
      expected: {
        commandRevision: 1,
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 1,
      },
    })
    expect(handled.feedbackHandling.currentOutcome?.outcome).toBe('follow_up_attempted')

    const reopened = await commandStore(db).reopenReviewCycle({
      item: handled.item,
      expected: { cycleNumber: 1, sourceRevision: 1, stateRevision: 2 },
      reason: 'new_information',
      explanation: null,
      fact: inboxItemStatusChanged({
        inboxItemId: item.id,
        organizationId: ORG,
        propertyId: PROPERTY,
        oldStatus: 'closed',
        newStatus: 'open',
        userId: MANAGER,
        occurredAt: REOPENED_AT,
      }),
      now: REOPENED_AT,
    })
    const state = await handling.getState(item.id, ORG)
    const second = await handling.markHandled({
      item: reopened,
      outcomeId: '6b000000-0000-4000-8000-000000000021',
      outcome: 'reviewed_no_additional_step',
      internalNote: null,
      actorUserId: MANAGER,
      recordedAt: ATTEMPTED_AT,
      expected: {
        commandRevision: reopened.commandRevision,
        cycleNumber: state!.cycleNumber,
        sourceRevision: state!.sourceRevision,
        stateRevision: state!.stateRevision,
      },
    })
    expect(second.feedbackHandling).toMatchObject({
      cycleNumber: 2,
      status: 'closed',
      closeReason: 'private_feedback_handled',
    })
    expect(await countOutcomes(item.id)).toBe(2)
  })
})
