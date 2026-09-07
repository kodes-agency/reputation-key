// Review's Organization lifecycle contribution (LIF-01 T12/T13/T14).
//
// This is a cross-context adapter: it implements Identity's
// `organization-lifecycle-contributor.port`, which src/contexts/CONTEXT.md
// "Dependency rules" names as the one foreign module an adapter may import.
// Nothing else from Identity is reachable from here.
//
// Review is the context with real EXTERNAL effects, so the three phases split
// along the provider boundary:
//
//   closing  — STOP PROVIDER EFFECTS, KEEP DATA. No import, no sync, no reply
//              publication. Nothing is deleted or redacted: closure is
//              recoverable, and a cancelled closure must find its Reviews,
//              Replies and observation history exactly where it left them.
//   readiness— READ ONLY. It refuses while any provider interaction is still
//              unsettled, because the purge boundary is irreversible and a
//              send whose outcome is unknown must be reconciled first.
//   purge    — IRREVERSIBLE, idempotent, content-free scrub.
//
// Every phase runs through the shared, transaction-bound receipt store, which
// re-reads the live lifecycle authority under a row lock, serializes concurrent
// first attempts, and co-commits one content-free receipt with the phase work.

import { sql } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import {
  createOrganizationLifecycleContributorScaffold,
  validateContentFreeEvidenceRef,
  type OrganizationLifecyclePhaseOutcome,
  type OrganizationLifecycleContributionRequest,
} from '#/shared/db/lifecycle/organization-lifecycle-receipt-store'
import { sha256Hex } from '#/shared/domain/sha256'
import type { Tx } from '#/shared/outbox/commit'
import type { OrganizationLifecycleContributor } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'

type LifecyclePhase = 'closing' | 'purge_readiness' | 'purge'

/**
 * One content-free step record. `step` is a fixed code from this file and
 * `rows` is a count, so a receipt digest can never carry tenant content.
 */
type PhaseStep = Readonly<{ step: string; rows: number }>

/**
 * `review_sync_state`, `review_sync_runs` and the `gbp_webhook` idempotency
 * receipts are keyed by Property, not by Organization, so the tenant scope has
 * to be resolved. It is the UNION of two sources on purpose:
 *
 *   - `properties` covers a connected Property that has not produced a Review
 *     yet — exactly the one whose import is most important to fence;
 *   - `reviews` keeps the scope resolvable after Property's own purge has
 *     removed its rows, because Review retains a scrubbed, Organization-scoped
 *     Review identity (see `purge` below).
 */
const propertyScope = (organizationId: string) => sql`(
  SELECT id::text AS property_id FROM properties WHERE organization_id = ${organizationId}
  UNION
  SELECT DISTINCT property_id::text FROM reviews WHERE organization_id = ${organizationId}
)`

/**
 * Review tables that are scoped by `organization_id` and hold tenant content.
 * The presence probe uses this list so `no_data` means "Review holds nothing
 * for this Organization", not "this phase happened to change no rows".
 *
 * Child tables (source contents/observations, reply publication attempts,
 * Google reply observations and heads, snapshot members) are omitted: each one
 * hangs off a row already probed here.
 */
const PRESENCE_PROBE_TABLES = Object.freeze([
  'reviews',
  'replies',
  'review_provider_snapshot_runs',
  'review_ai_analysis_heads',
  'review_google_reputation_snapshot_facts',
] as const)

function phaseEvidenceRef(
  phase: LifecyclePhase,
  request: OrganizationLifecycleContributionRequest,
  steps: readonly PhaseStep[],
): string {
  const digest = sha256Hex(
    canonicalizeRfc8785({
      context: 'review',
      phase,
      closureLineageId: request.closureLineageId,
      lifecycleRevision: request.lifecycleRevision,
      steps: steps.map((entry) => ({ step: entry.step, rows: entry.rows })),
    }),
  )
  return validateContentFreeEvidenceRef(
    `review-lifecycle:${phase}:${request.closureLineageId}:${request.lifecycleRevision}:${digest.slice(0, 32)}`,
  )
}

