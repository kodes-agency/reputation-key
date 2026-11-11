// Seeds every table the Review and Inbox rights reports count: two Properties of
// different sizes under one Organization, and the same shape under another.

import { randomUUID } from 'node:crypto'
import { deleteTestOrganizations } from './integration-helpers'
import type { TestLease } from './test-environment-lease'

const AT = new Date('2026-08-26T10:00:00.000Z')
const EXPIRES_AT = new Date('2027-08-26T10:00:00.000Z')
const HALF_HOUR = new Date(AT.getTime() + 30 * 60_000)
const HOUR = new Date(AT.getTime() + 60 * 60_000)
const DIGEST = 'd'.repeat(64)

const hex64 = () => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64)

export type Tenant = Readonly<{
  organizationId: string
  userId: string
  keyVersion: string
  propertyIds: ReadonlyArray<string>
}>

export const tenants: Tenant[] = []
let pool: TestLease['pool']

export const bindPool = (leased: TestLease['pool']): void => {
  pool = leased
}

export const q = (text: string, params: unknown[] = []) => pool.query(text, params)

/** Properties differ in size, so a count that mixes them up shows. */
async function seedProperty(
  tenant: Tenant,
  propertyId: string,
  reviewCount: number,
): Promise<void> {
  const org = tenant.organizationId
  const user = tenant.userId
  const reviewIds = Array.from({ length: reviewCount }, () => randomUUID())
  const [first, second] = reviewIds
  const replyId = randomUUID()
  const runId = randomUUID()
  const templateId = randomUUID()
  const revisionId = randomUUID()
  const observationId = randomUUID()
  const feedbackItem = randomUUID()
  const reviewItem = randomUUID()
  const feedbackId = randomUUID()

  await q(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at)
     VALUES ($1, $2, 'Counts property', $3, 'UTC', 0, $4, $4)`,
    [propertyId, org, `counts-${propertyId}`, AT],
  )
  for (const reviewId of reviewIds) {
    await q(
      `INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id, external_location_id,
         expires_at, source_epoch, source_revision, source_observation_sequence,
         analysis_sequence, source_content_state, created_at, updated_at
       ) VALUES ($1, $2, $3, 'google', $4, 'locations/counts', $6, 0, 1, 1, 1, 'active', $5, $5)`,
      [reviewId, org, propertyId, `external-${reviewId}`, AT, EXPIRES_AT],
    )
    await q(
      `INSERT INTO review_source_contents (
         review_id, organization_id, property_id, platform, external_id, external_location_id,
         reviewer_name, rating, text, language_code, reviewed_at, last_fetched_at,
         content_expires_at, source_epoch, source_revision, ai_source_byte_length,
         ai_source_digest)
       VALUES ($1, $2, $3, 'google', $4, 'locations/counts', 'REVIEWER', 4, 'TEXT', 'en',
               $5, $5, $6, 0, 1, 24, $7)`,
      [reviewId, org, propertyId, `content-${reviewId}`, AT, EXPIRES_AT, DIGEST],
    )
    await q(
      `INSERT INTO material_review_revisions (
         review_id, revision, organization_id, property_id, source_epoch,
         normalization_version, rating, normalized_text)
       VALUES ($1, 1, $2, $3, 0, 'legacy-unverified-v0', 4, 'MATERIAL')`,
      [reviewId, org, propertyId],
    )
  }
  for (const [id, reviewId, source] of [
    [replyId, first, 'internal'],
    [randomUUID(), second, 'google_sync'],
  ] as const) {
    await q(
      `INSERT INTO replies (
         id, review_id, organization_id, text, status, source, created_by, submitted_by,
         approved_by, authorship, publication_state, publication_cycle, created_at, updated_at
       ) VALUES ($1, $2, $3, 'REPLY', 'published', $4, $5, $5, $5, $6, 'published', 1, $7, $7)`,
      [
        id,
        reviewId,
        org,
        source,
        source === 'internal' ? user : null,
        source === 'internal' ? 'human' : null,
        AT,
      ],
    )
  }
  for (const sequence of [1, 2]) {
    await q(
      `INSERT INTO review_source_observations (
         review_id, observation_sequence, organization_id, property_id, source_epoch,
         observation_key, observation_digest, material_revision, observed_at,
         content_expires_at, normalization_version, comparison_result, rating, reviewed_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6, 1, $7, $8, 'legacy-unverified-v0', 'unchanged', 4, $7)`,
      [first, sequence, org, propertyId, hex64(), hex64(), AT, EXPIRES_AT],
    )
    await q(
      `INSERT INTO review_ai_analysis_released_sequences (
         organization_id, property_id, source_epoch, analysis_sequence, reason)
       VALUES ($1, $2, 0, $3, 'replayed_observation')`,
      [org, propertyId, sequence],
    )
  }
  await q(
    `INSERT INTO review_first_sightings (
       organization_id, property_id, review_id, source_epoch, first_seen_at, first_seen_via)
     VALUES ($1, $2, $3, 0, $4, 'push')`,
    [org, propertyId, first, AT],
  )
  await q(
    `INSERT INTO review_provider_subjects (
       organization_id, property_id, source_epoch, key_version, locator_hmac, verifier_hmac,
       review_id, last_source_revision, state, last_observed_at)
     VALUES ($1, $2, 0, $7, $3, $4, $5, 1, 'linked', $6)`,
    [
      org,
      propertyId,
      Buffer.alloc(32, 1),
      Buffer.alloc(32, 2),
      first,
      AT,
      tenant.keyVersion,
    ],
  )
  await q(
    `INSERT INTO review_ai_analysis_heads (organization_id, property_id, source_epoch)
     VALUES ($1, $2, 0)`,
    [org, propertyId],
  )
  await q(
    `INSERT INTO review_provider_history_cutoffs (organization_id, property_id, source_epoch, cutoff_at)
     VALUES ($1, $2, 0, $3)`,
    [org, propertyId, AT],
  )
  await q(
    `INSERT INTO review_provider_snapshot_runs (
       id, organization_id, property_id, source_epoch, state, phase, started_at,
       expires_at, terminal_at, record_expires_at)
     VALUES ($1, $2, $3, 0, 'completed', 'terminal', $4, $5, $4, $4::timestamptz + interval '30 days')`,
    [runId, org, propertyId, AT, EXPIRES_AT],
  )
  for (const reviewId of [first, randomUUID()]) {
    await q(
      `INSERT INTO review_provider_snapshot_members (run_id, review_id) VALUES ($1, $2)`,
      [runId, reviewId],
    )
    await q(
      `INSERT INTO review_provider_deletion_candidates (
         run_id, review_id, expected_mapping_state, expected_source_revision)
       VALUES ($1, $2, 'linked', 1)`,
      [runId, reviewId],
    )
  }
  await q(
    `INSERT INTO review_google_reputation_snapshot_facts (
       run_id, event_id, organization_id, property_id, source_epoch, review_count, evaluated_at)
     VALUES ($1, $2, $3, $4, 0, 0, $5)`,
    [runId, randomUUID(), org, propertyId, AT],
  )
  await q(
    `INSERT INTO reply_publication_authorizations (
       organization_id, property_id, review_id, reply_id, publication_cycle, source_epoch,
       material_review_revision, authorized_by_user_id, reply_state_revision,
       normalization_version, expected_reply_digest, authorized_at)
     VALUES ($1, $2, $3, $4, 1, 0, 1, $5, 1, 'google-reply-v1', $6, $7)`,
    [org, propertyId, first, replyId, user, DIGEST, AT],
  )
  for (const attempt of [1, 2]) {
    await q(
      `INSERT INTO reply_publication_attempts (
         organization_id, property_id, review_id, reply_id, publication_cycle, attempt_number,
         provider_operation_key, source_epoch, material_review_revision, reply_state_revision,
         normalization_version, expected_reply_digest, outcome)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 0, 1, 1, 'google-reply-v1', $7, 'retryable_failure')`,
      [org, propertyId, first, replyId, attempt, `operation-${randomUUID()}`, DIGEST],
    )
  }
  for (const [revision, change, id] of [
    [1, 'added', randomUUID()],
    [2, 'edited', observationId],
  ] as const) {
    await q(
      `INSERT INTO google_reply_observations (
         id, organization_id, property_id, review_id, observation_revision, observation_key,
         input_digest, source_epoch, material_review_revision, read_generation, state, change,
         resolution, source, provenance, normalized_text, normalization_version,
         normalized_digest, observed_at, content_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 1, 1, 'live', $8, 'external_current_live',
               'provider_snapshot', 'external_or_unknown', 'OBSERVED', 'google-reply-v1', $9, $10, $11)`,
      [
        id,
        org,
        propertyId,
        first,
        revision,
        hex64(),
        hex64(),
        change,
        hex64(),
        AT,
        EXPIRES_AT,
      ],
    )
  }
  await q(
    `INSERT INTO google_reply_observation_heads (
       review_id, organization_id, property_id, observation_id, observation_revision,
       source_epoch, material_review_revision, state, provenance)
     VALUES ($1, $2, $3, $4, 2, 0, 1, 'live', 'external_or_unknown')`,
    [first, org, propertyId, observationId],
  )

  await q(
    `INSERT INTO property_reply_voices (organization_id, property_id, contact, overridden_fields, updated_by)
     VALUES ($1, $2, 'VOICE', ARRAY['contact'], $3)`,
    [org, propertyId, user],
  )
  await q(
    `INSERT INTO reply_templates (id, organization_id, property_id, builtin_key, created_by, updated_by)
     VALUES ($1, $2, $3, 'P-GEN', $4, $4)`,
    [templateId, org, propertyId, user],
  )
  await q(
    `INSERT INTO reply_template_revisions (id, template_id, number, title, stars_min, stars_max, review_kind, created_by)
     VALUES ($1, $2, 1, 'Greeting', 4, 5, 'text', $3)`,
    [revisionId, templateId, user],
  )
  for (const key of ['one', 'two']) {
    await q(
      `INSERT INTO reply_template_wordings (revision_id, wording_key, language_group, body)
       VALUES ($1, $2, 'en-Latn', 'WORDING')`,
      [revisionId, key],
    )
  }
  await q(`UPDATE reply_templates SET current_revision_id = $1 WHERE id = $2`, [
    revisionId,
    templateId,
  ])
  // One row names the Property; one names the Property's template only.
  await q(
    `INSERT INTO reply_template_visibility (organization_id, property_id, builtin_key, created_by)
     VALUES ($1, $2, 'P-GEN', $3)`,
    [org, propertyId, user],
  )
  await q(
    `INSERT INTO reply_template_visibility (organization_id, template_id, created_by)
     VALUES ($1, $2, $3)`,
    [org, templateId, user],
  )

  await q(
    `INSERT INTO review_sync_state (property_id, next_incremental_at, updated_at)
     VALUES ($1, $2, $2)`,
    [propertyId, EXPIRES_AT],
  )
  for (const mode of ['incremental', 'inventory']) {
    await q(`INSERT INTO review_sync_runs (property_id, mode) VALUES ($1, $2)`, [
      propertyId,
      mode,
    ])
  }
  // Only the webhook receipts of the Property are counted.
  for (const scope of ['gbp_webhook', 'gbp_webhook', 'other_scope']) {
    await q(
      `INSERT INTO idempotency_receipts (scope, key, payload)
       VALUES ($1, $2, jsonb_build_object('resolvedPropertyId', $3::text))`,
      [scope, randomUUID(), propertyId],
    )
  }

  await seedInbox(tenant, propertyId, {
    feedbackItem,
    reviewItem,
    feedbackId,
    reviewId: first,
  })
}

type InboxIds = Readonly<{
  feedbackItem: string
  reviewItem: string
  feedbackId: string
  reviewId: string | undefined
}>

async function seedInbox(
  tenant: Tenant,
  propertyId: string,
  ids: InboxIds,
): Promise<void> {
  const org = tenant.organizationId
  const user = tenant.userId
  const { feedbackItem, reviewItem, feedbackId, reviewId } = ids
  for (const [id, type, sourceId, snippet] of [
    [feedbackItem, 'feedback', feedbackId, 'SNIPPET'],
    [reviewItem, 'review', reviewId, null],
  ] as const) {
    await q(
      `INSERT INTO inbox_items (
         id, organization_id, property_id, source_type, source_id, status, rating,
         snippet, reviewer_name, source_date, platform, command_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, 'portal', 4, $9, $9)`,
      [
        id,
        org,
        propertyId,
        type,
        sourceId,
        snippet ? 2 : null,
        snippet,
        snippet ? 'GUEST' : null,
        AT,
      ],
    )
    await q(
      `INSERT INTO inbox_notes (id, organization_id, inbox_item_id, author_user_id, text, created_at)
       VALUES ($1, $2, $3, $4, 'NOTE', $5)`,
      [randomUUID(), org, id, user, AT],
    )
  }
  await q(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id, source_type, source_id,
       source_revision, review_id, material_review_revision, opened_reason, opened_at)
     VALUES ($1, 1, $2, $3, 'feedback', $4, 1, NULL, NULL, 'feedback_submitted', $5),
            ($6, 1, $2, $3, 'review', $7, 1, $7, 1, 'review_observed', $5)`,
    [feedbackItem, org, propertyId, feedbackId, AT, reviewItem, reviewId],
  )
  await q(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, source_type, source_id,
       current_source_revision, review_id, current_cycle_number,
       current_material_review_revision, state_revision, status)
     VALUES ($1, $2, $3, 'feedback', $4, 1, NULL, 1, NULL, 2, 'closed'),
            ($5, $2, $3, 'review', $6, 1, $6, 1, 1, 1, 'open')`,
    [feedbackItem, org, propertyId, feedbackId, reviewItem, reviewId],
  )
  await q(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, kind, transition_reason, actor_type,
       actor_user_id, transitioned_at)
     VALUES ($1, 1, 1, $2, $3, 'feedback', $4, 1, 'opened', 'feedback_submitted', 'system', NULL, $5),
            ($1, 2, 1, $2, $3, 'feedback', $4, 1, 'closed', 'private_feedback_handled', 'user', $6, $7),
            ($8, 1, 1, $2, $3, 'review', $9, 1, 'opened', 'review_observed', 'system', NULL, $5)`,
    [feedbackItem, org, propertyId, feedbackId, AT, user, HOUR, reviewItem, reviewId],
  )
  await q(
    `INSERT INTO inbox_handling_cycle_response_targets (
       inbox_item_id, cycle_number, organization_id, property_id, source_type, source_id,
       source_revision, target_kind, performance_eligibility, duration_minutes,
       policy_source, policy_version, start_at, due_at)
     VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'private_feedback_handling', 'measured', 60,
             'builtin_default', 1, $5, $6),
            ($7, 1, $2, $3, 'review', $8, 1, 'google_review_response', 'measured', 60,
             'builtin_default', 1, $5, $6)`,
    [feedbackItem, org, propertyId, feedbackId, AT, HOUR, reviewItem, reviewId],
  )
  // Four reminders, two of them still schedulable.
  await q(
    `INSERT INTO inbox_response_target_reminders (
       inbox_item_id, cycle_number, reminder_kind, organization_id, property_id,
       target_kind, scheduled_for, delivered_at, cancelled_at)
     VALUES ($1, 1, 'halfway', $2, $3, 'private_feedback_handling', $4, NULL, NULL),
            ($1, 1, 'target_passed', $2, $3, 'private_feedback_handling', $5, $5, NULL),
            ($6, 1, 'halfway', $2, $3, 'google_review_response', $4, NULL, $4),
            ($6, 1, 'target_passed', $2, $3, 'google_review_response', $5, NULL, NULL)`,
    [feedbackItem, org, propertyId, HALF_HOUR, HOUR, reviewItem],
  )
  await q(
    `INSERT INTO inbox_response_target_exclusions (
       organization_id, property_id, inbox_item_id, cycle_number, target_kind, reason,
       correlation_id, operator_id)
     VALUES ($1, $2, $3, 1, 'google_review_response', 'provider_restatement', $4, 'operator')`,
    [org, propertyId, reviewItem, randomUUID()],
  )
  await q(
    `INSERT INTO inbox_feedback_handling_outcomes (
       id, inbox_item_id, cycle_number, outcome_revision, organization_id, property_id,
       feedback_id, source_revision, outcome, recorded_by, recorded_at, completion_at,
       completion_state_revision, deadline_result, resulting_command_revision)
     VALUES ($1, $2, 1, 1, $3, $4, $5, 1, 'follow_up_completed', $6, $7, $7, 2, 'late', 2)`,
    [randomUUID(), feedbackItem, org, propertyId, feedbackId, user, HOUR],
  )
  await q(
    `INSERT INTO inbox_assignment_history (
       inbox_item_id, resulting_command_revision, organization_id, property_id,
       handling_cycle_number, previous_assignee, next_assignee, reason, actor_user_id, occurred_at)
     VALUES ($1, 2, $2, $3, 1, NULL, $4, 'assign', $4, $5),
            ($1, 3, $2, $3, 1, $4, NULL, 'release', $4, $5),
            ($6, 2, $2, $3, 1, NULL, $4, 'assign', $4, $5)`,
    [feedbackItem, org, propertyId, user, AT, reviewItem],
  )
  await q(
    `INSERT INTO inbox_escalation_history (
       inbox_item_id, resulting_command_revision, organization_id, property_id,
       handling_cycle_number, kind, actor_user_id, occurred_at)
     VALUES ($1, 4, $2, $3, 1, 'escalated', $4, $5)`,
    [feedbackItem, org, propertyId, user, AT],
  )
  await q(
    `INSERT INTO inbox_priority_history (
       inbox_item_id, resulting_command_revision, organization_id, property_id,
       handling_cycle_number, priority, previous_priority, actor_user_id, occurred_at)
     VALUES ($1, 5, $2, $3, 1, 'high', NULL, $4, $5),
            ($1, 6, $2, $3, 1, 'urgent', 'high', $4, $5)`,
    [feedbackItem, org, propertyId, user, AT],
  )
  await q(
    `INSERT INTO inbox_private_feedback_target_property_overrides (
       organization_id, property_id, enabled, duration_minutes, policy_version, updated_by, created_at, updated_at
     ) VALUES ($1, $2, true, 1440, 1, $3, $4, $4)`,
    [org, propertyId, user, AT],
  )
}

