// Fixtures for the Response Target exclusion ledger (migration 0069): a Property
// with Reviews whose Material Review Revisions Google only restated, and the
// Inbox items, Handling Cycles, Response Targets and reminder slots that
// followed them. Raw SQL on purpose: the tests start from the state the closed
// beta was left in, which no current code path can produce any more.
//
// Integration tests only. Every function takes the test's own pool and writes
// rows for the organization and Property it is given; the caller cleans up with
// `cleanRestatedRevisionScope`.

import type { Pool } from 'pg'
import { deleteTestOrganizations } from './integration-helpers'

const DIGEST = '1'.repeat(64)
const FAR_FUTURE = new Date('2030-01-01T00:00:00.000Z')
const DEFAULT_DURATION_MINUTES = 2880
const MINUTE_MS = 60_000

export type ScopeFixture = Readonly<{
  organizationId: string
  slug: string
  properties: ReadonlyArray<Readonly<{ id: string; name: string; slug: string }>>
  at: Date
}>

export async function seedScope(pool: Pool, scope: ScopeFixture): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, $4)`,
    [scope.organizationId, `Fixture ${scope.slug}`, scope.slug, scope.at],
  )
  for (const property of scope.properties) {
    await pool.query(
      `INSERT INTO properties (
         id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'UTC', 0, $5, $5)`,
      [property.id, scope.organizationId, property.name, property.slug, scope.at],
    )
  }
}

export async function cleanRestatedRevisionScope(
  pool: Pool,
  organizationId: string,
): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [organizationId])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
    organizationId,
  ])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [organizationId])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [organizationId])
  await deleteTestOrganizations(pool, [organizationId])
}

export type RevisionFixture = Readonly<{
  revision: number
  sourceEpoch?: number
  eligibility: 'measured' | 'historical_onboarding'
  startAt: Date | null
}>

export type ObservationFixture = Readonly<{
  sequence: number
  materialRevision: number
  sourceEpoch?: number
  comparison:
    | 'initial_material_revision'
    | 'unchanged'
    | 'material_change'
    | 'normalization_shadow_match'
    | 'out_of_order_ignored'
  /** `null` is an observation whose provider content was erased or never had a time. */
  sourceUpdatedAt: Date | null
  observedAt: Date
}>

export type ReviewFixture = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  revisions: ReadonlyArray<RevisionFixture>
  observations?: ReadonlyArray<ObservationFixture>
  createdAt: Date
}>

/** A Review with its numbered revisions and, optionally, the observations behind them. */
export async function seedReview(pool: Pool, input: ReviewFixture): Promise<void> {
  const newest = input.revisions.reduce((top, one) => Math.max(top, one.revision), 1)
  const lastSequence = (input.observations ?? []).reduce(
    (top, one) => Math.max(top, one.sequence),
    0,
  )
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, 'fixture-location', 4, $5, $6,
               0, $7, $8, 1, 1, $9, 'active', $5, $5)`,
    [
      input.reviewId,
      input.organizationId,
      input.propertyId,
      `external-${input.reviewId}`,
      input.createdAt,
      FAR_FUTURE,
      newest,
      lastSequence,
      '0'.repeat(64),
    ],
  )
  for (const revision of input.revisions) {
    await pool.query(
      `INSERT INTO material_review_revisions (
         review_id, revision, organization_id, property_id, source_epoch,
         normalization_version, source_digest, normalized_digest, rating,
         normalized_text, response_target_eligibility, response_target_start_at,
         content_state, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'review-material-v1', $6, $6, 4,
                 'restated revision fixture', $7, $8, 'active', $9, $9)`,
      [
        input.reviewId,
        revision.revision,
        input.organizationId,
        input.propertyId,
        revision.sourceEpoch ?? 0,
        DIGEST,
        revision.eligibility,
        revision.startAt,
        input.createdAt,
      ],
    )
  }
  for (const observation of input.observations ?? []) {
    await seedObservation(pool, input, observation)
  }
}

