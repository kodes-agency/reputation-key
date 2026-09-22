// Freshness/delivery gauges against the REAL reads (real PostgreSQL).
//
// The unit suite fakes the select-chain, so it proves the mapping but not the
// SQL. These two aggregates are the whole point of the alerts that sit on
// them, and both express a semantic the DB has to get right:
//
//   sync.oldestDueAgeMs — MIN over PAST-DUE next_incremental_at only, so a
//     property parked in the future can never inflate it.
//   notifications.* — "overdue" is a still-sendable row whose due time (the
//     later of next_attempt_at and not_before, else created_at) has passed;
//     attemptedStuckCount is the subset the delivery path already touched.
//
// Determinism: the scratch database is shared, so every assertion is a DELTA
// over a pre-seed baseline (counts) or a lower bound (MIN ages — a leftover
// older row can only make the age larger, never smaller). Seeded rows carry
// suite-unique markers and are deleted after each test; the integration
// project runs serially (maxWorkers: 1).

import { describe, it, expect, afterEach } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createHealthChecker } from '#/shared/observability/health-metrics'

const MARKER_ORG = 'org-obs-freshness'
const MARKER_SYNC_PROP = 'prop-obs-freshness'
const MARKER_PROP_UUID = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e60'
const DENIED_PROP_UUID = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e61'
const ARCHIVED_PROP_UUID = '3f6f0a2e-0b4f-4c1e-9a71-1d2c3b4a5e62'

const db = getDb()
const checker = createHealthChecker(db)

const MINUTE_MS = 60_000

afterEach(async () => {
  await db.execute(
    sql`DELETE FROM review_sync_state WHERE property_id LIKE ${`${MARKER_SYNC_PROP}%`}`,
  )
  await db.execute(
    sql`DELETE FROM notification_email_queue WHERE organization_id = ${MARKER_ORG}`,
  )
  await db.execute(
    sql`DELETE FROM notification_digest_batches WHERE organization_id = ${MARKER_ORG}`,
  )
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${MARKER_ORG}`)
})

async function seedSyncState(suffix: string, dueMinutesAgo: number | null) {
  const nextIncremental =
    dueMinutesAgo == null
      ? sql`NOW() + INTERVAL '1 day'`
      : sql`NOW() - (${dueMinutesAgo} * INTERVAL '1 minute')`
  await db.execute(sql`
    INSERT INTO review_sync_state (property_id, source, next_incremental_at, updated_at)
    VALUES (${`${MARKER_SYNC_PROP}-${suffix}`}, 'google', ${nextIncremental}, NOW())
  `)
}

describe('sync freshness aggregate (real reads)', () => {
  it('reports the oldest PAST-DUE age and ignores properties parked in the future', async () => {
    const baseline = (await checker.check()).sync

    // A property parked a day out must not register as overdue at all.
    await seedSyncState('future', null)
    const parked = (await checker.check()).sync
    expect(parked.dueForIncrementalCount).toBe(baseline.dueForIncrementalCount)

    await seedSyncState('lagging', 90)
    const lagging = (await checker.check()).sync
    expect(lagging.dueForIncrementalCount).toBe(baseline.dueForIncrementalCount + 1)
    expect(lagging.oldestDueAgeMs).not.toBeNull()
    expect(lagging.oldestDueAgeMs!).toBeGreaterThanOrEqual(89 * MINUTE_MS)

    // MIN semantics: an older overdue row moves the gauge up, a newer one
    // does not move it down.
    await seedSyncState('ancient', 300)
    await seedSyncState('recent', 2)
    const worst = (await checker.check()).sync
    expect(worst.dueForIncrementalCount).toBe(baseline.dueForIncrementalCount + 3)
    expect(worst.oldestDueAgeMs!).toBeGreaterThanOrEqual(299 * MINUTE_MS)
  })
})

async function seedProperty() {
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
    VALUES (${MARKER_PROP_UUID}, ${MARKER_ORG}, 'Freshness Metrics Property', 'obs-freshness', 'UTC', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `)
}