async function countAffected(tx: Tx, statement: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(statement)
  return result.rowCount ?? 0
}

/**
 * Reads a single `count(*)::int AS blocked` scalar. A missing or unreadable
 * row is an error rather than a zero: a readiness check that silently counted
 * nothing would report "not blocked" for a query that never ran.
 */
async function countRows(tx: Tx, statement: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(statement)
  const value = Number((result.rows[0] as { blocked?: unknown } | undefined)?.blocked)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('review lifecycle readiness count is unreadable')
  }
  return value
}

/** True when Review holds at least one row for the Organization. */
async function hasReviewData(tx: Tx, organizationId: string): Promise<boolean> {
  for (const table of PRESENCE_PROBE_TABLES) {
    // `table` comes from the frozen literal list above, never from input.
    const probe = await tx.execute(
      sql`SELECT 1 FROM ${sql.raw(table)} WHERE organization_id = ${organizationId} LIMIT 1`,
    )
    if (probe.rows.length > 0) return true
  }
  return false
}

function outcomeFor(
  hasData: boolean,
  phase: LifecyclePhase,
  request: OrganizationLifecycleContributionRequest,
  steps: readonly PhaseStep[],
): OrganizationLifecyclePhaseOutcome {
  return {
    // `no_data` is affirmative evidence that Review held nothing, which is a
    // different claim from "this phase changed nothing".
    outcome: hasData ? 'complete' : 'no_data',
    evidenceRef: phaseEvidenceRef(phase, request, steps),
  }
}

/**
 * Closing stops every Review provider effect and deletes nothing.
 *
 * Two fences, and only two, because these are the only places Review decides
 * to talk to Google:
 *
 *  1. Import/sync scheduling. `review_sync_state` carries the due clocks the
 *     incremental, inventory and error-retry schedulers select on. Clearing
 *     them removes the Property from every due scan without deleting the
 *     cursor, watermark, source epoch or lease that a resumed sync needs, so a
 *     cancelled closure re-arms through the ordinary scheduling path.
 *  2. Reply publication. A Reply in `requested` or `authorized` has an
 *     authorized cycle but NO provider write yet, so `cancel` — the domain's
 *     own policy/disconnect event — is the honest terminal for it, and the
 *     Reply returns to `draft` exactly as a dispatch-time policy denial leaves
 *     it. A manager can re-approve after a cancelled closure; that starts a new
 *     publication cycle, which is why this is reversible without an inverse.
 *
 * `sending`, `pending_observation` and `ambiguous` are deliberately NOT
 * cancelled: a provider write is already out, and only reconciliation may
 * decide what happened. `verifyPurgeReadiness` blocks on them instead.
 *
 * Both statements are idempotent — a second pass matches no rows — and neither
 * touches Reply text, Review content, observation history or manager history.
 */
