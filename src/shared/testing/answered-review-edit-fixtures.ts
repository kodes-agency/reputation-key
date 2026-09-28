// Rows for one Google review that the team answers and the guest then edits,
// shared by the real-PostgreSQL proof that the edit reopens the item
// (src/shared/architecture/answered-review-edit-reopen.integration.test.ts).
//
// Only SQL and identifiers live here. The Review, Inbox and Feed runtime the
// proof drives is wired in the test itself, because test helpers may not
// import context infrastructure.

import type { Pool } from 'pg'
import type { ConsumerEvent } from '#/shared/outbox'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'

export const ANSWERED_EDIT_SCOPE = {
  organizationId: organizationId('org-answered-review-edit'),
  propertyId: propertyId('7e5e0000-0000-4000-8000-000000000001'),
  reviewId: reviewId('7e5e0000-0000-4000-8000-000000000002'),
  itemId: inboxItemId('7e5e0000-0000-4000-8000-000000000003'),
  managerUserId: userId('manager-answered-review-edit'),
} as const

export type AnsweredEditRevision = 1 | 2

/** When Review observed material revision 1, then the guest's edit (2). */
const REVISION_1_AT = new Date('2026-09-01T12:00:00.000Z')
const REVISION_2_AT = new Date('2026-09-10T12:00:00.000Z')

const revisionAt = (revision: AnsweredEditRevision): Date =>
  revision === 1 ? REVISION_1_AT : REVISION_2_AT

export const ANSWERED_EDIT_CLOCK = {
  deliveredAt: new Date('2026-09-20T12:00:00.000Z'),
  contentExpiresAt: new Date('2027-09-01T12:00:00.000Z'),
  revisionObservedAt: (revision: AnsweredEditRevision): Date => revisionAt(revision),
  /** `hours` after Review observed `revision`. */
  hoursAfter: (revision: AnsweredEditRevision, hours: number): Date =>
    new Date(revisionAt(revision).getTime() + hours * 3_600_000),
} as const

/** A committed outbox row as the relay would hand it to a consumer. */
export type RecordedEvent = ConsumerEvent & Readonly<{ payload: Record<string, unknown> }>

const {
  organizationId: ORG,
  propertyId: PROPERTY,
  reviewId: REVIEW,
} = ANSWERED_EDIT_SCOPE