type EmailSeed = Readonly<{
  key: string
  status: string
  /** SQL fragment for next_attempt_at (NULL column when omitted). */
  nextAttempt?: SQL
  /** SQL fragment for not_before (NULL column when omitted). */
  notBefore?: SQL
  attempted?: boolean
}>

async function seedEmail(seed: EmailSeed) {
  await db.execute(sql`
    INSERT INTO notification_email_queue (
      notification_id, user_id, organization_id, property_id,
      category, cadence, status, priority, idempotency_key,
      not_before, next_attempt_at, attempted_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), 'user-obs-freshness', ${MARKER_ORG}, ${MARKER_PROP_UUID},
      'review', 'daily', ${seed.status}, 'normal', ${seed.key},
      ${seed.notBefore ?? sql`NULL`}, ${seed.nextAttempt ?? sql`NULL`},
      ${seed.attempted === true ? sql`NOW() - INTERVAL '25 minutes'` : sql`NULL`},
      NOW(), NOW()
    )
  `)
}

describe('notification email delivery aggregate (real reads)', () => {
  it('counts only overdue pending rows and isolates the already-attempted subset', async () => {
    const baseline = (await checker.check()).notifications
    await seedProperty()

    // Overdue by 3h on next_attempt_at, never attempted.
    await seedEmail({
      key: 'obs-freshness-overdue-unattempted',
      status: 'pending',
      nextAttempt: sql`NOW() - INTERVAL '3 hours'`,
    })
    // Overdue by 30min on not_before, and the delivery path already tried it.
    await seedEmail({
      key: 'obs-freshness-overdue-attempted',
      status: 'pending',
      notBefore: sql`NOW() - INTERVAL '30 minutes'`,
      attempted: true,
    })
    // Held for a future cadence slot — pending but NOT overdue.
    await seedEmail({
      key: 'obs-freshness-not-yet-due',
      status: 'pending',
      notBefore: sql`NOW() + INTERVAL '1 hour'`,
    })
    // Already sent long ago — must never count, whatever its timestamps say.
    await seedEmail({
      key: 'obs-freshness-sent',
      status: 'sent',
      nextAttempt: sql`NOW() - INTERVAL '5 hours'`,
    })

    const after = (await checker.check()).notifications

    expect(after.pendingOverdueCount).toBe(baseline.pendingOverdueCount + 2)
    expect(after.attemptedStuckCount).toBe(baseline.attemptedStuckCount + 1)
    expect(after.oldestPendingOverdueAgeMs).not.toBeNull()
    expect(after.oldestPendingOverdueAgeMs!).toBeGreaterThanOrEqual(179 * MINUTE_MS)
  })

  it('falls back to created_at when a pending row has no schedule at all', async () => {
    const baseline = (await checker.check()).notifications
    await seedProperty()

    // No not_before, no next_attempt_at: the row is due the moment it exists,
    // so created_at is what "overdue" has to be measured from.
    await db.execute(sql`
      INSERT INTO notification_email_queue (
        notification_id, user_id, organization_id, property_id,
        category, cadence, status, priority, idempotency_key,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), 'user-obs-freshness', ${MARKER_ORG}, ${MARKER_PROP_UUID},
        'review', 'urgent', 'pending', 'high', 'obs-freshness-unscheduled',
        NOW() - INTERVAL '4 hours', NOW()
      )
    `)

    const after = (await checker.check()).notifications

    expect(after.pendingOverdueCount).toBe(baseline.pendingOverdueCount + 1)
    expect(after.attemptedStuckCount).toBe(baseline.attemptedStuckCount)
    expect(after.oldestPendingOverdueAgeMs!).toBeGreaterThanOrEqual(239 * MINUTE_MS)
  })
})

type OutcomeSeed = Readonly<{
  key: string
  status: string
  providerState?: string
  lastErrorClass?: string
  retryCount?: number
  providerMessageId?: string
  /** SQL fragments for the outcome clocks (NULL columns when omitted). */
  acceptedAt?: SQL
  failedAt?: SQL
  deliveredAt?: SQL
  bouncedAt?: SQL
}>

