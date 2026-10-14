// Fixtures for integration suites that need an erased Review (a tombstone).
//
// Two kinds of tombstone exist in a database that has run the snapshot sync:
//
//   - a tombstone written by `eraseReviewSourceContent` today, which clears
//     the content clock (`content_expires_at`) with the provider values; and
//   - a tombstone written by the same function BEFORE it cleared the clock,
//     which keeps the fetch clock it had. The closed beta holds one of these
//     (state `provider_deleted`), and no migration repairs it, so every read
//     that selects on the clock has to treat it as erased.
//
// `insertLegacyTombstone` writes the second kind straight into the table, in
// the exact shape the old erase left: provider values NULL, state and erase
// time set, fetch clock and content clock untouched.

import type { Pool } from 'pg'

type Query = Pick<Pool, 'query'>

export type TombstoneState = 'provider_deleted' | 'source_expired'

type ReviewScope = Readonly<{
  id: string
  organizationId: string
  propertyId: string
}>

export type LiveReviewSeed = ReviewScope &
  Readonly<{
    externalId: string
    contentExpiresAt: Date | null
    reviewedAt?: Date
    lastFetchedAt?: Date
    googleConnectionId?: string | null
    externalLocationId?: string
    rating?: number
    text?: string
    sourceRevision?: number
  }>

export type LegacyTombstoneSeed = ReviewScope &
  Readonly<{
    contentExpiresAt: Date | null
    lastFetchedAt: Date
    state?: TombstoneState
    sourceRevision?: number
  }>

const DEFAULT_REVIEWED_AT = new Date('2026-05-01T12:00:00.000Z')
const DEFAULT_LOCATION = 'locations/tombstone-fixtures'
const DIGEST_ZEROES = '0'.repeat(64)

/** An active Review row as the sync stores it: provider values and both clocks set. */
export async function insertLiveReview(db: Query, seed: LiveReviewSeed): Promise<void> {
  const reviewedAt = seed.reviewedAt ?? DEFAULT_REVIEWED_AT
  await db.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, google_connection_id, reviewer_name, rating, text,
       reviewed_at, expires_at, first_fetched_at, last_fetched_at,
       content_expires_at, source_epoch, source_revision, analysis_sequence,
       ai_source_byte_length, ai_source_digest
     ) VALUES (
       $1, $2, $3, 'google', $4, $5, $6, 'Jane Doe', $7, $8,
       $9, $9, $10, $10, $11, 0, $12, 0, 1, $13
     )`,
    [
      seed.id,
      seed.organizationId,
      seed.propertyId,
      seed.externalId,
      seed.externalLocationId ?? DEFAULT_LOCATION,
      seed.googleConnectionId ?? null,
      seed.rating ?? 5,
      seed.text ?? 'A live review',
      reviewedAt,
      seed.lastFetchedAt ?? reviewedAt,
      seed.contentExpiresAt,
      seed.sourceRevision ?? 0,
      DIGEST_ZEROES,
    ],
  )
}

/** A tombstone that kept its content clock: what the erase left before it cleared it. */
export async function insertLegacyTombstone(
  db: Query,
  seed: LegacyTombstoneSeed,
): Promise<void> {
  await db.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, first_fetched_at,
       last_fetched_at, content_expires_at, source_epoch, source_revision,
       analysis_sequence, source_content_state, source_content_erased_at
     ) VALUES (
       $1, $2, $3, 'google', $4, $4, $5, 0, $6, 0, $7, $4
     )`,
    [
      seed.id,
      seed.organizationId,
      seed.propertyId,
      seed.lastFetchedAt,
      seed.contentExpiresAt,
      seed.sourceRevision ?? 0,
      seed.state ?? 'provider_deleted',
    ],
  )
}

/**
 * Turn an existing Review into the same tombstone in place: every provider
 * value cleared, state and erase time set, both fetch clocks left alone. For
 * suites that build a Review's history first (an Inbox item, a Reply) and
 * erase it afterwards, as the sync does.
 */
export async function eraseKeepingContentClock(
  db: Query,
  input: ReviewScope & Readonly<{ state?: TombstoneState }>,
): Promise<void> {
  const erased = await db.query(
    `UPDATE reviews
     SET external_id = NULL, external_location_id = NULL,
         google_connection_id = NULL, reviewer_name = NULL,
         reviewer_profile_photo_url = NULL, rating = NULL, text = NULL,
         translated_text = NULL, language_code = NULL, reviewed_at = NULL,
         expires_at = NULL, source_created_at = NULL, source_updated_at = NULL,
         content_hash = NULL, ai_source_byte_length = NULL,
         ai_source_digest = NULL, source_content_state = $4,
         source_content_erased_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND property_id = $3`,
    [input.id, input.organizationId, input.propertyId, input.state ?? 'provider_deleted'],
  )
  if (erased.rowCount !== 1) {
    throw new Error(`Review ${input.id} was not found, so it could not be erased`)
  }
}
