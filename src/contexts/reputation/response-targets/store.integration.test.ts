import { reviewOpeningAnchor } from '../inbox/review-opening-anchor.test-fixtures'
import { describe, expect, it } from 'vitest'
import { openNextReviewCycleForTest } from '#/contexts/reputation/inbox/review-cycle-reopen.test-fixtures'
import { releaseDueSlots } from '#/contexts/reputation/response-targets/release-due-slots.test-fixtures'
import { getDb } from '#/shared/db'
import { createResponseTargetStore } from './store.server'
import { completeGoogleReviewTarget } from '#/contexts/reputation/response-targets/google-review-target-completion.server'
import { createReviewHandlingCycleStore } from '#/contexts/reputation/inbox/review-handling-cycle-store.server'
import {
  commandStore,
  currentReplyObservation,
  currentReviewAuthority,
  db,
  googleAnalytics,
  HISTORICAL_ITEM,
  HISTORICAL_REVIEW,
  importReplyFacts,
  importStatusFact,
  LATE_ITEM,
  LATE_REVIEW,
  makeReviewItem,
  MANAGER,
  OPENED_AT,
  openReviewCycle,
  ORG,
  pool,
  projectMeasuredReview,
  PROPERTY,
  PUBLISHED_IN_2015,
  releasedReminderKinds,
  REVIEW,
  REVIEW_ITEM,
  seedOrganizationPolicy,
  seedOutboxEvent,
  seedReviewSource,
  seedScope,
  UNKNOWN_ITEM,
  UNKNOWN_REVIEW,
  useResponseTargetDatabase,
} from './store.test-fixtures'

useResponseTargetDatabase()