async function seedOutcome(seed: OutcomeSeed) {
  await db.execute(sql`
    INSERT INTO notification_email_queue (
      notification_id, user_id, organization_id, property_id,
      category, cadence, status, priority, idempotency_key,
      provider_message_id, provider_state, last_error_class, retry_count,
      accepted_at, failed_at, delivered_at, bounced_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), 'user-obs-freshness', ${MARKER_ORG}, ${MARKER_PROP_UUID},
      'urgent_operational', 'immediate', ${seed.status}, 'urgent', ${seed.key},
      ${seed.providerMessageId ?? null}, ${seed.providerState ?? null},
      ${seed.lastErrorClass ?? null}, ${seed.retryCount ?? 0},
      ${seed.acceptedAt ?? sql`NULL`}, ${seed.failedAt ?? sql`NULL`},
      ${seed.deliveredAt ?? sql`NULL`}, ${seed.bouncedAt ?? sql`NULL`},
      NOW() - INTERVAL '2 days', NOW()
    )
  `)
}

const hoursAgo = (hours: number) => sql`NOW() - (${hours} * INTERVAL '1 hour')`

describe('notification email outcome aggregate (real reads)', () => {
  it('counts refusals, give-ups, bounces, complaints and never-resolved mail in their windows', async () => {
    const baseline = (await checker.check()).notifications.emailOutcomes
    await seedProperty()

    // Accepted inside 24h, still within the 6h feedback grace.
    await seedOutcome({
      key: 'obs-outcome-accepted',
      status: 'accepted',
      providerState: 'accepted',
      providerMessageId: 'provider-accepted',
      acceptedAt: hoursAgo(1),
    })
    // Refused permanently inside the window; an older refusal is outside it.
    await seedOutcome({
      key: 'obs-outcome-permanent',
      status: 'failed',
      lastErrorClass: 'permanent',
      retryCount: 1,
      failedAt: hoursAgo(2),
    })
    await seedOutcome({
      key: 'obs-outcome-permanent-old',
      status: 'failed',
      lastErrorClass: 'permanent',
      retryCount: 1,
      failedAt: hoursAgo(30),
    })
    // Transient failures: two spent the budget (an urgent row left failed, a
    // digest row suppressed after it); one is still under the budget.
    await seedOutcome({
      key: 'obs-outcome-exhausted-failed',
      status: 'failed',
      lastErrorClass: 'transient',
      retryCount: 5,
      failedAt: hoursAgo(3),
    })
    await seedOutcome({
      key: 'obs-outcome-exhausted-suppressed',
      status: 'suppressed',
      lastErrorClass: 'transient',
      retryCount: 5,
      failedAt: hoursAgo(4),
    })
    await seedOutcome({
      key: 'obs-outcome-retrying',
      status: 'failed',
      lastErrorClass: 'transient',
      retryCount: 2,
      failedAt: hoursAgo(1),
    })
    // Provider outcomes the webhook recorded.
    await seedOutcome({
      key: 'obs-outcome-bounced',
      status: 'bounced',
      providerState: 'bounced',
      providerMessageId: 'provider-bounced',
      acceptedAt: hoursAgo(10),
      bouncedAt: hoursAgo(9),
    })
    await seedOutcome({
      key: 'obs-outcome-complained',
      status: 'complained',
      providerState: 'complained',
      providerMessageId: 'provider-complained',
      acceptedAt: hoursAgo(12),
      bouncedAt: hoursAgo(11),
    })
    await seedOutcome({
      key: 'obs-outcome-delivered',
      status: 'delivered',
      providerState: 'delivered',
      providerMessageId: 'provider-delivered',
      acceptedAt: hoursAgo(2),
      deliveredAt: hoursAgo(2),
    })
    // Accepted and never resolved past the grace: one sent, one captured by
    // the non-sending transport; one older than the lookback is ignored.
    await seedOutcome({
      key: 'obs-outcome-unresolved',
      status: 'accepted',
      providerState: 'accepted',
      providerMessageId: 'provider-unresolved',
      acceptedAt: hoursAgo(30),
    })
    await seedOutcome({
      key: 'obs-outcome-unresolved-captured',
      status: 'accepted',
      providerState: 'accepted',
      providerMessageId: 'captured-7',
      acceptedAt: hoursAgo(8),
    })
    await seedOutcome({
      key: 'obs-outcome-unresolved-stale',
      status: 'accepted',
      providerState: 'accepted',
      providerMessageId: 'provider-stale',
      acceptedAt: hoursAgo(8 * 24),
    })

    const after = (await checker.check()).notifications.emailOutcomes

    expect(after.acceptedCount).toBe(baseline.acceptedCount + 5)
    expect(after.permanentFailureCount).toBe(baseline.permanentFailureCount + 1)
    expect(after.retryExhaustedCount).toBe(baseline.retryExhaustedCount + 2)
    expect(after.bouncedCount).toBe(baseline.bouncedCount + 1)
    expect(after.complainedCount).toBe(baseline.complainedCount + 1)
    expect(after.providerOutcomeCount).toBe(baseline.providerOutcomeCount + 3)
    expect(after.acceptedUnresolvedCount).toBe(baseline.acceptedUnresolvedCount + 2)
    expect(after.capturedUnresolvedCount).toBe(baseline.capturedUnresolvedCount + 1)
    expect(after.oldestAcceptedUnresolvedAgeMs!).toBeGreaterThanOrEqual(
      30 * 60 * MINUTE_MS - MINUTE_MS,
    )
  })
})