export async function seedTenant(
  propertyReviewCounts: ReadonlyArray<number>,
): Promise<Tenant> {
  const suffix = randomUUID()
  const tenant: Tenant = {
    organizationId: `counts-org-${suffix}`,
    userId: `counts-user-${suffix}`,
    keyVersion: `counts-${suffix.replaceAll('-', '').slice(0, 24)}`,
    propertyIds: propertyReviewCounts.map(() => randomUUID()),
  }
  tenants.push(tenant)
  // Count proofs need a referenced key, without taking over the active singleton.
  await q(
    `INSERT INTO review_provider_subject_hmac_key_versions
       (key_version, key_digest, state, generation, created_at, retiring_at)
     VALUES ($1, $2, 'retiring', 1, $3, $3)`,
    [tenant.keyVersion, DIGEST, AT],
  )
  await q(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Counts fixture', $1, $2)`,
    [tenant.organizationId, AT],
  )
  await q(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Counts Manager', $2, true, $3, $3)`,
    [tenant.userId, `${suffix}@example.test`, AT],
  )
  await q(
    `INSERT INTO organization_reply_voices (organization_id, contact, overridden_fields, updated_by)
     VALUES ($1, 'ORGANIZATION_VOICE', ARRAY['contact'], $2)`,
    [tenant.organizationId, tenant.userId],
  )
  await q(
    `INSERT INTO reply_template_visibility (organization_id, builtin_key, created_by)
     VALUES ($1, 'P-GEN', $2)`,
    [tenant.organizationId, tenant.userId],
  )
  await q(
    `INSERT INTO inbox_response_target_organization_policies (
       organization_id, target_kind, duration_minutes, policy_version, updated_by, created_at, updated_at
     ) VALUES ($1, 'private_feedback_handling', 2880, 1, $2, $3, $3)`,
    [tenant.organizationId, tenant.userId, AT],
  )
  await q(
    `INSERT INTO inbox_user_views (organization_id, user_id, last_inbox_view)
     VALUES ($1, $2, $3)`,
    [tenant.organizationId, tenant.userId, AT],
  )
  for (const [index, propertyId] of tenant.propertyIds.entries()) {
    await seedProperty(tenant, propertyId, propertyReviewCounts[index] ?? 2)
  }
  return tenant
}

