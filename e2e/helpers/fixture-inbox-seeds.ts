import { googleReplyTextDigest } from '../../src/shared/domain/google-reply-text'
import { dbQuery } from './fixture-db'

export async function seedInboxItemForReview(input: {
  organizationId: string
  propertyId: string
  reviewId: string
  sourceDate?: Date
}): Promise<{ inboxItemId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO inbox_items (organization_id, property_id, source_type, source_id, status, source_date, platform)
     VALUES ($1, $2, 'review', $3, 'open', $4, 'google')
     RETURNING id`,
    [
      input.organizationId,
      input.propertyId,
      input.reviewId,
      input.sourceDate ?? new Date(),
    ],
  )
  return { inboxItemId: rows[0].id }
}

/**
 * IBX-01-T9: the Handling Cycle authority for a seeded Inbox projection.
 *
 * Every serving read resolves status from `inbox_handling_cycle_heads`, so an
 * `inbox_items` row on its own is INVISIBLE to the product. Fixtures that seed
 * the projection directly must seed its cycle one, head, and opening transition
 * too, or the detail panel renders nothing and the failure looks like a routing
 * bug rather than a missing fixture.
 */
export async function seedInboxHandlingCycle(input: {
  organizationId: string
  propertyId: string
  inboxItemId: string
  sourceType: 'review' | 'feedback'
  sourceId: string
  sourceRevision?: number
  openedAt?: Date
}): Promise<void> {
  const isReview = input.sourceType === 'review'
  const sourceRevision = input.sourceRevision ?? 1
  const openedAt = input.openedAt ?? new Date()
  const openedReason = isReview ? 'review_observed' : 'feedback_submitted'
  const actorType = isReview ? 'provider' : 'guest'
  const scope = [
    input.inboxItemId,
    input.organizationId,
    input.propertyId,
    isReview ? input.sourceId : null,
    isReview ? sourceRevision : null,
    input.sourceType,
    input.sourceId,
    sourceRevision,
    openedAt,
  ]
  await dbQuery(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id, review_id,
       material_review_revision, source_type, source_id, source_revision,
       opened_reason, opened_at
     ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $10, $9)`,
    [...scope, openedReason],
  )
  await dbQuery(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, review_id,
       current_cycle_number, current_material_review_revision, state_revision,
       status, source_type, source_id, current_source_revision,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 1, $5, 1, 'open', $6, $7, $8, $9, $9)`,
    scope,
  )
  // Numbered for THIS statement rather than reusing `scope` positionally.
  // The transitions table has no review_id or material_review_revision, so the
  // shared array's $4 and $5 appear nowhere in the text — and a parameter that
  // is never referenced has no type to infer, which Postgres rejects outright
  // with "could not determine data type of parameter $4".
  await dbQuery(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, transitioned_at
     ) VALUES ($1, 1, 1, $2, $3, $4, $5, $6, 'opened', $7, $8, $9)`,
    [
      input.inboxItemId,
      input.organizationId,
      input.propertyId,
      input.sourceType,
      input.sourceId,
      sourceRevision,
      openedReason,
      actorType,
      openedAt,
    ],
  )
}

/** A review Inbox projection that is actually reachable from the product. */
export async function seedReviewInboxItemWithCycle(input: {
  organizationId: string
  propertyId: string
  reviewId: string
  sourceDate?: Date
}): Promise<{ inboxItemId: string }> {
  const { inboxItemId } = await seedInboxItemForReview(input)
  await seedInboxHandlingCycle({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    inboxItemId,
    sourceType: 'review',
    sourceId: input.reviewId,
    openedAt: input.sourceDate,
  })
  return { inboxItemId }
}

/**
 * A private-feedback Inbox projection with its live Guest source. The body
 * lives in `guest_response_private_feedback` and is live-read at detail time —
 * it is never copied onto the Inbox row.
 */