describe('notification email stall aggregate (real reads)', () => {
  it('counts retries past due and quiet-hours holds past their end as touched overdue rows', async () => {
    const baseline = (await checker.check()).notifications
    await seedProperty()

    // A transient failure whose scheduled retry is 3h overdue.
    await seedEmail({
      key: 'obs-stall-retry-overdue',
      status: 'failed',
      nextAttempt: sql`NOW() - INTERVAL '3 hours'`,
      attempted: true,
    })
    await db.execute(sql`
      UPDATE notification_email_queue
         SET last_error_class = 'transient', retry_count = 2
       WHERE idempotency_key = 'obs-stall-retry-overdue'
    `)
    // A quiet-hours hold that ended 30 minutes ago and was never released.
    await seedEmail({
      key: 'obs-stall-held',
      status: 'delayed',
      notBefore: sql`NOW() - INTERVAL '30 minutes'`,
    })
    // Neither a spent retry budget nor a permanent refusal is still sendable.
    await seedEmail({
      key: 'obs-stall-exhausted',
      status: 'failed',
      nextAttempt: sql`NOW() - INTERVAL '5 hours'`,
      attempted: true,
    })
    await db.execute(sql`
      UPDATE notification_email_queue
         SET last_error_class = 'transient', retry_count = 5
       WHERE idempotency_key = 'obs-stall-exhausted'
    `)
    await seedEmail({
      key: 'obs-stall-permanent',
      status: 'failed',
      attempted: true,
    })
    await db.execute(sql`
      UPDATE notification_email_queue
         SET last_error_class = 'permanent'
       WHERE idempotency_key = 'obs-stall-permanent'
    `)

    const after = (await checker.check()).notifications

    expect(after.pendingOverdueCount).toBe(baseline.pendingOverdueCount + 2)
    expect(after.attemptedStuckCount).toBe(baseline.attemptedStuckCount + 2)
    expect(after.oldestAttemptedStuckAgeMs!).toBeGreaterThanOrEqual(179 * MINUTE_MS)
  })

  it('holds a row until BOTH its retry time and its quiet-hours end have passed', async () => {
    const baseline = (await checker.check()).notifications
    await seedProperty()

    // A transient failure at 21:30 (retry due 21:34), then a quiet-hours hold
    // until 07:00: markDelayed leaves the old next_attempt_at behind, and the
    // sender needs both gates open, so the row is not due before 07:00.
    await seedEmail({
      key: 'obs-stall-held-after-retry',
      status: 'delayed',
      nextAttempt: sql`NOW() - INTERVAL '3 hours'`,
      notBefore: sql`NOW() + INTERVAL '5 hours'`,
      attempted: true,
    })

    const after = (await checker.check()).notifications

    expect(after.pendingOverdueCount).toBe(baseline.pendingOverdueCount)
    expect(after.attemptedStuckCount).toBe(baseline.attemptedStuckCount)
  })
})