async function seedObservation(
  pool: Pool,
  review: ReviewFixture,
  observation: ObservationFixture,
): Promise<void> {
  const key = observation.sequence.toString(16).padStart(64, '0')
  await pool.query(
    `INSERT INTO review_source_observations (
       review_id, observation_sequence, organization_id, property_id, source_epoch,
       observation_key, observation_digest, material_revision, observed_at,
       content_expires_at, source_updated_at, normalization_version,
       source_digest, normalized_digest, comparison_result, rating, original_text,
       reviewed_at, content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, 'review-material-v1',
               $11, $11, $12, 4, 'restated revision fixture', $8, 'active', $8, $8)`,
    [
      review.reviewId,
      observation.sequence,
      review.organizationId,
      review.propertyId,
      observation.sourceEpoch ?? 0,
      key,
      observation.materialRevision,
      observation.observedAt,
      FAR_FUTURE,
      observation.sourceUpdatedAt,
      DIGEST,
      observation.comparison,
    ],
  )
}

export type ReminderFixture = Readonly<{
  kind: 'halfway' | 'target_passed'
  state: 'pending' | 'delivered' | 'cancelled'
}>

export type TargetFixture = Readonly<{
  eligibility: 'measured' | 'historical_onboarding'
  startAt: Date | null
  durationMinutes?: number
  completion?: Readonly<{
    at: Date
    result: 'on_time' | 'late' | 'cancelled'
    stopReason: 'confirmed_on_google' | 'superseded_by_source_revision'
  }>
  reminders?: ReadonlyArray<ReminderFixture>
}>

export type CycleFixture = Readonly<{
  number: number
  revision: number
  openedReason: 'review_observed' | 'material_revision_changed'
  openedAt: Date
  target: TargetFixture
}>

export type InboxItemFixture = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  itemId: string
  status: 'open' | 'closed'
  /** Instant of the item's creation; also its source date. */
  createdAt: Date
  closedAt?: Date
  cycles: ReadonlyArray<CycleFixture>
}>

/** An Inbox item over a Review, its cycles in order, and the head on the last one. */
export async function seedInboxItem(pool: Pool, input: InboxItemFixture): Promise<void> {
  const last = input.cycles.at(-1)
  if (!last) throw new RangeError('An Inbox item fixture needs at least one cycle')
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       source_date, platform, closed_at, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'review', $4, $5, $6, 'google', $7, 1, $6, $6)`,
    [
      input.itemId,
      input.organizationId,
      input.propertyId,
      input.reviewId,
      input.status,
      input.createdAt,
      input.status === 'closed' ? (input.closedAt ?? last.openedAt) : null,
    ],
  )
  for (const cycle of input.cycles) {
    await seedCycle(pool, input, cycle)
  }
  await pool.query(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, source_type, source_id,
       current_source_revision, review_id, current_cycle_number,
       current_material_review_revision, state_revision, status, created_at, updated_at
     ) VALUES ($1, $2, $3, 'review', $4, $5, $4, $6, $5, $7, $8, $9, $9)`,
    [
      input.itemId,
      input.organizationId,
      input.propertyId,
      input.reviewId,
      last.revision,
      last.number,
      last.number,
      input.status,
      last.openedAt,
    ],
  )
}

async function seedCycle(
  pool: Pool,
  item: InboxItemFixture,
  cycle: CycleFixture,
): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, review_id,
       material_review_revision, opened_reason, supersedes_cycle_number,
       opened_at, created_at
     ) VALUES ($1, $2, $3, $4, 'review', $5, $6, $5, $6, $7, $8, $9, $9)`,
    [
      item.itemId,
      cycle.number,
      item.organizationId,
      item.propertyId,
      item.reviewId,
      cycle.revision,
      cycle.openedReason,
      cycle.number === 1 ? null : cycle.number - 1,
      cycle.openedAt,
    ],
  )
  await seedTarget(pool, item, cycle)
}

function dueAtOf(target: TargetFixture): Date | null {
  if (target.eligibility !== 'measured' || target.startAt === null) return null
  const minutes = target.durationMinutes ?? DEFAULT_DURATION_MINUTES
  return new Date(target.startAt.getTime() + minutes * MINUTE_MS)
}

async function seedTarget(
  pool: Pool,
  item: InboxItemFixture,
  cycle: CycleFixture,
): Promise<void> {
  const { target } = cycle
  const measured = target.eligibility === 'measured'
  const duration = measured ? (target.durationMinutes ?? DEFAULT_DURATION_MINUTES) : null
  await pool.query(
    `INSERT INTO inbox_handling_cycle_response_targets (
       inbox_item_id, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, target_kind,
       performance_eligibility, duration_minutes, policy_source, policy_version,
       start_at, due_at, completion_at, result, stop_reason, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'review', $5, $6, 'google_review_response',
               $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
    [
      item.itemId,
      cycle.number,
      item.organizationId,
      item.propertyId,
      item.reviewId,
      cycle.revision,
      target.eligibility,
      duration,
      measured ? 'builtin_default' : null,
      measured ? 1 : null,
      measured ? target.startAt : null,
      dueAtOf(target),
      target.completion?.at ?? null,
      target.completion?.result ?? null,
      target.completion?.stopReason ?? null,
      cycle.openedAt,
    ],
  )
  for (const reminder of target.reminders ?? []) {
    await seedReminder(pool, item, cycle, reminder)
  }
}

