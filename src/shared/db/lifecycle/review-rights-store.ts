// SQL behind the Review rights executor (src/shared/ops/rights): the
// manager-authored reply data an Organization holds, and the closure scrub of
// everything Review keeps for it. Every statement is scoped to one
// organization_id, directly or through a parent row that is.
//
// Export is an explicit allowlist. Only `source = 'internal'` replies are
// selected: a `google_sync` reply mirrors provider-authored text. Reviews,
// source contents and observations, reply observations, provider subjects and
// snapshot material, operation keys and digests, and unadopted AI drafts are
// never selected.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { ReplyScopeEffects } from '#/shared/db/reply-scope-effects'
import type { Tx } from '#/shared/outbox/commit'

export const REVIEW_EXPORT_VERSION = 'review-rights-export/v1'

const UTC = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

/** `column` and `alias` come from literals in this file, never from input. */
function utc(column: string, alias = column.split('.').pop() as string): SQL {
  return sql`to_char(${sql.raw(column)} AT TIME ZONE 'UTC', ${UTC}) AS ${sql.raw(alias)}`
}

export const REVIEW_EXCLUDED_RECORD_CLASSES = Object.freeze([
  {
    recordClass: 'google_controlled_review_source_content',
    reasonCode: 'provider_controlled_content',
  },
  {
    recordClass: 'provider_mirrored_reply_text',
    reasonCode: 'provider_controlled_content',
  },
  { recordClass: 'google_reply_observations', reasonCode: 'provider_controlled_content' },
  {
    recordClass: 'google_provider_subject_and_snapshot_material',
    reasonCode: 'provider_identifier_material',
  },
  {
    recordClass: 'provider_operation_keys_and_digests',
    reasonCode: 'content_free_control_plane',
  },
  {
    recordClass: 'transient_ai_draft_and_inference_material',
    reasonCode: 'transient_inference_material',
  },
])

type Row = Readonly<Record<string, unknown>>

/** Review tables scoped directly by `organization_id` that hold tenant content. */
const PRESENCE_TABLES = Object.freeze([
  'reviews',
  'replies',
  'review_provider_snapshot_runs',
  'review_provider_history_cutoffs',
  'review_ai_analysis_heads',
  'review_google_reputation_snapshot_facts',
  'organization_reply_voices',
  'property_reply_voices',
  'reply_templates',
  'reply_template_visibility',
] as const)

const BLOCKER_CODES = Object.freeze([
  'active_reply_publications',
  'unsettled_provider_attempts',
  'unfenced_sync_schedules',
  'open_provider_snapshot_runs',
] as const)

/**
 * Review's sync tables are keyed by Property. The scope is the union of the
 * Organization's Properties and the Properties its Reviews name, so it stays
 * resolvable after the Property rows are gone.
 */
const propertyScope = (organizationId: string) => sql`(
  SELECT id::text AS property_id FROM properties WHERE organization_id = ${organizationId}
  UNION
  SELECT DISTINCT property_id::text FROM reviews WHERE organization_id = ${organizationId}
)`

function toCount(row: Row | undefined, field: string): number {
  const value = Number(row?.[field])
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Review rights count is unavailable: ${field}`)
  }
  return value
}

async function affected(tx: Tx, statement: SQL): Promise<number> {
  return (await tx.execute(statement)).rowCount ?? 0
}

async function organizationExists(tx: Tx, organizationId: string): Promise<boolean> {
  const result = await tx.execute(
    sql`SELECT 1 AS present FROM organization WHERE id = ${organizationId}`,
  )
  return result.rows.length > 0
}

async function readBlockers(
  tx: Tx,
  organizationId: string,
  now: Date,
): Promise<ReadonlyArray<Readonly<{ code: string; count: number }>>> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM replies
        WHERE organization_id = ${organizationId}
          AND publication_state IN ('requested', 'authorized', 'sending', 'pending_observation', 'ambiguous')
      ) AS active_reply_publications,
      (SELECT count(*)::int FROM reply_publication_attempts
        WHERE organization_id = ${organizationId}
          AND outcome IN ('sending', 'provider_outcome_pending', 'ambiguous')
      ) AS unsettled_provider_attempts,
      (SELECT count(*)::int FROM review_sync_state
        WHERE property_id IN (SELECT property_id FROM ${propertyScope(organizationId)} AS scope)
          AND (next_incremental_at IS NOT NULL
               OR next_inventory_at IS NOT NULL
               OR error_retry_at IS NOT NULL
               OR lease_until > ${now}::timestamptz)
      ) AS unfenced_sync_schedules,
      (SELECT count(*)::int FROM review_provider_snapshot_runs
        WHERE organization_id = ${organizationId}
          AND state NOT IN ('completed', 'failed')
          AND expires_at > ${now}::timestamptz
      ) AS open_provider_snapshot_runs
  `)
  const row = result.rows[0] as Row | undefined
  return BLOCKER_CODES.map((code) => ({ code, count: toCount(row, code) })).filter(
    (blocker) => blocker.count > 0,
  )
}

