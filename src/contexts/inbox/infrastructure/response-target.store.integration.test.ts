import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { EventBus } from '#/shared/events/event-bus'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../domain/types'
import { inboxItemStatusChanged } from '../domain/events'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createFeedbackHandlingStore } from './feedback-handling.store'
import { createResponseTargetStore } from './response-target.store'
import { completeGoogleReviewTarget } from './response-target.store'
import { createResponseTargetPolicyStore } from './response-target-policy.store'
import { createReviewHandlingCycleStore } from './review-handling-cycle.store'

const ORG = organizationId('org-response-target-pg-00000000001')
const PROPERTY = propertyId('79000000-0000-4000-8000-000000000001')
const ITEM = inboxItemId('79000000-0000-4000-8000-000000000002')
const FEEDBACK = feedbackId('79000000-0000-4000-8000-000000000003')
const LEGACY_ITEM = inboxItemId('79000000-0000-4000-8000-000000000030')
const LEGACY_FEEDBACK = feedbackId('79000000-0000-4000-8000-000000000031')
const MANAGER = userId('user-response-target-manager-00001')
const REVIEW_ITEM = inboxItemId('79000000-0000-4000-8000-000000000040')
const REVIEW = reviewId('79000000-0000-4000-8000-000000000041')
const HISTORICAL_ITEM = inboxItemId('79000000-0000-4000-8000-000000000042')
const HISTORICAL_REVIEW = reviewId('79000000-0000-4000-8000-000000000043')
const UNKNOWN_ITEM = inboxItemId('79000000-0000-4000-8000-000000000044')
const UNKNOWN_REVIEW = reviewId('79000000-0000-4000-8000-000000000045')
const OPENED_AT = new Date('2026-08-28T08:00:00.000Z')

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
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  rating: 2,
  sourceDate: OPENED_AT,
  platform: null,
  snippet: 'Private feedback',
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: OPENED_AT,
  updatedAt: OPENED_AT,
})

const makeReviewItem = (id = REVIEW_ITEM, sourceId = REVIEW): InboxItem => ({
  ...makeItem(),
  id,
  sourceType: 'review',
  sourceId,
  platform: 'google',
  snippet: null,
})

async function clean(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query(
    'DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seedReviewSource(
  sourceId: ReturnType<typeof reviewId>,
  eligibility: 'measured' | 'historical_onboarding' | 'legacy_unknown',
  startAt: Date | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', $4, 'locations/response-target-test', 4, $5, $6,
       0, 1, 0, 1, 1, $7, 'active', $5, $5
     )`,
    [
      sourceId,
      ORG,
      PROPERTY,
      `external-${sourceId}`,
      OPENED_AT,
      new Date('2027-08-28T08:00:00.000Z'),
      '0'.repeat(64),
    ],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, response_target_eligibility, response_target_start_at,
       content_state, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 4,
       'response target review', $5, $6, 'active', $7, $7
     )`,
    [sourceId, ORG, PROPERTY, '1'.repeat(64), eligibility, startAt, OPENED_AT],
  )
}

