import { describe, expect, it } from 'vitest'
import { inboxItemStatusChanged } from '#/contexts/reputation/domain/inbox-events'
import { createFeedbackHandlingStore } from '#/contexts/reputation/inbox/feedback-handling-store.server'
import { releaseDueSlots } from '#/contexts/reputation/response-targets/release-due-slots.test-fixtures'
import { createResponseTargetStore } from './store.server'
import {
  allowAllCommandAuthority,
  commandStore,
  db,
  ITEM,
  MANAGER,
  OPENED_AT,
  ORG,
  pool,
  PROPERTY,
  releasedReminderKinds,
  seedScope,
  useResponseTargetDatabase,
} from './store.test-fixtures'

useResponseTargetDatabase()

describe.sequential('Inbox Response Target store (PostgreSQL)', () => {
  it('snapshots Property policy, records approved handling timing, and preserves it across correction and reopen', async () => {
    const item = await seedScope({
      organizationMinutes: 2_880,
      propertyMinutes: 720,
    })
    const targets = createResponseTargetStore(db)
    const handling = createFeedbackHandlingStore(db, allowAllCommandAuthority)

    await expect(targets.getCycleTarget(ITEM, ORG, OPENED_AT)).resolves.toMatchObject({
      cycleNumber: 1,
      targetKind: 'private_feedback_handling',
      durationMinutes: 720,
      policySource: 'property_override',
      policyVersion: 9,
      startAt: OPENED_AT,
      dueAt: new Date('2026-08-28T20:00:00.000Z'),
      propertyTimezone: 'America/New_York',
      excludedFromReporting: false,
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
    const targets = createResponseTargetStore(db)
    const halfway = new Date('2026-08-29T08:00:00.000Z')

    const halfwayRace = await Promise.all([
      releaseDueSlots(targets, { now: halfway, limit: 10 }),
      releaseDueSlots(targets, { now: halfway, limit: 10 }),
    ])
    expect(halfwayRace.reduce((sum, result) => sum + result.released, 0)).toBe(1)
    await expect(releaseDueSlots(targets, { now: halfway, limit: 10 })).resolves.toEqual({
      released: 0,
    })

    const dueAt = new Date('2026-08-30T08:00:00.000Z')
    await expect(releaseDueSlots(targets, { now: dueAt, limit: 10 })).resolves.toEqual({
      released: 1,
    })
    await expect(
      releaseDueSlots(targets, { now: new Date('2026-09-02T08:00:00Z'), limit: 10 }),
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

  it('releases only the target-passed reminder when halfway and target-passed fall due together', async () => {
    await seedScope({ organizationMinutes: 2_880 })
    const targets = createResponseTargetStore(db)
    // No release ran between halfway (08-29 08:00) and the target (08-30 08:00).
    const lateRelease = new Date('2026-08-30T09:00:00.000Z')

    await expect(
      releaseDueSlots(targets, { now: lateRelease, limit: 10 }),
    ).resolves.toEqual({ released: 1 })
    await expect(
      releaseDueSlots(targets, { now: new Date('2026-09-02T08:00:00Z'), limit: 10 }),
    ).resolves.toEqual({ released: 0 })

    expect(await releasedReminderKinds([ITEM])).toEqual([
      { inbox_item_id: ITEM, reminder_kind: 'target_passed' },
    ])
    const slots = await pool.query(
      `SELECT reminder_kind, delivered_at, cancelled_at
       FROM inbox_response_target_reminders
       WHERE inbox_item_id = $1 ORDER BY scheduled_for`,
      [ITEM],
    )
    expect(slots.rows).toEqual([
      { reminder_kind: 'halfway', delivered_at: null, cancelled_at: lateRelease },
      { reminder_kind: 'target_passed', delivered_at: lateRelease, cancelled_at: null },
    ])
  })

  it('never releases a superseded halfway reminder when the batch limit splits the pair', async () => {
    await seedScope({ organizationMinutes: 2_880 })
    const targets = createResponseTargetStore(db)
    const lateRelease = new Date('2026-08-30T09:00:00.000Z')

    // A one-slot batch holds only the earlier halfway slot; the next pass
    // owns the target-passed slot.
    await expect(
      releaseDueSlots(targets, { now: lateRelease, limit: 1 }),
    ).resolves.toEqual({ released: 0 })
    await expect(
      releaseDueSlots(targets, { now: lateRelease, limit: 1 }),
    ).resolves.toEqual({ released: 1 })

    expect(await releasedReminderKinds([ITEM])).toEqual([
      { inbox_item_id: ITEM, reminder_kind: 'target_passed' },
    ])
  })
})