export async function seedPrivateFeedbackInboxItem(input: {
  organizationId: string
  propertyId: string
  slug: string
  body: string
  rating?: number
  submittedAt?: Date
}): Promise<{ inboxItemId: string; responseId: string; portalId: string }> {
  const submittedAt = input.submittedAt ?? new Date()
  const portals = await dbQuery<{ id: string }>(
    `INSERT INTO portals (
       organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state
     ) VALUES ($1, $2, 'property', $3, 'E2E handling portal', $4, 'published')
     RETURNING id`,
    [input.organizationId, input.propertyId, input.propertyId, input.slug],
  )
  const portalId = portals[0].id
  // $5 is cast at EVERY use, including the bare ones. Postgres resolves
  // "unknown + interval" by first assuming the unknown is also an interval — an
  // exact catalog match — which pins $5 to interval. The bare $5 uses are then
  // coerced against the timestamptz columns and the two deductions collide:
  // "inconsistent types deduced for parameter $5". The statement had never
  // executed successfully.
  const responses = await dbQuery<{ id: string }>(
    `INSERT INTO guest_responses (
       organization_id, property_id, portal_id, status, rating,
       response_consent, text_consent, media_consent, submitted_at,
       retention_deadline, feedback_submitted_at, feedback_submission_revision
     ) VALUES ($1, $2, $3, 'submitted', $4, true, true, false, $5::timestamptz,
               $5::timestamptz + interval '400 days', $5::timestamptz, 1)
     RETURNING id`,
    [input.organizationId, input.propertyId, portalId, input.rating ?? 2, submittedAt],
  )
  const responseId = responses[0].id
  await dbQuery(
    `INSERT INTO guest_response_private_feedback (
       response_id, organization_id, property_id, portal_id, body, submitted_at,
       expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz + interval '400 days')`,
    [
      responseId,
      input.organizationId,
      input.propertyId,
      portalId,
      input.body,
      submittedAt,
    ],
  )
  const items = await dbQuery<{ id: string }>(
    `INSERT INTO inbox_items (
       organization_id, property_id, source_type, source_id, status, source_date,
       platform
     ) VALUES ($1, $2, 'feedback', $3, 'open', $4, NULL)
     RETURNING id`,
    [input.organizationId, input.propertyId, responseId, submittedAt],
  )
  const inboxItemId = items[0].id
  await seedInboxHandlingCycle({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    inboxItemId,
    sourceType: 'feedback',
    sourceId: responseId,
    openedAt: submittedAt,
  })
  return { inboxItemId, responseId, portalId }
}

/**
 * The state a source-authoritative close leaves behind.
 *
 * Manager UI can never close Inbox work: a Google review closes when the
 * current reply is observed on Google, and private feedback closes only through
 * an explicit manager outcome or a guest withdrawal. `reply-lifecycle.spec.ts`
 * already drives the full provider pipeline end to end; this fixture supplies
 * the same terminal truth so a handling-cycle journey can start from it without
 * re-testing Review's publication machinery.
 */