async function seedScope(
  input?: Readonly<{
    organizationMinutes?: number
    propertyMinutes?: number | null
  }>,
): Promise<InboxItem> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Response Target Test', 'response-target-test', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Target Property', 'target-property', 'America/New_York', 0, NOW(), NOW())`,
    [PROPERTY, ORG],
  )
  if (input?.organizationMinutes !== undefined) {
    await pool.query(
      `INSERT INTO inbox_response_target_organization_policies (
         organization_id, target_kind, duration_minutes, policy_version,
         updated_by, created_at, updated_at
       ) VALUES ($1, 'private_feedback_handling', $2, 5, $3, $4, $4)`,
      [ORG, input.organizationMinutes, MANAGER, OPENED_AT],
    )
  }
  if (input?.propertyMinutes !== undefined) {
    await pool.query(
      `INSERT INTO inbox_private_feedback_target_property_overrides (
         organization_id, property_id, enabled, duration_minutes, policy_version,
         updated_by, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 9, $5, $6, $6)`,
      [
        ORG,
        PROPERTY,
        input.propertyMinutes !== null,
        input.propertyMinutes,
        MANAGER,
        OPENED_AT,
      ],
    )
  }
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

describe.sequential('Inbox Response Target store (PostgreSQL)', () => {
  it('measures Google response time while explicitly excluding historical and unknown cycles', async () => {
    await seedScope()
    await pool.query(
      `INSERT INTO inbox_response_target_organization_policies (
         organization_id, target_kind, duration_minutes, policy_version,
         updated_by, created_at, updated_at
       ) VALUES ($1, 'google_review_response', 60, 1, $2, $3, $3)`,
      [ORG, MANAGER, OPENED_AT],
    )
    await seedReviewSource(REVIEW, 'measured', OPENED_AT)
    await seedReviewSource(HISTORICAL_REVIEW, 'historical_onboarding', null)
    await seedReviewSource(UNKNOWN_REVIEW, 'legacy_unknown', null)
    const store = commandStore(db)
    await store.createItem(makeReviewItem(), null, {
      sourceRevision: 1,
      openedReason: 'review_observed',
      actorType: 'provider',
      triggerEventId: null,
      openedAt: OPENED_AT,
      responseTarget: {
        reviewAuthority: {
          authority: 'review.current-response-target.v1',
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: REVIEW,
          sourceEpoch: 0,
          materialReviewRevision: 1,
          eligibility: 'measured',
          responseTargetStartAt: OPENED_AT,
        },
        targetStart: { basis: 'review_provenance' },
      },
    })
    await store.createItem(makeReviewItem(HISTORICAL_ITEM, HISTORICAL_REVIEW), null, {
      sourceRevision: 1,
      openedReason: 'review_observed',
      actorType: 'provider',
      triggerEventId: null,
      openedAt: OPENED_AT,
      responseTarget: {
        reviewAuthority: {
          authority: 'review.current-response-target.v1',
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: HISTORICAL_REVIEW,
          sourceEpoch: 0,
          materialReviewRevision: 1,
          eligibility: 'historical_onboarding',
          responseTargetStartAt: null,
        },
        targetStart: { basis: 'review_provenance' },
      },
    })
    await store.createItem(makeReviewItem(UNKNOWN_ITEM, UNKNOWN_REVIEW), null, {
      materialReviewRevision: 1,
    })

    const targets = createResponseTargetStore(db, silentEvents)
    await expect(
      targets.getCycleTarget(REVIEW_ITEM, ORG, OPENED_AT),
    ).resolves.toMatchObject({
      targetKind: 'google_review_response',
      eligibility: 'measured',
      durationMinutes: 60,
      policySource: 'organization_policy',
      startAt: OPENED_AT,
      dueAt: new Date('2026-08-28T09:00:00.000Z'),
    })
    await expect(
      targets.getCycleTarget(HISTORICAL_ITEM, ORG, OPENED_AT),
    ).resolves.toMatchObject({
      targetKind: 'google_review_response',
      eligibility: 'historical_onboarding',
      startAt: null,
      dueAt: null,
    })
    await expect(
      targets.getCycleTarget(UNKNOWN_ITEM, ORG, OPENED_AT),
    ).resolves.toMatchObject({ eligibility: 'legacy_unknown' })

    const head = await createReviewHandlingCycleStore(db).findSourceHead?.(
      REVIEW_ITEM,
      ORG,
    )
    if (!head) throw new Error('measured Review Handling Cycle was not created')
    const completedAt = new Date('2026-08-28T08:45:00.000Z')
    await expect(
      db.transaction((tx) => completeGoogleReviewTarget(tx, head, completedAt)),
    ).resolves.toBe('on_time')
    await expect(
      targets.getCycleTarget(REVIEW_ITEM, ORG, completedAt),
    ).resolves.toMatchObject({
      completionAt: completedAt,
      result: 'on_time',
      stopReason: 'confirmed_on_google',
    })
    await expect(
      targets.getGoogleReviewAnalytics({
        organizationId: ORG,
        propertyIds: [PROPERTY],
        now: completedAt,
      }),
    ).resolves.toEqual({
      targetKind: 'google_review_response',
      measuredCycleCount: 1,
      activeCount: 0,
      currentOverdueCount: 0,
      respondedOnTimeCount: 1,
      respondedLateCount: 0,
      reopenCount: 0,
      historicalOnboardingExcludedCount: 1,
      legacyUnknownExcludedCount: 1,
      averageTimeToResponseMinutes: 45,
    })
    const reminderCounts = await pool.query<{ source_id: string; count: number }>(
      `SELECT target.source_id, count(reminder.*)::int AS count
       FROM inbox_handling_cycle_response_targets target
       LEFT JOIN inbox_response_target_reminders reminder
         ON reminder.inbox_item_id = target.inbox_item_id
        AND reminder.cycle_number = target.cycle_number
       WHERE target.inbox_item_id = ANY($1::uuid[])
       GROUP BY target.source_id
       ORDER BY target.source_id`,
      [[REVIEW_ITEM, HISTORICAL_ITEM, UNKNOWN_ITEM]],
    )
    expect(reminderCounts.rows).toEqual([
      { source_id: REVIEW, count: 2 },
      { source_id: HISTORICAL_REVIEW, count: 0 },
      { source_id: UNKNOWN_REVIEW, count: 0 },
    ])
  })

  it('snapshots Property policy, records approved handling timing, and preserves it across correction and reopen', async () => {
    const item = await seedScope({
      organizationMinutes: 2_880,
      propertyMinutes: 720,
    })
    const targets = createResponseTargetStore(db, silentEvents)
    const handling = createFeedbackHandlingStore(
      db,
      silentEvents,
      allowAllCommandAuthority,
    )

    await expect(targets.getCycleTarget(ITEM, ORG, OPENED_AT)).resolves.toMatchObject({
      cycleNumber: 1,
      targetKind: 'private_feedback_handling',
      durationMinutes: 720,
      policySource: 'property_override',
      policyVersion: 9,
      startAt: OPENED_AT,
      dueAt: new Date('2026-08-28T20:00:00.000Z'),
      propertyTimezone: 'America/New_York',
      evaluation: { state: 'active', overdue: false },
    })
    const reminders = await pool.query(
      `SELECT reminder_kind, scheduled_for
       FROM inbox_response_target_reminders
       WHERE inbox_item_id = $1 ORDER BY scheduled_for`,
      [ITEM],
    )
    expect(reminders.rows).toEqual([
      { reminder_kind: 'halfway', scheduled_for: new Date('2026-08-28T14:00:00Z') },
      {
        reminder_kind: 'target_passed',
        scheduled_for: new Date('2026-08-28T20:00:00Z'),
      },
    ])

    const completedAt = new Date('2026-08-28T18:00:00.000Z')
    const handled = await handling.markHandled({
      item,
      outcomeId: '79000000-0000-4000-8000-000000000010',
      outcome: 'follow_up_completed',
      internalNote: null,
      actorUserId: MANAGER,
      recordedAt: completedAt,
      expected: {
        commandRevision: 1,
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 1,
      },
    })
    expect(handled.feedbackHandling.currentOutcome).toMatchObject({
      deadlineResult: 'on_time',
      completionAt: completedAt,
    })
    const corrected = await handling.correctOutcome({
      item: handled.item,
      outcomeId: '79000000-0000-4000-8000-000000000011',
      outcome: 'handled_with_team',
      internalNote: null,
      actorUserId: MANAGER,
      recordedAt: new Date('2026-08-28T19:00:00.000Z'),
      expected: {
        commandRevision: 2,
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 2,
        outcomeRevision: 1,
        outcomeId: '79000000-0000-4000-8000-000000000010',
      },
    })
    await expect(
      targets.getCycleTarget(ITEM, ORG, new Date('2026-08-29T00:00:00.000Z')),
    ).resolves.toMatchObject({
      cycleNumber: 1,
      completionAt: completedAt,
      result: 'on_time',
      stopReason: 'private_feedback_handled',
      evaluation: { state: 'completed', overdue: false, elapsedMinutes: 600 },
    })

    await pool.query(
      `UPDATE inbox_private_feedback_target_property_overrides
       SET enabled = false, duration_minutes = NULL, policy_version = 10,
           updated_at = $1
       WHERE organization_id = $2 AND property_id = $3`,
      [completedAt, ORG, PROPERTY],
    )
    await pool.query(
      `UPDATE inbox_response_target_organization_policies
       SET duration_minutes = 1440, policy_version = 6, updated_at = $1
       WHERE organization_id = $2 AND target_kind = 'private_feedback_handling'`,
      [completedAt, ORG],
    )
    const reopenAt = new Date('2026-08-28T20:00:00.000Z')
    await commandStore(db).reopenReviewCycle({
      item: corrected.item,
      expected: { cycleNumber: 1, sourceRevision: 1, stateRevision: 2 },
      reason: 'new_information',
      explanation: null,
      fact: inboxItemStatusChanged({
        inboxItemId: ITEM,
        organizationId: ORG,
        propertyId: PROPERTY,
        oldStatus: 'closed',
        newStatus: 'open',
        userId: MANAGER,
        occurredAt: reopenAt,
      }),
      now: reopenAt,
    })
    await expect(targets.getCycleTarget(ITEM, ORG, reopenAt)).resolves.toMatchObject({
      cycleNumber: 2,
      durationMinutes: 1_440,
      policySource: 'organization_policy',
      policyVersion: 6,
      startAt: reopenAt,
      dueAt: new Date('2026-08-29T20:00:00.000Z'),
    })
    const snapshots = await pool.query(
      `SELECT cycle_number::int, duration_minutes, policy_source, policy_version::int,
              completion_at, result
       FROM inbox_handling_cycle_response_targets
       WHERE inbox_item_id = $1 ORDER BY cycle_number`,
      [ITEM],
    )
    expect(snapshots.rows).toEqual([
      {
        cycle_number: 1,
        duration_minutes: 720,
        policy_source: 'property_override',
        policy_version: 9,
        completion_at: completedAt,
        result: 'on_time',
      },
      {
        cycle_number: 2,
        duration_minutes: 1_440,
        policy_source: 'organization_policy',
        policy_version: 6,
        completion_at: null,
        result: null,
      },
    ])
  })

  it('releases each halfway and target-passed fact once under concurrent workers and never escalates workflow', async () => {
    const item = await seedScope({ organizationMinutes: 2_880 })
    const targets = createResponseTargetStore(db, silentEvents)
    const halfway = new Date('2026-08-29T08:00:00.000Z')

    const halfwayRace = await Promise.all([
      targets.releaseDueReminders({ now: halfway, limit: 10 }),
      targets.releaseDueReminders({ now: halfway, limit: 10 }),
    ])
    expect(halfwayRace.reduce((sum, result) => sum + result.released, 0)).toBe(1)
    await expect(
      targets.releaseDueReminders({ now: halfway, limit: 10 }),
    ).resolves.toEqual({ released: 0 })

    const dueAt = new Date('2026-08-30T08:00:00.000Z')
    await expect(targets.releaseDueReminders({ now: dueAt, limit: 10 })).resolves.toEqual(
      { released: 1 },
    )
    await expect(
      targets.releaseDueReminders({ now: new Date('2026-09-02T08:00:00Z'), limit: 10 }),
    ).resolves.toEqual({ released: 0 })

    const facts = await pool.query(
      `SELECT event_type, payload->>'reminderKind' AS reminder_kind
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.response_target.reminder_due'
       ORDER BY payload->>'scheduledFor'`,
      [ORG],
    )
    expect(facts.rows).toEqual([
      {
        event_type: 'inbox.response_target.reminder_due',
        reminder_kind: 'halfway',
      },
      {
        event_type: 'inbox.response_target.reminder_due',
        reminder_kind: 'target_passed',
      },
    ])
    const workflow = await pool.query(
      `SELECT status, is_escalated, command_revision::int
       FROM inbox_items WHERE id = $1`,
      [ITEM],
    )
    expect(workflow.rows).toEqual([
      { status: 'open', is_escalated: false, command_revision: 1 },
    ])

    const lateAt = new Date('2026-08-30T09:00:00.000Z')
    const handled = await createFeedbackHandlingStore(
      db,
      silentEvents,
      allowAllCommandAuthority,
    ).markHandled({
      item,
      outcomeId: '79000000-0000-4000-8000-000000000020',
      outcome: 'follow_up_attempted',
      internalNote: null,
      actorUserId: MANAGER,
      recordedAt: lateAt,
      expected: {
        commandRevision: 1,
        cycleNumber: 1,
        sourceRevision: 1,
        stateRevision: 1,
      },
    })
    expect(handled.feedbackHandling.currentOutcome?.deadlineResult).toBe('late')
    await expect(
      targets.getPrivateFeedbackAnalytics({
        organizationId: ORG,
        propertyIds: null,
        now: lateAt,
      }),
    ).resolves.toEqual({
      targetKind: 'private_feedback_handling',
      measuredCycleCount: 1,
      activeCount: 0,
      currentOverdueCount: 0,
      handledOnTimeCount: 0,
      handledLateCount: 1,
      reopenCount: 0,
      averageTimeToFirstHandlingMinutes: 2_940,
    })
  })

  it('terminalizes a superseded target while keeping the new cycle on provider timing', async () => {
    await seedScope()
    await pool.query(
      `INSERT INTO inbox_response_target_organization_policies (
         organization_id, target_kind, duration_minutes, policy_version,
         updated_by, created_at, updated_at
       ) VALUES ($1, 'google_review_response', 60, 1, $2, $3, $3)`,
      [ORG, MANAGER, OPENED_AT],
    )
    await seedReviewSource(REVIEW, 'measured', OPENED_AT)
    const observedAt = new Date('2026-08-28T10:00:00.000Z')
    const providerUpdatedAt = new Date('2026-08-28T09:30:00.000Z')
    await pool.query(
      `INSERT INTO material_review_revisions (
         review_id, revision, organization_id, property_id, source_epoch,
         normalization_version, source_digest, normalized_digest, rating,
         normalized_text, response_target_eligibility, response_target_start_at,
         content_state, created_at, updated_at
       ) VALUES (
         $1, 2, $2, $3, 0, 'review-material-v1', $4, $4, 4,
         'response target review revision two', 'measured', $5, 'active', $6, $6
       )`,
      [REVIEW, ORG, PROPERTY, '2'.repeat(64), providerUpdatedAt, observedAt],
    )
    const commands = commandStore(db)
    await commands.createItem(makeReviewItem(), null, {
      sourceRevision: 1,
      openedReason: 'review_observed',
      actorType: 'provider',
      triggerEventId: null,
      openedAt: new Date('2026-08-28T08:05:00.000Z'),
      responseTarget: {
        reviewAuthority: {
          authority: 'review.current-response-target.v1',
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: REVIEW,
          sourceEpoch: 0,
          materialReviewRevision: 1,
          eligibility: 'measured',
          responseTargetStartAt: OPENED_AT,
        },
        targetStart: { basis: 'review_provenance' },
      },
    })

    const cycleStore = createReviewHandlingCycleStore(db)
    const head = await cycleStore.findHead(REVIEW_ITEM, ORG)
    if (!head) throw new Error('seeded Review Handling Cycle is missing')
    await cycleStore.startNext({
      inboxItemId: REVIEW_ITEM,
      organizationId: ORG,
      expected: {
        cycleNumber: head.currentCycleNumber,
        materialReviewRevision: head.currentMaterialReviewRevision,
        stateRevision: head.stateRevision,
      },
      materialReviewRevision: 2,
      openedReason: 'material_revision_changed',
      openedBy: null,
      openedAt: observedAt,
      responseTarget: {
        reviewAuthority: {
          authority: 'review.current-response-target.v1',
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: REVIEW,
          sourceEpoch: 0,
          materialReviewRevision: 2,
          eligibility: 'measured',
          responseTargetStartAt: providerUpdatedAt,
        },
        targetStart: { basis: 'review_provenance' },
      },
    })

    const targetRows = await pool.query(
      `SELECT cycle_number::int, start_at, completion_at, result, stop_reason
       FROM inbox_handling_cycle_response_targets
       WHERE inbox_item_id = $1
       ORDER BY cycle_number`,
      [REVIEW_ITEM],
    )
    expect(targetRows.rows).toEqual([
      expect.objectContaining({
        cycle_number: 1,
        start_at: OPENED_AT,
        completion_at: observedAt,
        result: 'cancelled',
        stop_reason: 'superseded_by_source_revision',
      }),
      expect.objectContaining({
        cycle_number: 2,
        start_at: providerUpdatedAt,
        completion_at: null,
        result: null,
        stop_reason: null,
      }),
    ])
    const cycleRows = await pool.query(
      `SELECT cycle_number::int, opened_at
       FROM inbox_handling_cycles
       WHERE inbox_item_id = $1
       ORDER BY cycle_number`,
      [REVIEW_ITEM],
    )
    expect(cycleRows.rows[1]).toMatchObject({
      cycle_number: 2,
      opened_at: observedAt,
    })
    const reminderRows = await pool.query(
      `SELECT cycle_number::int, count(*) FILTER (WHERE cancelled_at IS NOT NULL)::int AS cancelled
       FROM inbox_response_target_reminders
       WHERE inbox_item_id = $1
       GROUP BY cycle_number
       ORDER BY cycle_number`,
      [REVIEW_ITEM],
    )
    expect(reminderRows.rows).toEqual([
      { cycle_number: 1, cancelled: 2 },
      { cycle_number: 2, cancelled: 0 },
    ])
    await expect(
      createResponseTargetStore(db, silentEvents).getGoogleReviewAnalytics({
        organizationId: ORG,
        propertyIds: null,
        now: observedAt,
      }),
    ).resolves.toMatchObject({
      measuredCycleCount: 1,
      activeCount: 1,
      respondedOnTimeCount: 0,
      respondedLateCount: 0,
    })
  })

  it('starts live manual work now even when the imported Review was historical', async () => {
    await seedScope()
    await pool.query(
      `INSERT INTO inbox_response_target_organization_policies (
         organization_id, target_kind, duration_minutes, policy_version,
         updated_by, created_at, updated_at
       ) VALUES ($1, 'google_review_response', 60, 1, $2, $3, $3)`,
      [ORG, MANAGER, OPENED_AT],
    )
    await seedReviewSource(HISTORICAL_REVIEW, 'historical_onboarding', null)
    const item = makeReviewItem(HISTORICAL_ITEM, HISTORICAL_REVIEW)
    const commands = commandStore(db)
    await commands.createItem(item, null, {
      sourceRevision: 1,
      openedReason: 'review_observed',
      actorType: 'provider',
      triggerEventId: null,
      openedAt: new Date('2026-08-28T08:05:00.000Z'),
      responseTarget: {
        reviewAuthority: {
          authority: 'review.current-response-target.v1',
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: HISTORICAL_REVIEW,
          sourceEpoch: 0,
          materialReviewRevision: 1,
          eligibility: 'historical_onboarding',
          responseTargetStartAt: null,
        },
        targetStart: { basis: 'review_provenance' },
      },
    })
    const closedAt = new Date('2026-08-28T09:00:00.000Z')
    const observationEventId = '79000000-0000-4000-8000-000000000099'
    await pool.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id, property_id,
         source_context, source_aggregate_id, created_at
       ) VALUES ($1, 'review.reply.observed', 1, '{}'::jsonb, $2, $3,
                 'review', $4, $5)`,
      [observationEventId, ORG, PROPERTY, HISTORICAL_REVIEW, closedAt],
    )
    await commands.applyReplyObservedOnce({
      eventId: observationEventId,
      consumerName: 'inbox.response-target-historical-test',
      item,
      currentObservation: {
        authority: 'review.current-google-reply-observation.v1',
        organizationId: ORG,
        propertyId: PROPERTY,
        reviewId: HISTORICAL_REVIEW,
        observationRevision: 1,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        sourceEpochCarryFromMaterialReviewRevision: null,
        state: 'live',
        change: 'added',
        resolution: 'external_current_live',
        provenance: 'external_or_unknown',
        matchedReplyId: null,
        matchedPublicationCycle: null,
        observedAt: closedAt,
        reviewSourceContentState: 'active',
        responseTargetEligibility: 'historical_onboarding',
        responseTargetStartAt: null,
      },
      closeFact: inboxItemStatusChanged({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        oldStatus: 'open',
        newStatus: 'closed',
        occurredAt: closedAt,
        source: 'import',
      }),
      reopenFact: inboxItemStatusChanged({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        oldStatus: 'closed',
        newStatus: 'open',
        occurredAt: closedAt,
        source: 'import',
      }),
    })

    const cycleStore = createReviewHandlingCycleStore(db)
    const head = await cycleStore.findHead(HISTORICAL_ITEM, ORG)
    if (!head) throw new Error('historical Review Handling Cycle is missing')
    const reopenedAt = new Date('2026-08-28T11:00:00.000Z')
    await cycleStore.startNext({
      inboxItemId: HISTORICAL_ITEM,
      organizationId: ORG,
      expected: {
        cycleNumber: head.currentCycleNumber,
        materialReviewRevision: head.currentMaterialReviewRevision,
        stateRevision: head.stateRevision,
      },
      materialReviewRevision: 1,
      openedReason: 'manual_reopen',
      manualReopenReason: 'new_information',
      manualReopenExplanation: null,
      openedBy: MANAGER,
      openedAt: reopenedAt,
      responseTarget: {
        reviewAuthority: {
          authority: 'review.current-response-target.v1',
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: HISTORICAL_REVIEW,
          sourceEpoch: 0,
          materialReviewRevision: 1,
          eligibility: 'historical_onboarding',
          responseTargetStartAt: null,
        },
        targetStart: { basis: 'operational_reopen', at: reopenedAt },
      },
    })

    const targets = createResponseTargetStore(db, silentEvents)
    await expect(
      targets.getCycleTarget(HISTORICAL_ITEM, ORG, reopenedAt),
    ).resolves.toMatchObject({
      cycleNumber: 2,
      eligibility: 'measured',
      startAt: reopenedAt,
      dueAt: new Date('2026-08-28T12:00:00.000Z'),
    })
    await expect(
      targets.getGoogleReviewAnalytics({
        organizationId: ORG,
        propertyIds: null,
        now: reopenedAt,
      }),
    ).resolves.toMatchObject({
      measuredCycleCount: 1,
      activeCount: 1,
      reopenCount: 1,
      historicalOnboardingExcludedCount: 1,
    })
  })

  it('ends an ineligible source target without recording a response result', async () => {
    await seedScope()
    await pool.query(
      `INSERT INTO inbox_response_target_organization_policies (
         organization_id, target_kind, duration_minutes, policy_version,
         updated_by, created_at, updated_at
       ) VALUES ($1, 'google_review_response', 60, 1, $2, $3, $3)`,
      [ORG, MANAGER, OPENED_AT],
    )
    const providerStart = new Date('2026-08-28T09:00:00.000Z')
    await seedReviewSource(REVIEW, 'measured', providerStart)
    const item = makeReviewItem()
    const commands = commandStore(db)
    await commands.createItem(item, null, {
      sourceRevision: 1,
      openedReason: 'review_observed',
      actorType: 'provider',
      triggerEventId: null,
      openedAt: OPENED_AT,
      responseTarget: {
        reviewAuthority: {
          authority: 'review.current-response-target.v1',
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: REVIEW,
          sourceEpoch: 0,
          materialReviewRevision: 1,
          eligibility: 'measured',
          responseTargetStartAt: providerStart,
        },
        targetStart: { basis: 'review_provenance' },
      },
    })
    const transitionEventId = '79000000-0000-4000-8000-000000000098'
    await pool.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id, property_id,
         source_context, source_aggregate_id, created_at
       ) VALUES ($1, 'review.source.transitioned', 1, '{}'::jsonb, $2, $3,
                 'review', $4, $5)`,
      [transitionEventId, ORG, PROPERTY, REVIEW, OPENED_AT],
    )
    await commands.applyReviewSourceTransitionedOnce({
      eventId: transitionEventId,
      consumerName: 'inbox.response-target-source-transition-test',
      item,
      transitionedAt: OPENED_AT,
      closeIfOpen: true,
      closeReason: 'source_ineligible',
      closeFact: inboxItemStatusChanged({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        oldStatus: 'open',
        newStatus: 'closed',
        occurredAt: OPENED_AT,
        source: 'import',
      }),
    })

    const rows = await pool.query(
      `SELECT completion_at, result, stop_reason
       FROM inbox_handling_cycle_response_targets
       WHERE inbox_item_id = $1 AND cycle_number = 1`,
      [REVIEW_ITEM],
    )
    expect(rows.rows[0]).toMatchObject({
      completion_at: OPENED_AT,
      result: 'cancelled',
      stop_reason: 'source_ineligible',
    })
    await expect(
      createResponseTargetStore(db, silentEvents).getGoogleReviewAnalytics({
        organizationId: ORG,
        propertyIds: null,
        now: OPENED_AT,
      }),
    ).resolves.toMatchObject({
      measuredCycleCount: 0,
      activeCount: 0,
      respondedOnTimeCount: 0,
      respondedLateCount: 0,
    })
  })

  it('enforces immutable snapshots and excludes cancelled and legacy-unknown cycles from performance', async () => {
    await seedScope({ propertyMinutes: null })
    const targets = createResponseTargetStore(db, silentEvents)
    await db.transaction(async (tx) => {
      const { cancelPrivateFeedbackTarget } = await import('./response-target.store')
      await cancelPrivateFeedbackTarget(
        tx,
        {
          inboxItemId: ITEM,
          organizationId: ORG,
          propertyId: PROPERTY,
          sourceType: 'feedback',
          sourceId: FEEDBACK,
          currentCycleNumber: 1,
          currentSourceRevision: 1,
          stateRevision: 1,
          status: 'open',
        },
        new Date('2026-08-28T09:00:00.000Z'),
      )
    })
    await pool.query(
      `INSERT INTO inbox_items (
         id, organization_id, property_id, source_type, source_id, status,
         source_date, command_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, 'feedback', $4, 'open', $5, 1, $5, $5)`,
      [LEGACY_ITEM, ORG, PROPERTY, LEGACY_FEEDBACK, OPENED_AT],
    )
    await pool.query(
      `INSERT INTO inbox_handling_cycles (
         inbox_item_id, cycle_number, organization_id, property_id,
         source_type, source_id, source_revision, opened_reason, opened_at,
         created_at
       ) VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'legacy_backfill', $5, $5)`,
      [LEGACY_ITEM, ORG, PROPERTY, LEGACY_FEEDBACK, OPENED_AT],
    )
    await pool.query(
      `INSERT INTO inbox_handling_cycle_heads (
         inbox_item_id, organization_id, property_id, source_type, source_id,
         current_source_revision, current_cycle_number, state_revision, status,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'feedback', $4, 1, 1, 1, 'open', $5, $5)`,
      [LEGACY_ITEM, ORG, PROPERTY, LEGACY_FEEDBACK, OPENED_AT],
    )
    await pool.query(
      `INSERT INTO inbox_handling_cycle_response_targets (
         inbox_item_id, cycle_number, organization_id, property_id,
         source_type, source_id, source_revision, target_kind,
         performance_eligibility, created_at, updated_at
       ) VALUES (
         $1, 1, $2, $3, 'feedback', $4, 1,
         'private_feedback_handling', 'legacy_unknown', $5, $5
       )`,
      [LEGACY_ITEM, ORG, PROPERTY, LEGACY_FEEDBACK, OPENED_AT],
    )
    await expect(
      targets.getPrivateFeedbackAnalytics({
        organizationId: ORG,
        propertyIds: [PROPERTY],
        now: new Date('2026-09-01T08:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      measuredCycleCount: 0,
      activeCount: 0,
      currentOverdueCount: 0,
      handledOnTimeCount: 0,
      handledLateCount: 0,
    })
    await expect(
      pool.query(
        `UPDATE inbox_handling_cycle_response_targets
         SET duration_minutes = 60 WHERE inbox_item_id = $1`,
        [ITEM],
      ),
    ).rejects.toThrow('cannot be rewritten')
    await expect(
      pool.query(
        `INSERT INTO inbox_response_target_reminders (
           inbox_item_id, cycle_number, reminder_kind, organization_id,
           property_id, target_kind, scheduled_for
         ) SELECT inbox_item_id, cycle_number, 'halfway', organization_id,
                  property_id, target_kind, start_at
           FROM inbox_handling_cycle_response_targets WHERE inbox_item_id = $1`,
        [ITEM],
      ),
    ).rejects.toThrow('schedule does not match')
    await expect(
      pool.query(
        `INSERT INTO inbox_response_target_reminders (
           inbox_item_id, cycle_number, reminder_kind, organization_id,
           property_id, target_kind, scheduled_for
         ) SELECT inbox_item_id, cycle_number, 'halfway', organization_id,
                  property_id, target_kind,
                  start_at + make_interval(secs => duration_minutes * 30)
           FROM inbox_handling_cycle_response_targets WHERE inbox_item_id = $1`,
        [ITEM],
      ),
    ).rejects.toThrow('duplicate key')
  })

  it('serializes policy creation and fences stale Organization and Property updates', async () => {
    await seedScope()
    const policies = createResponseTargetPolicyStore(db, silentEvents)
    await expect(policies.getPolicySettings(ORG, PROPERTY)).resolves.toEqual({
      organization: {
        googleReviewResponse: {
          targetKind: 'google_review_response',
          durationMinutes: 2_880,
          policySource: 'builtin_default',
          policyVersion: null,
        },
        privateFeedbackHandling: {
          targetKind: 'private_feedback_handling',
          durationMinutes: 2_880,
          policySource: 'builtin_default',
          policyVersion: null,
        },
      },
      privateFeedbackPropertyOverride: {
        propertyId: PROPERTY,
        durationMinutes: null,
        policyVersion: null,
        effectiveDurationMinutes: 2_880,
        effectiveSource: 'builtin_default',
      },
    })
    await expect(
      policies.setOrganizationPolicy({
        organizationId: ORG,
        targetKind: 'private_feedback_handling',
        durationMinutes: null as never,
        expectedPolicyVersion: null,
        actorUserId: MANAGER,
        at: new Date('2026-08-28T09:59:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const organizationCommand = {
      organizationId: ORG,
      targetKind: 'private_feedback_handling' as const,
      durationMinutes: 2_880,
      expectedPolicyVersion: null,
      actorUserId: MANAGER,
      at: new Date('2026-08-28T10:00:00.000Z'),
    }

    const race = await Promise.allSettled([
      policies.setOrganizationPolicy(organizationCommand),
      policies.setOrganizationPolicy(organizationCommand),
    ])
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(race.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const organizationRow = await pool.query(
      `SELECT duration_minutes, policy_version::int
       FROM inbox_response_target_organization_policies
       WHERE organization_id = $1 AND target_kind = 'private_feedback_handling'`,
      [ORG],
    )
    expect(organizationRow.rows).toEqual([{ duration_minutes: 2_880, policy_version: 1 }])

    await expect(
      policies.setPrivateFeedbackPropertyOverride({
        organizationId: ORG,
        propertyId: PROPERTY,
        durationMinutes: 720,
        expectedPolicyVersion: null,
        actorUserId: MANAGER,
        at: new Date('2026-08-28T10:01:00.000Z'),
      }),
    ).resolves.toMatchObject({ durationMinutes: 720, policyVersion: 1 })
    await expect(
      policies.setPrivateFeedbackPropertyOverride({
        organizationId: ORG,
        propertyId: PROPERTY,
        durationMinutes: null,
        expectedPolicyVersion: 1,
        actorUserId: MANAGER,
        at: new Date('2026-08-28T10:02:00.000Z'),
      }),
    ).resolves.toMatchObject({ durationMinutes: null, policyVersion: 2 })
    await expect(
      policies.setPrivateFeedbackPropertyOverride({
        organizationId: ORG,
        propertyId: PROPERTY,
        durationMinutes: 60,
        expectedPolicyVersion: 1,
        actorUserId: MANAGER,
        at: new Date('2026-08-28T10:03:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' })

    const propertyRow = await pool.query(
      `SELECT enabled, duration_minutes, policy_version::int
       FROM inbox_private_feedback_target_property_overrides
       WHERE organization_id = $1 AND property_id = $2`,
      [ORG, PROPERTY],
    )
    expect(propertyRow.rows).toEqual([
      { enabled: false, duration_minutes: null, policy_version: 2 },
    ])
    await expect(policies.getPolicySettings(ORG, PROPERTY)).resolves.toMatchObject({
      organization: {
        privateFeedbackHandling: {
          durationMinutes: 2_880,
          policySource: 'organization_policy',
          policyVersion: 1,
        },
      },
      privateFeedbackPropertyOverride: {
        durationMinutes: null,
        policyVersion: 2,
        effectiveDurationMinutes: 2_880,
        effectiveSource: 'organization_policy',
      },
    })
    const facts = await pool.query(
      `SELECT count(*)::int AS count
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.response_target.policy_changed'`,
      [ORG],
    )
    expect(facts.rows).toEqual([{ count: 3 }])
  })
})