async function seedReminder(
  pool: Pool,
  item: InboxItemFixture,
  cycle: CycleFixture,
  reminder: ReminderFixture,
): Promise<void> {
  const { target } = cycle
  const dueAt = dueAtOf(target)
  if (dueAt === null || target.startAt === null) {
    throw new RangeError('A reminder needs a measured target')
  }
  const duration = target.durationMinutes ?? DEFAULT_DURATION_MINUTES
  const scheduledFor =
    reminder.kind === 'target_passed'
      ? dueAt
      : new Date(target.startAt.getTime() + (duration * MINUTE_MS) / 2)
  await pool.query(
    `INSERT INTO inbox_response_target_reminders (
       inbox_item_id, cycle_number, reminder_kind, organization_id, property_id,
       target_kind, scheduled_for, delivered_at, cancelled_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'google_review_response', $6, $7, $8, $9, $9)`,
    [
      item.itemId,
      cycle.number,
      reminder.kind,
      item.organizationId,
      item.propertyId,
      scheduledFor,
      reminder.state === 'delivered' ? scheduledFor : null,
      reminder.state === 'cancelled' ? scheduledFor : null,
      cycle.openedAt,
    ],
  )
}

export const GUEST_UPDATE_TIME = new Date('2026-01-10T09:00:00.000Z')
export const FALSE_REVISION_AT = new Date('2026-10-23T08:00:00.000Z')
const HOUR_MS = 60 * MINUTE_MS

export type RestatedItemFixture = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  itemId: string
  /** How the false cycle ended: still open, or closed by a reply on time or late. */
  outcome: 'open' | 'on_time' | 'late'
  /** The cycle's `target_passed` slot was never released (the default is delivered). */
  targetPassedPending?: boolean
}>

/**
 * The state the closed beta was left in on 2026-10-23: a Review whose revision 2
 * Google only restated (its updateTime did not move), its Inbox item in cycle 2
 * opened as `material_revision_changed`, and a measured Response Target that
 * starts at the old updateTime and so was overdue from birth. Cycle 1 is the
 * onboarding cycle (`historical_onboarding`), as on the beta.
 */