/** Counts and blocker codes only. */
export async function readReviewRightsReport(
  db: Database,
  organizationId: string,
  now: Date,
): Promise<ReadonlyArray<string>> {
  return db.transaction(
    async (tx) => {
      if (!(await organizationExists(tx, organizationId))) {
        return ['organization not found']
      }
      const held: string[] = []
      for (const table of PRESENCE_TABLES) {
        const result = await tx.execute(
          sql`SELECT count(*)::int AS held FROM ${sql.identifier(table)}
              WHERE organization_id = ${organizationId}`,
        )
        held.push(`${table}=${toCount(result.rows[0] as Row | undefined, 'held')}`)
      }
      const found = await readBlockers(tx, organizationId, now)
      return [
        held.join(' '),
        found.length === 0
          ? 'closure blockers: none'
          : `closure blockers: ${found.map((b) => `${b.code}=${b.count}`).join(',')}`,
      ]
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

export async function readReviewRightsExport(db: Database, organizationId: string) {
  return db.transaction(
    async (tx) => {
      const rows = async (query: SQL) => (await tx.execute(query)).rows as Row[]
      return {
        version: REVIEW_EXPORT_VERSION,
        organizationId,
        replies: await rows(sql`
          SELECT id, review_id, text, reply_language_tag, template_layer, template_ref,
            template_revision, template_wording_key, voice_digest,
            voice_choices::text AS voice_choices, status, source, created_by,
            submitted_by, approved_by, rejected_by, rejection_reason, ai_generated,
            authorship, origin_operation_id, origin_source_epoch, origin_source_revision,
            origin_base_reply_state_revision, origin_reply_drafting_epoch,
            origin_property_profile_version, origin_ai_profile_version,
            origin_reply_template_id, origin_reply_template_catalogue_version,
            origin_reply_template_catalogue_digest, origin_concrete_language_tag,
            origin_template_group, publication_state, publication_cycle,
            publication_attempts, ${utc('submitted_at')}, ${utc('approved_at')},
            ${utc('published_at')}, ${utc('created_at')}, ${utc('updated_at')}
          FROM replies
          WHERE organization_id = ${organizationId} AND source = 'internal'
          ORDER BY id`),
        replyAuthorizations: await rows(sql`
          SELECT auth_row.reply_id, auth_row.review_id, auth_row.property_id,
            auth_row.publication_cycle, auth_row.source_epoch,
            auth_row.material_review_revision, auth_row.base_observation_revision,
            auth_row.authorized_by_user_id, auth_row.reply_state_revision,
            ${utc('auth_row.authorized_at')}
          FROM reply_publication_authorizations AS auth_row
          JOIN replies AS reply
            ON reply.id = auth_row.reply_id
           AND reply.organization_id = auth_row.organization_id
          WHERE auth_row.organization_id = ${organizationId} AND reply.source = 'internal'
          ORDER BY auth_row.reply_id, auth_row.publication_cycle`),
        replyPublicationAttempts: await rows(sql`
          SELECT attempt.id, attempt.reply_id, attempt.review_id, attempt.property_id,
            attempt.publication_cycle, attempt.attempt_number, attempt.source_epoch,
            attempt.material_review_revision, attempt.reply_state_revision,
            attempt.outcome, ${utc('attempt.provider_responded_at')},
            attempt.confirmed_observation_revision, ${utc('attempt.created_at')},
            ${utc('attempt.updated_at')}
          FROM reply_publication_attempts AS attempt
          JOIN replies AS reply
            ON reply.id = attempt.reply_id
           AND reply.organization_id = attempt.organization_id
          WHERE attempt.organization_id = ${organizationId} AND reply.source = 'internal'
          ORDER BY attempt.reply_id, attempt.publication_cycle, attempt.attempt_number`),
        organizationReplyVoices: await rows(sql`
          SELECT organization_id, use_first_name, privacy_mode, greeting_positive,
            greeting_negative, contact, emoji_mode, array_to_json(emoji_set)::text AS emoji_set,
            signer_name, signer_title, business_name_short, visit_word_key,
            localized::text AS localized,
            array_to_json(overridden_fields)::text AS overridden_fields, version,
            updated_by, ${utc('created_at')}, ${utc('updated_at')}
          FROM organization_reply_voices
          WHERE organization_id = ${organizationId}
          ORDER BY organization_id`),
        propertyReplyVoices: await rows(sql`
          SELECT organization_id, property_id, use_first_name, privacy_mode,
            greeting_positive, greeting_negative, contact, emoji_mode,
            array_to_json(emoji_set)::text AS emoji_set, signer_name, signer_title,
            business_name_short, visit_word_key, localized::text AS localized,
            array_to_json(overridden_fields)::text AS overridden_fields, version,
            updated_by, ${utc('created_at')}, ${utc('updated_at')}
          FROM property_reply_voices
          WHERE organization_id = ${organizationId}
          ORDER BY property_id`),
        replyTemplates: await rows(sql`
          SELECT id, organization_id, property_id, builtin_key, based_on_template_id,
            based_on_builtin_version, current_revision_id, ${utc('archived_at')},
            created_by, updated_by, ${utc('created_at')}, ${utc('updated_at')}
          FROM reply_templates
          WHERE organization_id = ${organizationId}
          ORDER BY id`),
        replyTemplateRevisions: await rows(sql`
          SELECT revision.id, revision.template_id, revision.number, revision.title,
            revision.stars_min, revision.stars_max, revision.review_kind, revision.topic,
            revision.created_by, ${utc('revision.created_at')}
          FROM reply_template_revisions AS revision
          JOIN reply_templates AS template ON template.id = revision.template_id
          WHERE template.organization_id = ${organizationId}
          ORDER BY revision.template_id, revision.number`),
        replyTemplateWordings: await rows(sql`
          SELECT wording.revision_id, wording.wording_key, wording.language_group, wording.body
          FROM reply_template_wordings AS wording
          JOIN reply_template_revisions AS revision ON revision.id = wording.revision_id
          JOIN reply_templates AS template ON template.id = revision.template_id
          WHERE template.organization_id = ${organizationId}
          ORDER BY wording.revision_id, wording.wording_key, wording.language_group`),
        replyTemplateVisibility: await rows(sql`
          SELECT id, organization_id, property_id, builtin_key, template_id, created_by,
            ${utc('created_at')}
          FROM reply_template_visibility
          WHERE organization_id = ${organizationId}
          ORDER BY id`),
        excludedRecordClasses: REVIEW_EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Stops provider effects: clears the sync schedules and cancels replies that
 * were authorized but not yet sent. Replies already out stay for reconciliation.
 */
async function fence(
  tx: Tx,
  effects: ReplyScopeEffects,
  organizationId: string,
  now: Date,
): Promise<number> {
  const schedules = await affected(
    tx,
    sql`UPDATE review_sync_state
        SET next_incremental_at = NULL, next_inventory_at = NULL, error_retry_at = NULL,
            updated_at = GREATEST(updated_at, ${now}::timestamptz)
        WHERE property_id IN (SELECT property_id FROM ${propertyScope(organizationId)} AS scope)
          AND (next_incremental_at IS NOT NULL
               OR next_inventory_at IS NOT NULL
               OR error_retry_at IS NOT NULL)`,
  )
  const publications = await effects.cancelRepliesForOrganizationClosing(tx, {
    organizationId,
    occurredAt: now,
  })
  return schedules + publications
}

/**
 * Deletes what the database lets us delete and scrubs the rows that retained
 * reply authorizations still reference, into the shape the content-state CHECK
 * constraints define for erased content. Authorizations stay: they are
 * content-free proof that a named manager authorized one publication cycle.
 */
async function purge(
  tx: Tx,
  effects: ReplyScopeEffects,
  organizationId: string,
  now: Date,
) {
  const org = organizationId
  const scopeRows = sql`property_id IN (SELECT property_id FROM ${propertyScope(org)} AS scope)`
  let deleted = 0
  // Reply observations and publication attempts reference each other with
  // RESTRICT keys; releasing the confirmation link first lets both go.
  await effects.releaseOrganizationAttemptConfirmations(tx, {
    organizationId: org,
    occurredAt: now,
  })
  // Children before parents; the snapshot run delete cascades its members and
  // deletion candidates.
  for (const table of [
    'google_reply_observation_heads',
    'google_reply_observations',
    'review_source_observations',
    'review_source_contents',
    'review_ai_analysis_heads',
    'review_ai_analysis_released_sequences',
    'review_google_reputation_snapshot_facts',
    'review_first_sightings',
    'review_provider_subjects',
    'review_provider_snapshot_runs',
    'review_provider_history_cutoffs',
  ] as const) {
    deleted += await affected(
      tx,
      sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${org}`,
    )
  }
  deleted += await effects.deleteOrganizationPublicationAttempts(tx, org)
  let scrubbed = await effects.scrubOrganizationReplyContent(tx, {
    organizationId: org,
    occurredAt: now,
  })
  scrubbed += await affected(
    tx,
    sql`UPDATE material_review_revisions
        SET content_state = 'source_expired', content_erased_at = ${now},
            rating = NULL, normalized_text = NULL,
            updated_at = GREATEST(updated_at, ${now}::timestamptz)
        WHERE organization_id = ${org} AND content_state = 'active'`,
  )
  scrubbed += await affected(
    tx,
    sql`UPDATE reviews
        SET source_content_state = 'source_expired', source_content_erased_at = ${now},
            content_expires_at = NULL, external_id = NULL, external_location_id = NULL,
            google_connection_id = NULL, reviewer_name = NULL,
            reviewer_profile_photo_url = NULL, google_review_url = NULL, rating = NULL,
            text = NULL, translated_text = NULL, language_code = NULL, reviewed_at = NULL,
            source_created_at = NULL, source_updated_at = NULL, content_hash = NULL,
            ai_source_byte_length = NULL, ai_source_digest = NULL,
            sentiment_label = NULL, sentiment_score = NULL,
            updated_at = GREATEST(updated_at, ${now}::timestamptz)
        WHERE organization_id = ${org} AND source_content_state = 'active'`,
  )
  deleted += await affected(
    tx,
    sql`DELETE FROM idempotency_receipts
        WHERE scope = 'gbp_webhook'
          AND payload->>'resolvedPropertyId' IN (SELECT property_id FROM ${propertyScope(org)} AS scope)`,
  )
  deleted += await affected(tx, sql`DELETE FROM review_sync_runs WHERE ${scopeRows}`)
  deleted += await affected(tx, sql`DELETE FROM review_sync_state WHERE ${scopeRows}`)

  // The layered reply library, child first.
  deleted += await affected(
    tx,
    sql`DELETE FROM reply_template_visibility WHERE organization_id = ${org}`,
  )
  deleted += await affected(
    tx,
    sql`DELETE FROM reply_template_wordings
        WHERE revision_id IN (
          SELECT revision.id FROM reply_template_revisions AS revision
          JOIN reply_templates AS template ON template.id = revision.template_id
          WHERE template.organization_id = ${org})`,
  )
  await affected(
    tx,
    sql`UPDATE reply_templates SET current_revision_id = NULL WHERE organization_id = ${org}`,
  )
  deleted += await affected(
    tx,
    sql`DELETE FROM reply_template_revisions
        WHERE template_id IN (SELECT id FROM reply_templates WHERE organization_id = ${org})`,
  )
  for (const table of [
    'reply_templates',
    'property_reply_voices',
    'organization_reply_voices',
  ] as const) {
    deleted += await affected(
      tx,
      sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${org}`,
    )
  }
  return { deleted, scrubbed }
}

export type ReviewClosureOutcome =
  | Readonly<{ ok: true; deleted: number; scrubbed: number }>
  | Readonly<{ ok: false; error: string }>

class ReviewNotReady extends Error {}

/**
 * Fence, check readiness, purge — one transaction. A blocker rolls the fence
 * back too, so a refused closure leaves the Organization exactly as it was.
 */
export async function closeReview(
  db: Database,
  effects: ReplyScopeEffects,
  organizationId: string,
  now: Date,
): Promise<ReviewClosureOutcome> {
  try {
    return await db.transaction(async (tx): Promise<ReviewClosureOutcome> => {
      if (!(await organizationExists(tx, organizationId))) {
        return { ok: false, error: 'organization not found' }
      }
      await fence(tx, effects, organizationId, now)
      const found = await readBlockers(tx, organizationId, now)
      if (found.length > 0) {
        throw new ReviewNotReady(
          `Review is not ready to close (${found.map((b) => `${b.code}=${b.count}`).join(',')})`,
        )
      }
      return { ok: true, ...(await purge(tx, effects, organizationId, now)) }
    })
  } catch (error) {
    if (error instanceof ReviewNotReady) return { ok: false, error: error.message }
    throw error
  }
}
