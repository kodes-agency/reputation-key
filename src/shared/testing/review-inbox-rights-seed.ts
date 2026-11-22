// Review, reply, template and Inbox rows for the Review and Inbox rights
// executor suites. The planted marker texts are parameters: the export tests
// grep for them, so no builder supplies a default.

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'

type SeedPool = Pick<Pool, 'query'>

export async function insertReviewWithSourceContent(
  pool: SeedPool,
  input: Readonly<{
    reviewId: string
    organizationId: string
    propertyId: string
    reviewerName: string
    text: string
    digest: string
    at: Date
    expiresAt: Date
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, external_location_id,
       expires_at, source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, source_content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, 'locations/rights', $6, 0, 1, 1, 1, 'active', $5, $5)`,
    [
      input.reviewId,
      input.organizationId,
      input.propertyId,
      `external-${input.reviewId}`,
      input.at,
      input.expiresAt,
    ],
  )
  await pool.query(
    `INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id, external_location_id,
       reviewer_name, rating, text, language_code, reviewed_at, last_fetched_at,
       content_expires_at, source_epoch, source_revision, ai_source_byte_length,
       ai_source_digest)
     VALUES ($1, $2, $3, 'google', $4, 'locations/rights', $5, 4, $6, 'en', $7, $7, $8,
             0, 1, 24, $9)`,
    [
      input.reviewId,
      input.organizationId,
      input.propertyId,
      `external-${input.reviewId}`,
      input.reviewerName,
      input.text,
      input.at,
      input.expiresAt,
      input.digest,
    ],
  )
}

export async function insertReply(
  pool: SeedPool,
  input: Readonly<{
    id: string
    reviewId: string
    organizationId: string
    text: string
    source: 'internal' | 'google_sync'
    status: string
    publicationState: string
    userId: string
    at: Date
  }>,
): Promise<void> {
  const isInternal = input.source === 'internal'
  await pool.query(
    `INSERT INTO replies (
       id, review_id, organization_id, text, status, source, created_by, submitted_by,
       approved_by, authorship, publication_state, publication_cycle, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $8, $5, $6, $6, $6, $10, $7, 1, $9, $9)`,
    [
      input.id,
      input.reviewId,
      input.organizationId,
      input.text,
      input.source,
      isInternal ? input.userId : null,
      input.publicationState,
      input.status,
      input.at,
      isInternal ? 'human' : null,
    ],
  )
}

export async function insertOrganizationReplyVoice(
  pool: SeedPool,
  input: Readonly<{ organizationId: string; contact: string; userId: string }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO organization_reply_voices (organization_id, contact, overridden_fields, updated_by)
     VALUES ($1, $2, ARRAY['contact'], $3)`,
    [input.organizationId, input.contact, input.userId],
  )
}

export async function insertReplyTemplate(
  pool: SeedPool,
  input: Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    body: string
  }>,
): Promise<void> {
  const templateId = randomUUID()
  const revisionId = randomUUID()
  await pool.query(
    `INSERT INTO reply_templates (id, organization_id, property_id, builtin_key, created_by, updated_by)
     VALUES ($1, $2, $3, 'P-GEN', $4, $4)`,
    [templateId, input.organizationId, input.propertyId, input.userId],
  )
  await pool.query(
    `INSERT INTO reply_template_revisions (id, template_id, number, title, stars_min, stars_max, review_kind, created_by)
     VALUES ($1, $2, 1, 'Greeting', 4, 5, 'text', $3)`,
    [revisionId, templateId, input.userId],
  )
  await pool.query(
    `INSERT INTO reply_template_wordings (revision_id, wording_key, language_group, body)
     VALUES ($1, 'one', 'en-Latn', $2)`,
    [revisionId, input.body],
  )
  await pool.query(`UPDATE reply_templates SET current_revision_id = $1 WHERE id = $2`, [
    revisionId,
    templateId,
  ])
}

export async function insertInboxItemWithNote(
  pool: SeedPool,
  input: Readonly<{
    itemId: string
    organizationId: string
    propertyId: string
    userId: string
    snippet: string
    reviewerName: string
    noteText: string
    at: Date
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status, rating,
       snippet, reviewer_name, source_date, platform, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 'open', 2, $5, $6, $7, 'portal', 1, $7, $7)`,
    [
      input.itemId,
      input.organizationId,
      input.propertyId,
      randomUUID(),
      input.snippet,
      input.reviewerName,
      input.at,
    ],
  )
  await pool.query(
    `INSERT INTO inbox_notes (id, organization_id, inbox_item_id, author_user_id, text, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      input.organizationId,
      input.itemId,
      input.userId,
      input.noteText,
      input.at,
    ],
  )
}

export async function insertResponseTargetPolicy(
  pool: SeedPool,
  input: Readonly<{ organizationId: string; userId: string; at: Date }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_response_target_organization_policies (
       organization_id, target_kind, duration_minutes, policy_version, updated_by, created_at, updated_at
     ) VALUES ($1, 'private_feedback_handling', 2880, 1, $2, $3, $3)`,
    [input.organizationId, input.userId, input.at],
  )
}

/** Deletes the rows the builders above made, in foreign-key order, then the Organization and user. */
export async function cleanupReviewInboxRights(
  pool: Pool,
  organizationId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1`,
    [organizationId],
  )
  await pool.query(`DELETE FROM inbox_items WHERE organization_id = $1`, [organizationId])
  await pool.query(`DELETE FROM reply_template_visibility WHERE organization_id = $1`, [
    organizationId,
  ])
  await pool.query(
    `DELETE FROM reply_template_wordings WHERE revision_id IN (
       SELECT revision.id FROM reply_template_revisions revision
       JOIN reply_templates template ON template.id = revision.template_id
       WHERE template.organization_id = $1)`,
    [organizationId],
  )
  await pool.query(
    `UPDATE reply_templates SET current_revision_id = NULL WHERE organization_id = $1`,
    [organizationId],
  )
  await pool.query(
    `DELETE FROM reply_template_revisions
     WHERE template_id IN (SELECT id FROM reply_templates WHERE organization_id = $1)`,
    [organizationId],
  )
  for (const table of [
    'reply_templates',
    'property_reply_voices',
    'organization_reply_voices',
    'replies',
    'reviews',
    'properties',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId])
  }
  await deleteTestOrganizations(pool, [organizationId])
  await pool.query('DELETE FROM "user" WHERE id = $1', [userId])
}