describe.sequential('Inbox Response Target store (PostgreSQL)', () => {
  it('gives a low-rated Google review the shorter target its Organization set', async () => {
    await seedScope()
    // Two days ordinarily; four hours at or below two stars.
    await seedOrganizationPolicy({
      kind: 'google_review_response',
      minutes: 2880,
      lowRating: { threshold: 2, minutes: 240 },
    })
    await seedReviewSource(REVIEW, 'measured', OPENED_AT)
    await seedReviewSource(HISTORICAL_REVIEW, 'measured', OPENED_AT)
    const store = commandStore(db)

    await openReviewCycle(
      store,
      makeReviewItem(),
      currentReviewAuthority(REVIEW, { rating: 1 }),
    )
    await openReviewCycle(
      store,
      makeReviewItem(HISTORICAL_ITEM, HISTORICAL_REVIEW),
      currentReviewAuthority(HISTORICAL_REVIEW, { rating: 4 }),
    )

    const targets = createResponseTargetStore(db)
    // The one-star review is due in four hours, so its halfway prompt lands
    // two hours in rather than a day in.
    await expect(
      targets.getCycleTarget(REVIEW_ITEM, ORG, OPENED_AT),
    ).resolves.toMatchObject({
      durationMinutes: 240,
      policySource: 'organization_policy',
      dueAt: new Date('2026-08-28T12:00:00.000Z'),
    })
    // The four-star one keeps the ordinary two days.
    await expect(
      targets.getCycleTarget(HISTORICAL_ITEM, ORG, OPENED_AT),
    ).resolves.toMatchObject({
      durationMinutes: 2_880,
      policySource: 'organization_policy',
      dueAt: new Date('2026-08-30T08:00:00.000Z'),
    })
    const { rows } = await pool.query<{ scheduled_for: Date }>(
      `SELECT scheduled_for FROM inbox_response_target_reminders
        WHERE inbox_item_id = $1 AND reminder_kind = 'halfway'`,
      [REVIEW_ITEM],
    )
    expect(rows[0]?.scheduled_for).toEqual(new Date('2026-08-28T10:00:00.000Z'))
  })

  it('measures Google response time while explicitly excluding historical and unknown cycles', async () => {
    await seedScope()
    await seedOrganizationPolicy({ kind: 'google_review_response', minutes: 60 })
    await seedReviewSource(REVIEW, 'measured', OPENED_AT)
    await seedReviewSource(HISTORICAL_REVIEW, 'historical_onboarding', null)
    await seedReviewSource(UNKNOWN_REVIEW, 'legacy_unknown', null)
    const store = commandStore(db)
    await openReviewCycle(store, makeReviewItem(), currentReviewAuthority(REVIEW))
    await openReviewCycle(
      store,
      makeReviewItem(HISTORICAL_ITEM, HISTORICAL_REVIEW),
      currentReviewAuthority(HISTORICAL_REVIEW, {
        eligibility: 'historical_onboarding',
        startAt: null,
      }),
    )
    await store.createItem(
      makeReviewItem(UNKNOWN_ITEM, UNKNOWN_REVIEW),
      reviewOpeningAnchor(makeReviewItem(UNKNOWN_ITEM, UNKNOWN_REVIEW)),
    )

    const targets = createResponseTargetStore(db)
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

    const head = await createReviewHandlingCycleStore(db).findHead(REVIEW_ITEM, ORG)
    if (!head) throw new Error('measured Review Handling Cycle was not created')
    const completedAt = new Date('2026-08-28T08:45:00.000Z')
    await expect(
      db.transaction((tx) => completeGoogleReviewTarget(tx, head, completedAt)),
    ).resolves.toEqual({ result: 'on_time', completedAt })
    await expect(
      targets.getCycleTarget(REVIEW_ITEM, ORG, completedAt),
    ).resolves.toMatchObject({
      completionAt: completedAt,
      result: 'on_time',
      stopReason: 'confirmed_on_google',
    })
    await expect(googleAnalytics(targets, completedAt, [PROPERTY])).resolves.toEqual({
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

  it("completes a Google-confirmed RepKey reply at Google's reply time and feeds the average from it", async () => {
    await seedScope()
    await projectMeasuredReview(REVIEW_ITEM, REVIEW, OPENED_AT)
    const observedAt = new Date('2026-08-28T12:00:00.000Z')
    const providerReplyUpdatedAt = new Date('2026-08-28T08:20:00.000Z')
    const eventId = '79000000-0000-4000-8000-000000000098'
    await seedOutboxEvent('review.reply.observed', eventId, REVIEW, observedAt)
    const item = makeReviewItem(REVIEW_ITEM, REVIEW)
    await commandStore(db).applyReplyObservedOnce({
      eventId,
      consumerName: 'inbox.response-target-google-time-test',
      item,
      currentObservation: currentReplyObservation({
        reviewId: REVIEW,
        resolution: 'confirmed_on_google',
        provenance: 'repkey_confirmed',
        observedAt,
        providerReplyUpdatedAt,
        responseTargetEligibility: 'measured',
        responseTargetStartAt: OPENED_AT,
      }),
      ...importReplyFacts(item, observedAt),
    })

    const targets = createResponseTargetStore(db)
    await expect(
      targets.getCycleTarget(REVIEW_ITEM, ORG, observedAt),
    ).resolves.toMatchObject({
      completionAt: providerReplyUpdatedAt,
      result: 'on_time',
      stopReason: 'confirmed_on_google',
    })
    await expect(googleAnalytics(targets, observedAt, [PROPERTY])).resolves.toMatchObject(
      {
        respondedOnTimeCount: 1,
        averageTimeToResponseMinutes: 20,
      },
    )
  })

  it('never stops a Google target before it started, however early Google dates the reply', async () => {
    await seedScope()
    await projectMeasuredReview(REVIEW_ITEM, REVIEW, OPENED_AT)
    const head = await createReviewHandlingCycleStore(db).findHead(REVIEW_ITEM, ORG)
    if (!head) throw new Error('measured Review Handling Cycle was not created')
    const observedAt = new Date('2026-08-28T12:00:00.000Z')

    await expect(
      db.transaction((tx) =>
        completeGoogleReviewTarget(
          tx,
          head,
          observedAt,
          new Date(OPENED_AT.getTime() - 60 * 60_000),
        ),
      ),
    ).resolves.toEqual({ result: 'on_time', completedAt: OPENED_AT })

    await expect(
      createResponseTargetStore(db).getCycleTarget(REVIEW_ITEM, ORG, observedAt),
    ).resolves.toMatchObject({ completionAt: OPENED_AT, result: 'on_time' })
  })

  it('prompts once, with target passed, for a Review target already passed when it was snapshotted', async () => {
    await seedScope()
    // First observed at OPENED_AT: one Review Google published in 2015, and
    // one published 30 hours earlier, whose halfway has passed but whose
    // target has not.
    await projectMeasuredReview(REVIEW_ITEM, REVIEW, PUBLISHED_IN_2015)
    await projectMeasuredReview(
      LATE_ITEM,
      LATE_REVIEW,
      new Date('2026-08-27T02:00:00.000Z'),
    )
    const targets = createResponseTargetStore(db)

    // The snapshot stays honest: the old Review is measured, and overdue.
    await expect(
      targets.getCycleTarget(REVIEW_ITEM, ORG, OPENED_AT),
    ).resolves.toMatchObject({
      eligibility: 'measured',
      startAt: PUBLISHED_IN_2015,
      dueAt: new Date('2015-06-03T10:00:00.000Z'),
      evaluation: { state: 'active', overdue: true },
    })
    const slots = await pool.query(
      `SELECT inbox_item_id, reminder_kind, scheduled_for
       FROM inbox_response_target_reminders
       WHERE inbox_item_id = ANY($1::uuid[])
       ORDER BY scheduled_for`,
      [[REVIEW_ITEM, LATE_ITEM]],
    )
    // A slot already due when the target is recorded keeps its snapshot
    // instant; only the halfway prompts that are already due are left out.
    expect(slots.rows).toEqual([
      {
        inbox_item_id: REVIEW_ITEM,
        reminder_kind: 'target_passed',
        scheduled_for: new Date('2015-06-03T10:00:00.000Z'),
      },
      {
        inbox_item_id: LATE_ITEM,
        reminder_kind: 'target_passed',
        scheduled_for: new Date('2026-08-29T02:00:00.000Z'),
      },
    ])

    await expect(
      releaseDueSlots(targets, { now: OPENED_AT, limit: 100 }),
    ).resolves.toEqual({ released: 1 })
    await expect(
      releaseDueSlots(targets, {
        now: new Date('2026-08-29T02:00:00.000Z'),
        limit: 100,
      }),
    ).resolves.toEqual({ released: 1 })
    expect(await releasedReminderKinds([REVIEW_ITEM, LATE_ITEM])).toEqual([
      { inbox_item_id: REVIEW_ITEM, reminder_kind: 'target_passed' },
      { inbox_item_id: LATE_ITEM, reminder_kind: 'target_passed' },
    ])

    // Performance never depended on reminder slots: both cycles are measured
    // and the 2015 one still counts as overdue.
    await expect(googleAnalytics(targets, OPENED_AT, [PROPERTY])).resolves.toMatchObject({
      measuredCycleCount: 2,
      activeCount: 2,
      currentOverdueCount: 1,
    })
  })

  it('terminalizes a superseded target while keeping the new cycle on provider timing', async () => {
    await seedScope()
    await seedOrganizationPolicy({ kind: 'google_review_response', minutes: 60 })
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
    await openReviewCycle(
      commandStore(db),
      makeReviewItem(),
      currentReviewAuthority(REVIEW),
      new Date('2026-08-28T08:05:00.000Z'),
    )

    const cycleStore = createReviewHandlingCycleStore(db)
    const head = await cycleStore.findHead(REVIEW_ITEM, ORG)
    if (!head) throw new Error('seeded Review Handling Cycle is missing')
    await openNextReviewCycleForTest(getDb(), {
      inboxItemId: REVIEW_ITEM,
      organizationId: ORG,
      materialReviewRevision: 2,
      openedReason: 'material_revision_changed',
      openedBy: null,
      openedAt: observedAt,
      responseTarget: {
        reviewAuthority: currentReviewAuthority(REVIEW, {
          materialReviewRevision: 2,
          startAt: providerUpdatedAt,
        }),
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
      googleAnalytics(createResponseTargetStore(db), observedAt, null),
    ).resolves.toMatchObject({
      measuredCycleCount: 1,
      activeCount: 1,
      respondedOnTimeCount: 0,
      respondedLateCount: 0,
    })
  })

  it('starts live manual work now even when the imported Review was historical', async () => {
    await seedScope()
    await seedOrganizationPolicy({ kind: 'google_review_response', minutes: 60 })
    await seedReviewSource(HISTORICAL_REVIEW, 'historical_onboarding', null)
    const item = makeReviewItem(HISTORICAL_ITEM, HISTORICAL_REVIEW)
    const commands = commandStore(db)
    const historicalAuthority = currentReviewAuthority(HISTORICAL_REVIEW, {
      eligibility: 'historical_onboarding',
      startAt: null,
    })
    await openReviewCycle(
      commands,
      item,
      historicalAuthority,
      new Date('2026-08-28T08:05:00.000Z'),
    )
    const closedAt = new Date('2026-08-28T09:00:00.000Z')
    const observationEventId = '79000000-0000-4000-8000-000000000099'
    await seedOutboxEvent(
      'review.reply.observed',
      observationEventId,
      HISTORICAL_REVIEW,
      closedAt,
    )
    await commands.applyReplyObservedOnce({
      eventId: observationEventId,
      consumerName: 'inbox.response-target-historical-test',
      item,
      currentObservation: currentReplyObservation({
        reviewId: HISTORICAL_REVIEW,
        resolution: 'external_current_live',
        provenance: 'external_or_unknown',
        observedAt: closedAt,
        providerReplyUpdatedAt: null,
        responseTargetEligibility: 'historical_onboarding',
        responseTargetStartAt: null,
      }),
      ...importReplyFacts(item, closedAt),
    })

    const cycleStore = createReviewHandlingCycleStore(db)
    const head = await cycleStore.findHead(HISTORICAL_ITEM, ORG)
    if (!head) throw new Error('historical Review Handling Cycle is missing')
    const reopenedAt = new Date('2026-08-28T11:00:00.000Z')
    await openNextReviewCycleForTest(getDb(), {
      inboxItemId: HISTORICAL_ITEM,
      organizationId: ORG,
      materialReviewRevision: 1,
      openedReason: 'manual_reopen',
      manualReopenReason: 'new_information',
      manualReopenExplanation: null,
      openedBy: MANAGER,
      openedAt: reopenedAt,
      responseTarget: {
        reviewAuthority: historicalAuthority,
        targetStart: { basis: 'operational_reopen', at: reopenedAt },
      },
    })

    const targets = createResponseTargetStore(db)
    await expect(
      targets.getCycleTarget(HISTORICAL_ITEM, ORG, reopenedAt),
    ).resolves.toMatchObject({
      cycleNumber: 2,
      eligibility: 'measured',
      startAt: reopenedAt,
      dueAt: new Date('2026-08-28T12:00:00.000Z'),
    })
    await expect(googleAnalytics(targets, reopenedAt, null)).resolves.toMatchObject({
      measuredCycleCount: 1,
      activeCount: 1,
      reopenCount: 1,
      historicalOnboardingExcludedCount: 1,
    })
  })

  it('ends an ineligible source target without recording a response result', async () => {
    await seedScope()
    await seedOrganizationPolicy({ kind: 'google_review_response', minutes: 60 })
    const providerStart = new Date('2026-08-28T09:00:00.000Z')
    await seedReviewSource(REVIEW, 'measured', providerStart)
    const item = makeReviewItem()
    const commands = commandStore(db)
    await openReviewCycle(
      commands,
      item,
      currentReviewAuthority(REVIEW, { startAt: providerStart }),
    )
    const transitionEventId = '79000000-0000-4000-8000-000000000098'
    await seedOutboxEvent(
      'review.source.transitioned',
      transitionEventId,
      REVIEW,
      OPENED_AT,
    )
    await commands.applyReviewSourceTransitionedOnce({
      eventId: transitionEventId,
      consumerName: 'inbox.response-target-source-transition-test',
      item,
      transitionedAt: OPENED_AT,
      closeFact: importStatusFact(item, 'open', 'closed', OPENED_AT),
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
      googleAnalytics(createResponseTargetStore(db), OPENED_AT, null),
    ).resolves.toMatchObject({
      measuredCycleCount: 0,
      activeCount: 0,
      respondedOnTimeCount: 0,
      respondedLateCount: 0,
    })
  })
})