type DigestSeed = Omit<OutcomeSeed, 'key'> &
  Readonly<{
    key: string
    /** How many queued notifications the one digest message carried. */
    items: number
    batchState: 'accepted' | 'terminal'
  }>

let digestSequence = 0

/**
 * One daily digest: an immutable batch and its member queue rows, which share
 * the batch's outcome (settleDigestBatch writes every member; a provider event
 * updates every row carrying the message id).
 */
async function seedDigest(seed: DigestSeed) {
  digestSequence += 1
  const batch = await db.execute<{ id: string }>(sql`
    INSERT INTO notification_digest_batches (
      organization_id, user_id, local_date, sequence, member_digest,
      content_digest, provider_idempotency_key, state, provider_message_id,
      created_at, updated_at
    ) VALUES (
      ${MARKER_ORG}, 'user-obs-freshness', CURRENT_DATE, ${digestSequence},
      ${'a'.repeat(64)}, ${'b'.repeat(64)}, ${`obs-digest-${seed.key}`},
      ${seed.batchState}, ${seed.providerMessageId ?? null}, NOW(), NOW()
    ) RETURNING id
  `)
  const batchId = batch.rows[0]!.id
  for (let index = 0; index < seed.items; index += 1) {
    const email = await db.execute<{ id: string }>(sql`
      INSERT INTO notification_email_queue (
        notification_id, user_id, organization_id, property_id,
        category, cadence, status, priority, idempotency_key,
        provider_message_id, provider_state, last_error_class, retry_count,
        accepted_at, failed_at, delivered_at, bounced_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), 'user-obs-freshness', ${MARKER_ORG}, ${MARKER_PROP_UUID},
        'review', 'daily', ${seed.status}, 'normal', ${`${seed.key}-${index}`},
        ${seed.providerMessageId ?? null}, ${seed.providerState ?? null},
        ${seed.lastErrorClass ?? null}, ${seed.retryCount ?? 0},
        ${seed.acceptedAt ?? sql`NULL`}, ${seed.failedAt ?? sql`NULL`},
        ${seed.deliveredAt ?? sql`NULL`}, ${seed.bouncedAt ?? sql`NULL`},
        NOW() - INTERVAL '2 days', NOW()
      ) RETURNING id
    `)
    await db.execute(sql`
      INSERT INTO notification_digest_batch_members (
        batch_id, organization_id, user_id, notification_email_id, sort_index
      ) VALUES (${batchId}, ${MARKER_ORG}, 'user-obs-freshness', ${email.rows[0]!.id}, ${index})
    `)
  }
}