async function prepareClosing(
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> {
  const fencedSyncState = await countAffected(
    tx,
    sql`UPDATE review_sync_state
        SET next_incremental_at = NULL,
            next_inventory_at = NULL,
            error_retry_at = NULL,
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE property_id IN (SELECT property_id FROM ${propertyScope(request.organizationId)} AS scope)
          AND (next_incremental_at IS NOT NULL
               OR next_inventory_at IS NOT NULL
               OR error_retry_at IS NOT NULL)`,
  )
  const cancelledPublications = await countAffected(
    tx,
    sql`UPDATE replies
        SET publication_state = 'cancelled',
            status = 'draft',
            reconcile_due_at = NULL,
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE organization_id = ${request.organizationId}
          AND publication_state IN ('requested', 'authorized')`,
  )
  const hasData = await hasReviewData(tx, request.organizationId)
  return outcomeFor(hasData, 'closing', request, [
    { step: 'sync_schedules_fenced', rows: fencedSyncState },
    { step: 'pre_dispatch_publications_cancelled', rows: cancelledPublications },
  ])
}

/**
 * Read-only readiness. It issues SELECTs only.
 *
 * Every blocker names an unsettled EXTERNAL interaction. Crossing the
 * irreversible boundary with one of these open would either lose the record of
 * a reply that Google actually published, or leave a worker able to call the
 * provider for an Organization whose data is about to be erased. A blocked
 * readiness throws, which stops the coordinator; the message carries codes and
 * counts only.
 */
async function verifyPurgeReadiness(
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> {
  const activePublications = await countRows(
    tx,
    sql`SELECT count(*)::int AS blocked FROM replies
        WHERE organization_id = ${request.organizationId}
          AND publication_state IN ('requested', 'authorized', 'sending', 'pending_observation', 'ambiguous')`,
  )
  const unsettledAttempts = await countRows(
    tx,
    sql`SELECT count(*)::int AS blocked FROM reply_publication_attempts
        WHERE organization_id = ${request.organizationId}
          AND outcome IN ('sending', 'provider_outcome_pending', 'ambiguous')`,
  )
  const unfencedSyncSchedules = await countRows(
    tx,
    sql`SELECT count(*)::int AS blocked FROM review_sync_state
        WHERE property_id IN (SELECT property_id FROM ${propertyScope(request.organizationId)} AS scope)
          AND (next_incremental_at IS NOT NULL
               OR next_inventory_at IS NOT NULL
               OR error_retry_at IS NOT NULL
               OR lease_until > ${request.occurredAt}::timestamptz)`,
  )
  // An expired run can no longer act on the provider, so only a live
  // non-terminal snapshot run blocks. `occurredAt` is the supplied instant —
  // this phase reads no clock of its own.
  const openSnapshotRuns = await countRows(
    tx,
    sql`SELECT count(*)::int AS blocked FROM review_provider_snapshot_runs
        WHERE organization_id = ${request.organizationId}
          AND state NOT IN ('completed', 'failed')
          AND expires_at > ${request.occurredAt}::timestamptz`,
  )
  const steps: readonly PhaseStep[] = [
    { step: 'active_reply_publications', rows: activePublications },
    { step: 'unsettled_provider_attempts', rows: unsettledAttempts },
    { step: 'unfenced_sync_schedules', rows: unfencedSyncSchedules },
    { step: 'open_provider_snapshot_runs', rows: openSnapshotRuns },
  ]
  const blocking = steps.filter((entry) => entry.rows > 0)
  if (blocking.length > 0) {
    throw new Error(
      `review purge readiness blocked: ${blocking
        .map((entry) => `${entry.step}=${entry.rows}`)
        .join(',')}`,
    )
  }
  const hasData = await hasReviewData(tx, request.organizationId)
  return outcomeFor(hasData, 'purge_readiness', request, steps)
}

/**
 * Irreversible, idempotent, content-free scrub of Review's tenant content.
 *
 * The rule a reviewer can check in one line: DELETE everything that PostgreSQL
 * lets us delete, and SCRUB — through the database's own governed erased-content
 * shape — the identity spine it refuses to let us delete. Nothing here drops a
 * table, disables a trigger, or removes a compatibility mirror.
 *
 * What is retained, and why:
 *
 *  - `reply_publication_authorizations` is retained UNTOUCHED. An ALWAYS trigger
 *    rejects its UPDATE, DELETE and TRUNCATE independently of application code;
 *    that immutability is the proof that a named manager authorized one exact
 *    publication cycle. It is content-free already: identifiers, revisions,
 *    digests and timings, never Reply or Review text.
 *  - `replies`, `reviews` and `material_review_revisions` are therefore retained
 *    as SCRUBBED rows, because those authorizations reference them with
 *    `ON DELETE RESTRICT`, and Inbox's retained Handling Cycles reference the
 *    material revisions the same way. Their content columns are emptied into the
 *    exact shape the `*_content_state_valid` / `reviews_source_content_state_valid`
 *    CHECK constraints define for erased content, so the database itself
 *    verifies that no provider or guest value survived.
 *  - `retention_runs` and `review_refresh_runs` are untouched: they are
 *    platform-wide, content-free operational evidence with no Organization
 *    scope, and LIF-01 keeps them.
 *  - `review_provider_subject_hmac_key_versions` is untouched: it is the
 *    platform key registry, not tenant content.
 *
 * Manager-authored Reply TEXT is not independently retained evidence — the
 * authorization's `expected_reply_digest` is — so the text is emptied while the
 * authorization keeps its content-free proof.
 */
async function purge(
  tx: Tx,
  request: OrganizationLifecycleContributionRequest,
): Promise<OrganizationLifecyclePhaseOutcome> {
  const organizationId = request.organizationId
  const hasData = await hasReviewData(tx, organizationId)

  // `google_reply_observations` and `reply_publication_attempts` reference each
  // other with non-deferrable RESTRICT foreign keys (attempt -> confirming
  // observation, observation -> matched attempt). Releasing the confirmation
  // link first is the only way to delete either. `superseded` is a declared
  // attempt outcome and satisfies the `(outcome = 'confirmed') =
  // (confirmed_observation_revision IS NOT NULL)` check.
  const releasedConfirmations = await countAffected(
    tx,
    sql`UPDATE reply_publication_attempts
        SET outcome = 'superseded',
            confirmed_observation_revision = NULL,
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE organization_id = ${organizationId}
          AND confirmed_observation_revision IS NOT NULL`,
  )
  const observationHeads = await countAffected(
    tx,
    sql`DELETE FROM google_reply_observation_heads WHERE organization_id = ${organizationId}`,
  )
  const replyObservations = await countAffected(
    tx,
    sql`DELETE FROM google_reply_observations WHERE organization_id = ${organizationId}`,
  )
  // Provider operation and correlation identifiers live here; the row goes.
  const publicationAttempts = await countAffected(
    tx,
    sql`DELETE FROM reply_publication_attempts WHERE organization_id = ${organizationId}`,
  )
  const sourceObservations = await countAffected(
    tx,
    sql`DELETE FROM review_source_observations WHERE organization_id = ${organizationId}`,
  )
  const sourceContents = await countAffected(
    tx,
    sql`DELETE FROM review_source_contents WHERE organization_id = ${organizationId}`,
  )
  const aiAnalysisHeads = await countAffected(
    tx,
    sql`DELETE FROM review_ai_analysis_heads WHERE organization_id = ${organizationId}`,
  )
  const reputationFacts = await countAffected(
    tx,
    sql`DELETE FROM review_google_reputation_snapshot_facts WHERE organization_id = ${organizationId}`,
  )
  // HMAC mappings of provider review identifiers.
  const providerSubjects = await countAffected(
    tx,
    sql`DELETE FROM review_provider_subjects WHERE organization_id = ${organizationId}`,
  )
  // Cascades `review_provider_snapshot_members` and
  // `review_provider_deletion_candidates`, neither of which carries an
  // Organization column of its own.
  const snapshotRuns = await countAffected(
    tx,
    sql`DELETE FROM review_provider_snapshot_runs WHERE organization_id = ${organizationId}`,
  )

  // Manager-authored Reply text and the actor identifiers around it. The row
  // survives only because an immutable authorization references it.
  const scrubbedReplies = await countAffected(
    tx,
    sql`UPDATE replies
        SET text = '',
            rejection_reason = NULL,
            created_by = NULL,
            approved_by = NULL,
            rejected_by = NULL,
            reply_language_tag = NULL,
            reconcile_due_at = NULL,
            publication_last_error_class = NULL,
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE organization_id = ${organizationId}
          AND (text <> ''
               OR rejection_reason IS NOT NULL
               OR created_by IS NOT NULL
               OR approved_by IS NOT NULL
               OR rejected_by IS NOT NULL
               OR reply_language_tag IS NOT NULL)`,
  )
  const scrubbedMaterialRevisions = await countAffected(
    tx,
    sql`UPDATE material_review_revisions
        SET content_state = 'source_expired',
            content_erased_at = ${request.occurredAt},
            rating = NULL,
            normalized_text = NULL,
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE organization_id = ${organizationId}
          AND content_state = 'active'`,
  )
  const scrubbedReviews = await countAffected(
    tx,
    sql`UPDATE reviews
        SET source_content_state = 'source_expired',
            source_content_erased_at = ${request.occurredAt},
            external_id = NULL,
            external_location_id = NULL,
            google_connection_id = NULL,
            reviewer_name = NULL,
            reviewer_profile_photo_url = NULL,
            rating = NULL,
            text = NULL,
            translated_text = NULL,
            language_code = NULL,
            reviewed_at = NULL,
            source_created_at = NULL,
            source_updated_at = NULL,
            content_hash = NULL,
            ai_source_byte_length = NULL,
            ai_source_digest = NULL,
            sentiment_label = NULL,
            sentiment_score = NULL,
            updated_at = GREATEST(updated_at, ${request.occurredAt}::timestamptz)
        WHERE organization_id = ${organizationId}
          AND source_content_state = 'active'`,
  )

  // Provider notification message identifiers for this tenant's Properties.
  const webhookReceipts = await countAffected(
    tx,
    sql`DELETE FROM idempotency_receipts
        WHERE scope = 'gbp_webhook'
          AND payload->>'resolvedPropertyId' IN (SELECT property_id FROM ${propertyScope(organizationId)} AS scope)`,
  )
  const syncRuns = await countAffected(
    tx,
    sql`DELETE FROM review_sync_runs
        WHERE property_id IN (SELECT property_id FROM ${propertyScope(organizationId)} AS scope)`,
  )
  const syncState = await countAffected(
    tx,
    sql`DELETE FROM review_sync_state
        WHERE property_id IN (SELECT property_id FROM ${propertyScope(organizationId)} AS scope)`,
  )

  return outcomeFor(hasData, 'purge', request, [
    { step: 'attempt_confirmations_released', rows: releasedConfirmations },
    { step: 'reply_observation_heads_deleted', rows: observationHeads },
    { step: 'reply_observations_deleted', rows: replyObservations },
    { step: 'publication_attempts_deleted', rows: publicationAttempts },
    { step: 'source_observations_deleted', rows: sourceObservations },
    { step: 'source_contents_deleted', rows: sourceContents },
    { step: 'ai_analysis_heads_deleted', rows: aiAnalysisHeads },
    { step: 'reputation_snapshot_facts_deleted', rows: reputationFacts },
    { step: 'provider_subjects_deleted', rows: providerSubjects },
    { step: 'provider_snapshot_runs_deleted', rows: snapshotRuns },
    { step: 'replies_scrubbed', rows: scrubbedReplies },
    { step: 'material_revisions_scrubbed', rows: scrubbedMaterialRevisions },
    { step: 'reviews_scrubbed', rows: scrubbedReviews },
    { step: 'webhook_receipts_deleted', rows: webhookReceipts },
    { step: 'sync_runs_deleted', rows: syncRuns },
    { step: 'sync_state_deleted', rows: syncState },
  ])
}

/**
 * Build Review's lifecycle contributor.
 *
 * The scaffold supplies the authority binding, the advisory transaction lock
 * and the content-free receipt; only the three phase bodies above are
 * Review-specific, so a reviewer reads exactly those.
 */
export const createReviewOrganizationLifecycleContributor = (
  db: Database,
): OrganizationLifecycleContributor =>
  createOrganizationLifecycleContributorScaffold({
    db,
    context: 'review',
    prepareClosing,
    verifyPurgeReadiness,
    purge,
  })
