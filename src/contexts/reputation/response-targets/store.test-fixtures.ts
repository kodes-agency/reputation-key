// Shared PostgreSQL setup for the Response Target store integration suites: the
// seeded Organization and Property, Review sources, the Review and feedback
// cycle openers, and the repeated policy, outbox and analytics statements.

import { allowAllCommandAuthority } from '#/contexts/reputation/inbox/inbox-test-doubles.test-fixtures'
import type { ReviewCycleTargetAnchor } from '#/contexts/reputation/inbox/review-cycle-target-anchor.server'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus } from '#/contexts/reputation/domain/inbox-types'
import { inboxItemStatusChanged } from '#/contexts/reputation/domain/inbox-events'
import { createAtomicInboxCommandStore as createProductionInboxCommandStore } from '#/contexts/reputation/inbox/command-store.server'
import { createResponseTargetStore } from './store.server'

export const ORG = organizationId('org-response-target-pg-00000000001')
export const PROPERTY = propertyId('79000000-0000-4000-8000-000000000001')
export const ITEM = inboxItemId('79000000-0000-4000-8000-000000000002')
export const FEEDBACK = feedbackId('79000000-0000-4000-8000-000000000003')
export const LEGACY_ITEM = inboxItemId('79000000-0000-4000-8000-000000000030')
export const LEGACY_FEEDBACK = feedbackId('79000000-0000-4000-8000-000000000031')
export const MANAGER = userId('user-response-target-manager-00001')
export const REVIEW_ITEM = inboxItemId('79000000-0000-4000-8000-000000000040')
export const REVIEW = reviewId('79000000-0000-4000-8000-000000000041')
export const HISTORICAL_ITEM = inboxItemId('79000000-0000-4000-8000-000000000042')
export const HISTORICAL_REVIEW = reviewId('79000000-0000-4000-8000-000000000043')
export const UNKNOWN_ITEM = inboxItemId('79000000-0000-4000-8000-000000000044')
export const UNKNOWN_REVIEW = reviewId('79000000-0000-4000-8000-000000000045')
export const LATE_ITEM = inboxItemId('79000000-0000-4000-8000-000000000046')
export const LATE_REVIEW = reviewId('79000000-0000-4000-8000-000000000047')
export const OPENED_AT = new Date('2026-08-28T08:00:00.000Z')
export const PUBLISHED_IN_2015 = new Date('2015-06-01T10:00:00.000Z')

export const db = getDb()
export const pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })

export const commandStore = (database: Database) =>
  createProductionInboxCommandStore(database, allowAllCommandAuthority)

type CommandStore = ReturnType<typeof commandStore>
type ReviewAuthority = NonNullable<ReviewCycleTargetAnchor['reviewAuthority']>
type ReplyObservation = Parameters<
  CommandStore['applyReplyObservedOnce']
>[0]['currentObservation']
type ResponseTargetStore = ReturnType<typeof createResponseTargetStore>

export type ReviewEligibility = 'measured' | 'historical_onboarding' | 'legacy_unknown'
type ReviewId = ReturnType<typeof reviewId>