export async function closeInboxItemBySourceAuthority(input: {
  organizationId: string
  inboxItemId: string
  closeReason:
    | 'confirmed_on_google'
    | 'external_reply_observed'
    | 'guest_withdrawn'
    | 'source_ineligible'
  actorType?: 'provider' | 'guest' | 'system'
  closedAt?: Date
}): Promise<void> {
  const closedAt = input.closedAt ?? new Date()
  await dbQuery(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, transitioned_at
     )
     SELECT head.inbox_item_id, head.state_revision + 1, head.current_cycle_number,
            head.organization_id, head.property_id, head.source_type,
            head.source_id, head.current_source_revision, 'closed', $4, $5, $2
     FROM inbox_handling_cycle_heads AS head
     WHERE head.inbox_item_id = $1 AND head.organization_id = $3
       AND head.status = 'open'`,
    [
      input.inboxItemId,
      closedAt,
      input.organizationId,
      input.closeReason,
      input.actorType ?? 'provider',
    ],
  )
  await dbQuery(
    `UPDATE inbox_handling_cycle_heads
     SET status = 'closed', state_revision = state_revision + 1, updated_at = $2
     WHERE inbox_item_id = $1 AND organization_id = $3 AND status = 'open'`,
    [input.inboxItemId, closedAt, input.organizationId],
  )
  await dbQuery(
    `UPDATE inbox_items
     SET status = 'closed', closed_at = $2, command_revision = command_revision + 1,
         updated_at = $2
     WHERE id = $1 AND organization_id = $3`,
    [input.inboxItemId, closedAt, input.organizationId],
  )
}

/**
 * The state a provider-driven reopen leaves behind: Google lost the reply, so
 * the Inbox opens a NEW numbered cycle rather than editing the closed one.
 */
export async function reopenInboxItemBySourceAuthority(input: {
  organizationId: string
  inboxItemId: string
  openedReason: 'provider_reply_deleted' | 'provider_reply_diverged'
  reopenedAt?: Date
}): Promise<void> {
  const reopenedAt = input.reopenedAt ?? new Date()
  const params = [input.inboxItemId, reopenedAt, input.organizationId, input.openedReason]
  await dbQuery(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id, review_id,
       material_review_revision, source_type, source_id, source_revision,
       opened_reason, supersedes_cycle_number, opened_at
     )
     SELECT head.inbox_item_id, head.current_cycle_number + 1, head.organization_id,
            head.property_id, head.review_id, head.current_material_review_revision,
            head.source_type, head.source_id, head.current_source_revision, $4,
            head.current_cycle_number, $2
     FROM inbox_handling_cycle_heads AS head
     WHERE head.inbox_item_id = $1 AND head.organization_id = $3`,
    params,
  )
  await dbQuery(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason,
       actor_type, transitioned_at
     )
     SELECT head.inbox_item_id, head.state_revision + 1, head.current_cycle_number + 1,
            head.organization_id, head.property_id, head.source_type, head.source_id,
            head.current_source_revision, 'reopened', $4, 'provider', $2
     FROM inbox_handling_cycle_heads AS head
     WHERE head.inbox_item_id = $1 AND head.organization_id = $3`,
    params,
  )
  await dbQuery(
    `UPDATE inbox_handling_cycle_heads
     SET current_cycle_number = current_cycle_number + 1,
         state_revision = state_revision + 1, status = 'open', updated_at = $2
     WHERE inbox_item_id = $1 AND organization_id = $3`,
    [input.inboxItemId, reopenedAt, input.organizationId],
  )
  await dbQuery(
    `UPDATE inbox_items
     SET status = 'open', closed_at = NULL, command_revision = command_revision + 1,
         updated_at = $2
     WHERE id = $1 AND organization_id = $3`,
    [input.inboxItemId, reopenedAt, input.organizationId],
  )
}

/**
 * Drive a seeded private-feedback item into the terminal guest-withdrawal
 * state: the body is purged, the cycle closes with `guest_withdrawn`, and no
 * manager outcome exists or can exist. This is the shape the Inbox must render
 * without claiming anybody handled anything.
 */
export async function withdrawPrivateFeedbackInboxItem(input: {
  organizationId: string
  inboxItemId: string
  responseId: string
  withdrawnAt?: Date
}): Promise<void> {
  const withdrawnAt = input.withdrawnAt ?? new Date()
  await dbQuery('DELETE FROM guest_response_private_feedback WHERE response_id = $1', [
    input.responseId,
  ])
  // Withdrawal ERASES, it does not just timestamp. `withdrawPrivateFeedback`
  // in the domain clears the consent and the source event along with setting
  // the instant, and guest_responses_feedback_withdrawal_valid enforces exactly
  // that: a withdrawn row must carry no consent and no source event. Stamping
  // only the timestamp produced a row the database refuses. (The feedback text
  // itself lives in guest_response_private_feedback, deleted just above.)
  await dbQuery(
    `UPDATE guest_responses
     SET feedback_withdrawn_at = $2,
         text_consent = false,
         feedback_source_event_id = NULL,
         updated_at = $2
     WHERE id = $1`,
    [input.responseId, withdrawnAt],
  )
  await closeInboxItemBySourceAuthority({
    organizationId: input.organizationId,
    inboxItemId: input.inboxItemId,
    closeReason: 'guest_withdrawn',
    actorType: 'guest',
    closedAt: withdrawnAt,
  })
}

/** Remove the Guest source rows a private-feedback fixture created. */
export async function cleanupE2ePrivateFeedback(input: {
  organizationId: string
  prefix: string
}): Promise<void> {
  const like = `${input.prefix}%`
  await dbQuery(
    `DELETE FROM inbox_items WHERE organization_id = $1 AND source_type = 'feedback'
       AND source_id IN (
         SELECT response.id FROM guest_responses AS response
         JOIN portals AS portal ON portal.id = response.portal_id
         WHERE response.organization_id = $1 AND portal.slug LIKE $2)`,
    [input.organizationId, like],
  )
  await dbQuery(
    `DELETE FROM guest_responses WHERE organization_id = $1 AND portal_id IN (
       SELECT id FROM portals WHERE organization_id = $1 AND slug LIKE $2)`,
    [input.organizationId, like],
  )
  await dbQuery('DELETE FROM portals WHERE organization_id = $1 AND slug LIKE $2', [
    input.organizationId,
    like,
  ])
}

/** Every numbered work episode for one Inbox item, oldest first. */
export async function getInboxHandlingCycles(inboxItemId: string) {
  return dbQuery(
    `SELECT cycle_number::int AS cycle_number, opened_reason, manual_reopen_reason,
            manual_reopen_explanation, supersedes_cycle_number::int AS supersedes_cycle_number
     FROM inbox_handling_cycles WHERE inbox_item_id = $1 ORDER BY cycle_number`,
    [inboxItemId],
  )
}

/** The append-only transition log for one Inbox item, ordered by state revision. */
export async function getInboxHandlingTransitions(inboxItemId: string) {
  return dbQuery(
    `SELECT state_revision::int AS state_revision, cycle_number::int AS cycle_number,
            kind, transition_reason, actor_type, actor_user_id
     FROM inbox_handling_cycle_transitions WHERE inbox_item_id = $1
     ORDER BY state_revision`,
    [inboxItemId],
  )
}

/** The current Handling Cycle head — the status authority every read uses. */
export async function getInboxHandlingCycleHead(inboxItemId: string) {
  const rows = await dbQuery(
    `SELECT current_cycle_number::int AS current_cycle_number,
            current_source_revision::int AS current_source_revision,
            state_revision::int AS state_revision, status
     FROM inbox_handling_cycle_heads WHERE inbox_item_id = $1`,
    [inboxItemId],
  )
  return rows[0] ?? null
}

/** Manager handling outcomes for one Inbox item, oldest first. */
export async function getFeedbackHandlingOutcomes(inboxItemId: string) {
  return dbQuery(
    `SELECT cycle_number::int AS cycle_number, outcome_revision::int AS outcome_revision,
            outcome, internal_note, completion_at, deadline_result
     FROM inbox_feedback_handling_outcomes WHERE inbox_item_id = $1
     ORDER BY cycle_number, outcome_revision`,
    [inboxItemId],
  )
}

/** An authorized-but-unpublished reply (status 'approved', publication_state
 * 'authorized') — the state approveReply leaves before the publish job runs. */
export async function seedApprovedReply(input: {
  organizationId: string
  reviewId: string
  text: string
  createdBy?: string
}): Promise<{ replyId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO replies
       (review_id, organization_id, text, status, source, created_by, approved_at,
        publication_state, publication_attempts)
     VALUES ($1, $2, $3, 'approved', 'internal', $4, now(), 'authorized', 0)
     RETURNING id`,
    [input.reviewId, input.organizationId, input.text, input.createdBy ?? null],
  )
  return { replyId: rows[0].id }
}