describe('notification email outcomes per provider message (real reads)', () => {
  it('counts a multi-item daily digest once, whatever became of it', async () => {
    const baseline = (await checker.check()).notifications.emailOutcomes
    await seedProperty()

    // One digest of five items hard-bounced: one bounced message, not five.
    await seedDigest({
      key: 'obs-digest-bounced',
      items: 5,
      batchState: 'accepted',
      status: 'bounced',
      providerState: 'bounced',
      providerMessageId: 'provider-digest-bounced',
      acceptedAt: hoursAgo(10),
      bouncedAt: hoursAgo(9),
    })
    // One digest of four items refused for one address.
    await seedDigest({
      key: 'obs-digest-refused',
      items: 4,
      batchState: 'terminal',
      status: 'failed',
      lastErrorClass: 'permanent',
      retryCount: 1,
      failedAt: hoursAgo(2),
    })
    // One digest of three items that spent its retry budget.
    await seedDigest({
      key: 'obs-digest-exhausted',
      items: 3,
      batchState: 'terminal',
      status: 'failed',
      lastErrorClass: 'transient',
      retryCount: 5,
      failedAt: hoursAgo(3),
    })
    // One digest of three items accepted 8h ago with no provider outcome yet.
    await seedDigest({
      key: 'obs-digest-unresolved',
      items: 3,
      batchState: 'accepted',
      status: 'accepted',
      providerState: 'accepted',
      providerMessageId: 'provider-digest-unresolved',
      acceptedAt: hoursAgo(8),
    })

    const after = (await checker.check()).notifications.emailOutcomes

    expect(after.bouncedCount).toBe(baseline.bouncedCount + 1)
    expect(after.acceptedCount).toBe(baseline.acceptedCount + 2)
    expect(after.permanentFailureCount).toBe(baseline.permanentFailureCount + 1)
    expect(after.retryExhaustedCount).toBe(baseline.retryExhaustedCount + 1)
    expect(after.providerOutcomeCount).toBe(baseline.providerOutcomeCount + 1)
    expect(after.acceptedUnresolvedCount).toBe(baseline.acceptedUnresolvedCount + 1)
  })
})

async function seedScopedProperty(id: string, slug: string, lifecycleState: string) {
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, lifecycle_state, created_at, updated_at
    ) VALUES (
      ${id}, ${MARKER_ORG}, 'Freshness Scope Property', ${slug}, 'UTC',
      ${lifecycleState}, NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `)
}

/** A quiet-hours hold that ended three hours ago and was never released. */
async function seedHeldEmail(key: string, propertyId: string) {
  await db.execute(sql`
    INSERT INTO notification_email_queue (
      notification_id, user_id, organization_id, property_id,
      category, cadence, status, priority, idempotency_key,
      not_before, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), 'user-obs-freshness', ${MARKER_ORG}, ${propertyId},
      'urgent_operational', 'immediate', 'delayed', 'urgent', ${key},
      NOW() - INTERVAL '3 hours', NOW() - INTERVAL '10 hours', NOW()
    )
  `)
}

describe('notification email stall scope (real reads)', () => {
  it('counts touched rows only where email may send, on an active Property', async () => {
    await seedProperty()
    await seedScopedProperty(DENIED_PROP_UUID, 'obs-freshness-denied', 'active')
    await seedScopedProperty(ARCHIVED_PROP_UUID, 'obs-freshness-archived', 'archived')
    const scoped = createHealthChecker(db, undefined, {
      // Only this suite's Organization may send, and not on the denied Property
      // (suspended, or outside a Property allowlist).
      isEmailDeliveryAllowed: (scope) =>
        scope.organizationId === MARKER_ORG && scope.propertyId !== DENIED_PROP_UUID,
    })

    await seedHeldEmail('obs-scope-allowed-held', MARKER_PROP_UUID)
    await seedHeldEmail('obs-scope-denied-held', DENIED_PROP_UUID)
    // An archived Property is never visited by the orphan sweep again.
    await seedHeldEmail('obs-scope-archived-held', ARCHIVED_PROP_UUID)
    // An Organization-scoped mandatory notice whose transient retry is 4h late.
    await db.execute(sql`
      INSERT INTO notification_email_queue (
        notification_id, user_id, organization_id, property_id,
        category, cadence, status, priority, idempotency_key,
        last_error_class, retry_count, next_attempt_at, attempted_at,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), 'user-obs-freshness', ${MARKER_ORG}, NULL,
        'mandatory', 'immediate', 'failed', 'urgent', 'obs-scope-org-retry',
        'transient', 2, NOW() - INTERVAL '4 hours', NOW() - INTERVAL '5 hours',
        NOW() - INTERVAL '6 hours', NOW()
      )
    `)

    const after = (await scoped.check()).notifications

    expect(after.attemptedStuckCount).toBe(2)
    expect(after.oldestAttemptedStuckAgeMs!).toBeGreaterThanOrEqual(239 * MINUTE_MS)
    expect(after.oldestAttemptedStuckAgeMs!).toBeLessThan(241 * MINUTE_MS)
  })
})
