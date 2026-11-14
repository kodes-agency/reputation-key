import { dbQuery } from './fixture-db'

// ── DB assertion helpers ──────────────────────────────────────────────

export async function getInboxItemForReview(reviewId: string) {
  const rows = await dbQuery(
    `SELECT * FROM inbox_items WHERE source_type = 'review' AND source_id = $1`,
    [reviewId],
  )
  return rows[0] ?? null
}

export async function getInboxItemById(inboxItemId: string) {
  const rows = await dbQuery('SELECT * FROM inbox_items WHERE id = $1', [inboxItemId])
  return rows[0] ?? null
}

/** The append-only manager priority log for one Inbox item (ADR 0071). */
export async function getInboxPriorityHistory(inboxItemId: string) {
  return dbQuery(
    `SELECT resulting_command_revision::int AS resulting_command_revision,
            priority, previous_priority, actor_user_id
       FROM inbox_priority_history
      WHERE inbox_item_id = $1
      ORDER BY resulting_command_revision`,
    [inboxItemId],
  )
}

export async function getInboxNotes(inboxItemId: string) {
  return dbQuery(
    'SELECT * FROM inbox_notes WHERE inbox_item_id = $1 ORDER BY created_at',
    [inboxItemId],
  )
}

export async function getReplyForReview(reviewId: string) {
  const rows = await dbQuery(
    `SELECT * FROM replies WHERE review_id = $1 AND source = 'internal'`,
    [reviewId],
  )
  return rows[0] ?? null
}

export async function getReplyById(replyId: string) {
  const rows = await dbQuery('SELECT * FROM replies WHERE id = $1', [replyId])
  return rows[0] ?? null
}

const REVIEW_WITH_CONTENT = `SELECT r.*, c.external_id, c.external_location_id,
  c.google_connection_id, c.reviewer_name, c.reviewer_profile_photo_url,
  c.google_review_url, c.rating, c.text, c.translated_text, c.language_code,
  c.reviewed_at, c.content_expires_at AS expires_at, c.source_created_at,
  c.source_updated_at, c.first_fetched_at, c.last_fetched_at,
  c.content_expires_at, c.content_hash, c.ai_source_byte_length, c.ai_source_digest
  FROM reviews r LEFT JOIN review_source_contents c
    ON c.review_id = r.id AND c.organization_id = r.organization_id
   AND c.property_id = r.property_id`

export async function getReviewById(reviewId: string) {
  const rows = await dbQuery(`${REVIEW_WITH_CONTENT} WHERE r.id = $1`, [reviewId])
  return rows[0] ?? null
}

export async function getReviewsForProperty(propertyId: string) {
  return dbQuery(
    `${REVIEW_WITH_CONTENT} WHERE r.property_id = $1 ORDER BY c.reviewed_at DESC`,
    [propertyId],
  )
}

export async function getConnectionById(connectionId: string) {
  const rows = await dbQuery('SELECT * FROM google_connections WHERE id = $1', [
    connectionId,
  ])
  return rows[0] ?? null
}

export async function getPropertyBySlug(organizationId: string, slug: string) {
  const rows = await dbQuery(
    'SELECT * FROM properties WHERE organization_id = $1 AND slug = $2 AND deleted_at IS NULL',
    [organizationId, slug],
  )
  return rows[0] ?? null
}

export async function getPropertyByGbpLocationId(
  organizationId: string,
  gbpLocationId: string,
) {
  const rows = await dbQuery<{ id: string }>(
    'SELECT * FROM properties WHERE organization_id = $1 AND gbp_location_id = $2 AND deleted_at IS NULL',
    [organizationId, gbpLocationId],
  )
  return rows[0] ?? null
}

export async function findOutboxEvents(input: {
  eventType: string
  organizationId: string
  payloadFragment?: string
}) {
  if (input.payloadFragment !== undefined) {
    return dbQuery(
      `SELECT * FROM outbox_events
       WHERE event_type = $1 AND organization_id = $2 AND payload::text LIKE $3
       ORDER BY created_at`,
      [input.eventType, input.organizationId, `%${input.payloadFragment}%`],
    )
  }
  return dbQuery(
    'SELECT * FROM outbox_events WHERE event_type = $1 AND organization_id = $2 ORDER BY created_at',
    [input.eventType, input.organizationId],
  )
}

export async function getNotificationsForUser(userId: string) {
  return dbQuery('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at', [
    userId,
  ])
}