export async function cleanup(tenant: Tenant): Promise<void> {
  const org = tenant.organizationId
  const properties = [...tenant.propertyIds]
  await q(`DELETE FROM inbox_items WHERE organization_id = $1`, [org])
  for (const table of [
    'inbox_response_target_organization_policies',
    'inbox_user_views',
    'inbox_private_feedback_target_property_overrides',
    'google_reply_observation_heads',
    'google_reply_observations',
    'reply_publication_attempts',
    'reply_publication_authorizations',
    'review_source_observations',
    'review_source_contents',
    'material_review_revisions',
    'review_first_sightings',
    'review_provider_subjects',
    'review_ai_analysis_released_sequences',
    'review_ai_analysis_heads',
    'review_provider_history_cutoffs',
    'review_google_reputation_snapshot_facts',
    'review_provider_snapshot_runs',
    'reply_template_visibility',
  ]) {
    await q(`DELETE FROM ${table} WHERE organization_id = $1`, [org])
  }
  await q(
    `DELETE FROM idempotency_receipts WHERE payload->>'resolvedPropertyId' = ANY($1::text[])`,
    [properties],
  )
  for (const table of ['review_sync_runs', 'review_sync_state']) {
    await q(`DELETE FROM ${table} WHERE property_id = ANY($1::text[])`, [properties])
  }
  await q(
    `DELETE FROM reply_template_wordings WHERE revision_id IN (
       SELECT revision.id FROM reply_template_revisions revision
       JOIN reply_templates template ON template.id = revision.template_id
       WHERE template.organization_id = $1)`,
    [org],
  )
  await q(
    `UPDATE reply_templates SET current_revision_id = NULL WHERE organization_id = $1`,
    [org],
  )
  await q(
    `DELETE FROM reply_template_revisions
     WHERE template_id IN (SELECT id FROM reply_templates WHERE organization_id = $1)`,
    [org],
  )
  for (const table of [
    'reply_templates',
    'property_reply_voices',
    'organization_reply_voices',
    'replies',
    'reviews',
    'properties',
  ]) {
    await q(`DELETE FROM ${table} WHERE organization_id = $1`, [org])
  }
  await deleteTestOrganizations(pool, [org])
  await q('DELETE FROM "user" WHERE id = $1', [tenant.userId])
  await q(
    'DELETE FROM review_provider_subject_hmac_key_versions WHERE key_version = $1',
    [tenant.keyVersion],
  )
}
