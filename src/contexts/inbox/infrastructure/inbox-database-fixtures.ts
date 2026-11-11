// Seeds Inbox items into a real PostgreSQL database through the same atomic
// item + initial Handling Cycle path production uses. Review items get the
// minimal source identity, content and material revision rows they anchor to.

import type { Pool } from 'pg'
import type { Database } from '#/shared/db'
import type { InboxItem } from '../domain/types'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({ allowed: true })

export async function seedInboxOrganization(
  pool: Pool,
  organizationId: string,
  propertyIds: ReadonlyArray<string>,
): Promise<void> {
  const slug = `t-${organizationId.replace(/-/g, '')}`
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [organizationId, `Test Org ${slug}`, slug],
  )
  for (const propertyId of propertyIds) {
    const propertySlug = `p-${propertyId.replace(/-/g, '')}`
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [propertyId, organizationId, `Test Property ${propertySlug}`, propertySlug],
    )
  }
}

export async function seedInboxItem(
  pool: Pool,
  database: Database,
  item: InboxItem,
  now: () => Date,
): Promise<InboxItem> {
  const store = createAtomicInboxCommandStore(database, allowAllCommandAuthority, now)
  if (item.sourceType === 'feedback') {
    return (
      await store.createItem(item, null, {
        sourceRevision: 1,
        openedReason: 'feedback_submitted',
        actorType: 'guest',
        triggerEventId: null,
        openedAt: item.createdAt,
      })
    ).item
  }

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
      item.sourceId,
      item.organizationId,
      item.propertyId,
      `inbox-fixture-${item.sourceId}`,
      item.sourceDate,
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
    [item.sourceId, item.organizationId, item.propertyId, item.sourceDate],
  )
  return (await store.createItem(item, null, { materialReviewRevision: 1 })).item
}
