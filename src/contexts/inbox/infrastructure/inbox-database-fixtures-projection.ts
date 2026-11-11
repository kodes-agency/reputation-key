// Seeds the Review source rows an Inbox item anchors to, without an Inbox item,
// for tests of the projection rebuild that create the item themselves.

import type { Pool } from 'pg'

export type ReviewSourceSeed = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  sourceDate: Date
}>

export async function seedReviewSource(
  pool: Pool,
  source: ReviewSourceSeed,
): Promise<void> {
  await pool.query(
    `WITH identity AS (
       INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id,
         external_location_id, expires_at, first_fetched_at,
         source_epoch, source_revision, source_observation_sequence,
         analysis_sequence, source_content_state, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'google', $4, 'locations/inbox-fixture',
         $5::timestamptz + INTERVAL '1 year', $5::timestamptz,
         0, 1, 0, 1, 'active', $5::timestamptz, $5::timestamptz
       ) ON CONFLICT (id) DO NOTHING
       RETURNING id
     ) INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, content_expires_at,
       first_fetched_at, last_fetched_at, source_epoch, source_revision,
       ai_source_byte_length, ai_source_digest
     ) SELECT id, $2, $3, 'google', $4, 'locations/inbox-fixture',
       4, $5::timestamptz, $5::timestamptz + INTERVAL '1 year',
       $5::timestamptz, $5::timestamptz, 0, 1, 1, repeat('a', 64)
       FROM identity`,
    [
      source.id,
      source.organizationId,
      source.propertyId,
      `inbox-fixture-${source.id}`,
      source.sourceDate,
    ],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', repeat('b', 64),
       repeat('b', 64), 4, 'fixture', 'active', $4, $4
     ) ON CONFLICT (review_id, revision) DO NOTHING`,
    [source.id, source.organizationId, source.propertyId, source.sourceDate],
  )
}