export function answeredEditFixtures(pool: Pool) {
  const q = async (sql: string, values: unknown[] = []) =>
    (await pool.query(sql, values)).rows

  const insertMaterialRevision = (revision: AnsweredEditRevision) =>
    q(
      `INSERT INTO material_review_revisions (
         review_id, revision, organization_id, property_id, source_epoch,
         normalization_version, source_digest, normalized_digest, rating,
         normalized_text, response_target_eligibility, response_target_start_at,
         content_state, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 0, 'review-material-v1', $5, $5, $6, $7,
                 'measured', $8, 'active', $8, $8)`,
      [
        REVIEW,
        revision,
        ORG,
        PROPERTY,
        String(revision).repeat(64),
        revision === 1 ? 5 : 2,
        `revision-${revision}`,
        revisionAt(revision),
      ],
    )

  return {
    async clean(): Promise<void> {
      await q(
        `DELETE FROM event_consumer_receipts
         WHERE event_id IN (SELECT id FROM outbox_events WHERE organization_id = $1)`,
        [ORG],
      )
      await q('DELETE FROM google_reply_observation_heads WHERE organization_id = $1', [
        ORG,
      ])
      await q('DELETE FROM google_reply_observations WHERE organization_id = $1', [ORG])
      for (const table of ['outbox_events', 'inbox_items', 'reviews', 'properties']) {
        await q(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG])
      }
      await deleteTestOrganizations(pool, [ORG])
    },

    /** A five-star review that Review has observed once (revision 1). */
    async seedReview(): Promise<void> {
      const slug = `answered-review-edit-${process.pid}`
      await q(
        `INSERT INTO organization (id, name, slug, "createdAt")
         VALUES ($1, 'Answered edit', $2, NOW())`,
        [ORG, slug],
      )
      await q(
        `INSERT INTO properties (id, organization_id, name, slug, timezone,
           source_epoch, created_at, updated_at)
         VALUES ($1, $2, 'Riverside Hotel', $3, 'UTC', 0, NOW(), NOW())`,
        [PROPERTY, ORG, slug],
      )
      await q(
        `INSERT INTO reviews (
           id, organization_id, property_id, platform, external_id,
           external_location_id, rating, reviewed_at, expires_at, source_created_at,
           source_updated_at, first_fetched_at, last_fetched_at, content_expires_at,
           source_epoch, source_revision, source_observation_sequence,
           analysis_sequence, ai_source_byte_length, ai_source_digest,
           source_content_state, created_at, updated_at
         ) VALUES ($1, $2, $3, 'google', 'answered-edit-review', 'locations/answered-edit',
                   5, $4, $5, $4, $4, $4, $4, $5, 0, 1, 1, 1, 1, $6, 'active', $4, $4)`,
        [
          REVIEW,
          ORG,
          PROPERTY,
          REVISION_1_AT,
          ANSWERED_EDIT_CLOCK.contentExpiresAt,
          'a'.repeat(64),
        ],
      )
      await insertMaterialRevision(1)
    },

    /** The guest edits the review on Google, down to two stars (revision 2). */
    async recordGuestEdit(): Promise<void> {
      await insertMaterialRevision(2)
      await q(
        `UPDATE reviews SET rating = 2, source_revision = 2, source_observation_sequence = 2,
           analysis_sequence = 2, source_updated_at = $2, last_fetched_at = $2
         WHERE id = $1`,
        [REVIEW, REVISION_2_AT],
      )
    },

    /** Review's durable `review.created` (1) or `review.updated` (2) fact. */
    async recordSourceEvent(revision: AnsweredEditRevision): Promise<RecordedEvent> {
      const eventType = revision === 1 ? 'review.created' : 'review.updated'
      const eventId = `7e5e0000-0000-4000-8000-00000000001${revision}`
      const payload = {
        reviewId: REVIEW,
        organizationId: ORG,
        propertyId: PROPERTY,
        platform: 'google',
        sourceEpoch: 0,
        sourceRevision: revision,
        analysisSequence: revision,
        occurredAt: revisionAt(revision).toISOString(),
      }
      await q(
        `INSERT INTO outbox_events (id, event_type, event_version, payload, organization_id,
           property_id, source_context, source_aggregate_id, created_at)
         VALUES ($1, $2, 1, $3::jsonb, $4, $5, 'review', $6, $7)`,
        [
          eventId,
          eventType,
          JSON.stringify(payload),
          ORG,
          PROPERTY,
          REVIEW,
          revisionAt(revision),
        ],
      )
      return {
        eventId,
        eventType,
        eventVersion: 1,
        payload,
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'review',
        sourceAggregateId: REVIEW,
      }
    },

    /** Every committed fact of one type, oldest first. */
    async outboxEvents(eventType: string): Promise<RecordedEvent[]> {
      const rows = await q(
        `SELECT * FROM outbox_events
         WHERE organization_id = $1 AND event_type = $2 ORDER BY created_at, id`,
        [ORG, eventType],
      )
      return rows.map((row) => ({
        eventId: row.id,
        eventType: row.event_type,
        eventVersion: row.event_version,
        payload: row.payload,
        organizationId: row.organization_id,
        propertyId: row.property_id,
        sourceContext: row.source_context,
        sourceAggregateId: row.source_aggregate_id,
      }))
    },

    /** The Inbox item's status and its current Handling Cycle head. */
    async inboxState() {
      const [state] = await q(
        `SELECT i.status AS "itemStatus", h.status AS "cycleStatus",
                h.current_cycle_number::int AS "cycleNumber",
                h.current_source_revision::int AS "sourceRevision"
         FROM inbox_items i
         JOIN inbox_handling_cycle_heads h ON h.inbox_item_id = i.id
         WHERE i.id = $1`,
        [ANSWERED_EDIT_SCOPE.itemId],
      )
      return state
    },
  }
}