/** A fully published internal reply (post-publish-job state). */
export async function seedPublishedReply(input: {
  organizationId: string
  reviewId: string
  text: string
  createdBy?: string
}): Promise<{ replyId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO replies
       (review_id, organization_id, text, status, source, created_by, approved_at,
        published_at, publication_state, publication_attempts)
     VALUES ($1, $2, $3, 'published', 'internal', $4, now(), now(), 'published', 1)
     RETURNING id`,
    [input.reviewId, input.organizationId, input.text, input.createdBy ?? null],
  )
  return { replyId: rows[0].id }
}

/** A reply stuck after an ambiguous publish outcome (timeout post-send on the
 * final attempt): publish_failed + publication_state 'ambiguous', reconcile due. */
/** A reply whose send outcome is unknown — the shape a real ambiguous publish
 * leaves behind. Reconciliation refuses a reply that names no exact provider
 * attempt, so the AUTHORIZATION and the ATTEMPT are seeded too: the reply row
 * alone is a state production never produces. */
export async function seedAmbiguousReply(input: {
  organizationId: string
  reviewId: string
  text: string
  createdBy?: string
}): Promise<{ replyId: string }> {
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO replies
       (review_id, organization_id, text, status, source, created_by, approved_at,
        publication_state, publication_cycle, publication_attempts,
        publication_last_error_class, reconcile_due_at)
     VALUES ($1, $2, $3, 'publish_failed', 'internal', $4, now(),
             'ambiguous', 1, 1, 'ambiguous', now() - interval '1 minute')
     RETURNING id`,
    [input.reviewId, input.organizationId, input.text, input.createdBy ?? null],
  )
  const replyId = rows[0].id
  const [review] = await dbQuery<{
    propertyId: string
    sourceEpoch: number
    sourceRevision: number
  }>(
    `SELECT property_id AS "propertyId", source_epoch AS "sourceEpoch",
            source_revision AS "sourceRevision"
     FROM reviews WHERE id = $1::uuid AND organization_id = $2`,
    [input.reviewId, input.organizationId],
  )
  if (!review) throw new Error('E2E ambiguous reply review is unavailable')
  const [reply] = await dbQuery<{ stateRevision: string }>(
    `SELECT state_revision AS "stateRevision" FROM replies WHERE id = $1::uuid`,
    [replyId],
  )
  const digest = googleReplyTextDigest(input.text)
  const binding = [
    input.organizationId,
    review.propertyId,
    input.reviewId,
    replyId,
    1,
    review.sourceEpoch,
    review.sourceRevision,
    reply.stateRevision,
    digest,
  ]
  await dbQuery(
    `INSERT INTO reply_publication_authorizations
       (organization_id, property_id, review_id, reply_id, publication_cycle,
        source_epoch, material_review_revision, base_observation_revision,
        authorized_by_user_id, reply_state_revision, normalization_version,
        expected_reply_digest, authorized_at)
     VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, 0, $10, $8,
             'google-reply-v1', $9, now())`,
    [...binding, input.createdBy ?? null],
  )
  await dbQuery(
    `INSERT INTO reply_publication_attempts
       (organization_id, property_id, review_id, reply_id, publication_cycle,
        attempt_number, provider_operation_key, source_epoch,
        material_review_revision, reply_state_revision, base_observation_revision,
        normalization_version, expected_reply_digest, outcome)
     VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, 1, $10, $6, $7, $8, 0,
             'google-reply-v1', $9, 'ambiguous')`,
    [...binding, `e2e-ambiguous-${replyId}`],
  )
  return { replyId }
}