export async function seedRestatedRevisionItem(
  pool: Pool,
  input: RestatedItemFixture,
): Promise<void> {
  await seedReview(pool, {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    reviewId: input.reviewId,
    createdAt: GUEST_UPDATE_TIME,
    revisions: [
      { revision: 1, eligibility: 'historical_onboarding', startAt: null },
      { revision: 2, eligibility: 'measured', startAt: GUEST_UPDATE_TIME },
    ],
    observations: [
      {
        sequence: 1,
        materialRevision: 1,
        comparison: 'initial_material_revision',
        sourceUpdatedAt: GUEST_UPDATE_TIME,
        observedAt: new Date(GUEST_UPDATE_TIME.getTime() + HOUR_MS),
      },
      {
        sequence: 2,
        materialRevision: 2,
        comparison: 'material_change',
        sourceUpdatedAt: GUEST_UPDATE_TIME,
        observedAt: FALSE_REVISION_AT,
      },
    ],
  })
  const completion = completionFor(input.outcome)
  await seedInboxItem(pool, {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    reviewId: input.reviewId,
    itemId: input.itemId,
    status: input.outcome === 'open' ? 'open' : 'closed',
    createdAt: GUEST_UPDATE_TIME,
    closedAt: completion?.at,
    cycles: [
      {
        number: 1,
        revision: 1,
        openedReason: 'review_observed',
        openedAt: GUEST_UPDATE_TIME,
        target: { eligibility: 'historical_onboarding', startAt: null },
      },
      {
        number: 2,
        revision: 2,
        openedReason: 'material_revision_changed',
        openedAt: FALSE_REVISION_AT,
        target: {
          eligibility: 'measured',
          startAt: GUEST_UPDATE_TIME,
          completion,
          reminders: [
            {
              kind: 'target_passed',
              state: input.targetPassedPending
                ? 'pending'
                : input.outcome === 'on_time'
                  ? 'cancelled'
                  : 'delivered',
            },
          ],
        },
      },
    ],
  })
}

function completionFor(
  outcome: RestatedItemFixture['outcome'],
): TargetFixture['completion'] {
  if (outcome === 'open') return undefined
  return {
    at:
      outcome === 'on_time'
        ? new Date(GUEST_UPDATE_TIME.getTime() + 2 * HOUR_MS)
        : new Date(FALSE_REVISION_AT.getTime() + HOUR_MS),
    result: outcome,
    stopReason: 'confirmed_on_google',
  }
}

export type ExclusionFixture = Readonly<{
  organizationId: string
  propertyId: string
  itemId: string
  cycleNumber: number
  operatorId?: string
  ticket?: string | null
  correlationId?: string
}>

/** Record the exclusion of one cycle's Google Response Target, as the operator command does. */
export async function excludeCycle(pool: Pool, input: ExclusionFixture): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_response_target_exclusions (
       organization_id, property_id, inbox_item_id, cycle_number, target_kind,
       reason, correlation_id, operator_id, ticket
     ) VALUES ($1, $2, $3, $4, 'google_review_response', 'provider_restatement',
               COALESCE($5::uuid, gen_random_uuid()), $6, $7)`,
    [
      input.organizationId,
      input.propertyId,
      input.itemId,
      input.cycleNumber,
      input.correlationId ?? null,
      input.operatorId ?? 'operator-fixture',
      input.ticket ?? null,
    ],
  )
}

export type OrdinaryItemFixture = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  itemId: string
  /** Start of the one measured Response Target; due 48 hours later. */
  startAt: Date
  outcome: 'open' | 'late'
  targetPassedPending?: boolean
}>

/** An item no Google restatement touched: one cycle, one measured target. */
export async function seedOrdinaryItem(
  pool: Pool,
  input: OrdinaryItemFixture,
): Promise<void> {
  await seedReview(pool, {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    reviewId: input.reviewId,
    createdAt: input.startAt,
    revisions: [{ revision: 1, eligibility: 'measured', startAt: input.startAt }],
    observations: [
      {
        sequence: 1,
        materialRevision: 1,
        comparison: 'initial_material_revision',
        sourceUpdatedAt: input.startAt,
        observedAt: input.startAt,
      },
    ],
  })
  const lateAt = new Date(input.startAt.getTime() + 60 * HOUR_MS)
  await seedInboxItem(pool, {
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    reviewId: input.reviewId,
    itemId: input.itemId,
    status: input.outcome === 'open' ? 'open' : 'closed',
    createdAt: input.startAt,
    closedAt: input.outcome === 'late' ? lateAt : undefined,
    cycles: [
      {
        number: 1,
        revision: 1,
        openedReason: 'review_observed',
        openedAt: input.startAt,
        target: {
          eligibility: 'measured',
          startAt: input.startAt,
          completion:
            input.outcome === 'late'
              ? { at: lateAt, result: 'late', stopReason: 'confirmed_on_google' }
              : undefined,
          reminders: [
            {
              kind: 'target_passed',
              state: input.targetPassedPending ? 'pending' : 'delivered',
            },
          ],
        },
      },
    ],
  })
}