export const makeItem = (): InboxItem => ({
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

export const makeReviewItem = (id = REVIEW_ITEM, sourceId = REVIEW): InboxItem => ({
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

/** Registers the per-file hooks; every suite file calls this once. */
export function useResponseTargetDatabase(): void {
  beforeAll(async () => {
    const client = await pool.connect()
    client.release()
  })
  afterAll(async () => {
    await clean()
    await pool.end()
  })
  beforeEach(async () => {
    await clean()
  })
}

export async function seedReviewSource(
  sourceId: ReviewId,
  eligibility: ReviewEligibility,
  startAt: Date | null,
): Promise<void> {
  await pool.query(
    `WITH identity AS (
       INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id,
         external_location_id, expires_at, first_fetched_at,
         source_epoch, source_revision, source_observation_sequence,
         analysis_sequence, source_content_state, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'google', $4, 'locations/response-target-test', $6, $5,
         0, 1, 0, 1, 'active', $5, $5
       )
       RETURNING id
     ) INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, content_expires_at,
       first_fetched_at, last_fetched_at, source_epoch, source_revision,
       ai_source_byte_length, ai_source_digest
     ) SELECT id, $2, $3, 'google', $4, 'locations/response-target-test', 4, $5,
       $6, $5, $5, 0, 1, 1, $7 FROM identity`,
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

type AuthorityOptions = Readonly<{
  eligibility?: ReviewEligibility
  startAt?: Date | null
  rating?: number | null
  materialReviewRevision?: number
}>

/** The Review's current response-target authority for a cycle opening. */
export const currentReviewAuthority = (
  sourceId: ReviewId,
  options: AuthorityOptions = {},
): ReviewAuthority => ({
  authority: 'review.current-response-target.v1',
  organizationId: ORG,
  propertyId: PROPERTY,
  reviewId: sourceId,
  sourceEpoch: 0,
  materialReviewRevision: options.materialReviewRevision ?? 1,
  eligibility: options.eligibility ?? 'measured',
  responseTargetStartAt: options.startAt === undefined ? OPENED_AT : options.startAt,
  rating: options.rating ?? null,
})

/** Opens the first Review cycle the way a provider observation does. */
export const openReviewCycle = (
  commands: CommandStore,
  item: InboxItem,
  reviewAuthority: ReviewAuthority,
  openedAt: Date = OPENED_AT,
) =>
  commands.createItem(item, {
    sourceRevision: 1,
    openedReason: 'review_observed',
    actorType: 'provider',
    triggerEventId: null,
    openedAt,
    responseTarget: { reviewAuthority, targetStart: { basis: 'review_provenance' } },
  })

/**
 * The Review projection's path: a measured cycle opened at the instant Review
 * observed the revision, timed from Google's own publication.
 */
export async function projectMeasuredReview(
  id: ReturnType<typeof inboxItemId>,
  sourceId: ReviewId,
  publishedAt: Date,
): Promise<void> {
  await seedReviewSource(sourceId, 'measured', publishedAt)
  await commandStore(db).createItem(makeReviewItem(id, sourceId), {
    sourceRevision: 1,
    openedReason: 'review_observed',
    actorType: 'provider',
    triggerEventId: null,
    openedAt: OPENED_AT,
    responseTarget: {
      reviewAuthority: {
        authority: 'review.inbox-projection-revision.v1',
        organizationId: ORG,
        propertyId: PROPERTY,
        reviewId: sourceId,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        eligibility: 'measured',
        responseTargetStartAt: publishedAt,
        rating: null,
        observedAt: OPENED_AT,
        sourceEpochCarry: false,
      },
      targetStart: { basis: 'review_provenance' },
    },
  })
}

export const releasedReminderKinds = async (
  itemIds: ReadonlyArray<ReturnType<typeof inboxItemId>>,
): Promise<ReadonlyArray<Readonly<{ inbox_item_id: string; reminder_kind: string }>>> =>
  (
    await pool.query<{ inbox_item_id: string; reminder_kind: string }>(
      `SELECT payload->>'inboxItemId' AS inbox_item_id,
              payload->>'reminderKind' AS reminder_kind
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.response_target.reminder_due'
         AND payload->>'inboxItemId' = ANY($2::text[])
       ORDER BY payload->>'scheduledFor'`,
      [ORG, itemIds],
    )
  ).rows

export async function seedOrganizationPolicy(
  input: Readonly<{
    kind: 'google_review_response' | 'private_feedback_handling'
    minutes: number
    version?: number
    lowRating?: Readonly<{ threshold: number; minutes: number }>
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_response_target_organization_policies (
       organization_id, target_kind, duration_minutes, policy_version,
       low_rating_threshold, low_rating_duration_minutes,
       updated_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      ORG,
      input.kind,
      input.minutes,
      input.version ?? 1,
      input.lowRating?.threshold ?? null,
      input.lowRating?.minutes ?? null,
      MANAGER,
      OPENED_AT,
    ],
  )
}

export async function seedOutboxEvent(
  eventType: 'review.reply.observed' | 'review.source.transitioned',
  eventId: string,
  aggregateId: ReviewId,
  at: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id, created_at
     ) VALUES ($1, $2, 1, '{}'::jsonb, $3, $4,
               'review', $5, $6)`,
    [eventId, eventType, ORG, PROPERTY, aggregateId, at],
  )
}

/** An import-sourced status change of an Inbox item at `at`. */
export const importStatusFact = (
  item: InboxItem,
  oldStatus: InboxStatus,
  newStatus: InboxStatus,
  at: Date,
) =>
  inboxItemStatusChanged({
    inboxItemId: item.id,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    oldStatus,
    newStatus,
    occurredAt: at,
    source: 'import',
  })

export const importReplyFacts = (item: InboxItem, at: Date) => ({
  closeFact: importStatusFact(item, 'open', 'closed', at),
  reopenFact: importStatusFact(item, 'closed', 'open', at),
})

export const currentReplyObservation = (
  input: Pick<
    ReplyObservation,
    | 'reviewId'
    | 'resolution'
    | 'provenance'
    | 'observedAt'
    | 'providerReplyUpdatedAt'
    | 'responseTargetEligibility'
    | 'responseTargetStartAt'
  >,
): ReplyObservation => ({
  authority: 'review.current-google-reply-observation.v1',
  organizationId: ORG,
  propertyId: PROPERTY,
  observationRevision: 1,
  sourceEpoch: 0,
  materialReviewRevision: 1,
  sourceEpochCarryFromMaterialReviewRevision: null,
  state: 'live',
  change: 'added',
  matchedReplyId: null,
  matchedPublicationCycle: null,
  reviewSourceContentState: 'active',
  rating: null,
  ...input,
})

export const googleAnalytics = (
  targets: ResponseTargetStore,
  now: Date,
  propertyIds: ReadonlyArray<typeof PROPERTY> | null,
) => targets.getGoogleReviewAnalytics({ organizationId: ORG, propertyIds, now })

export async function seedScope(
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
    await seedOrganizationPolicy({
      kind: 'private_feedback_handling',
      minutes: input.organizationMinutes,
      version: 5,
    })
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
  await commandStore(db).createItem(item, {
    sourceRevision: 1,
    openedReason: 'feedback_submitted',
    actorType: 'guest',
    triggerEventId: null,
    openedAt: OPENED_AT,
  })
  return item
}
