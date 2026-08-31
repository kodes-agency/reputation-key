import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  GUEST_RESPONSE_RECONCILIATION_REASON_CODES,
  buildGuestResponseReconciliationReport,
  classifyGuestResponseFactEvidence,
  type GuestResponseFactEvidenceAssessment,
  type GuestResponseRatingDistributions,
  type GuestResponseReconciliationDimension,
  type GuestResponseReconciliationFactIdentity,
  type GuestResponseReconciliationFactKind,
  type GuestResponseReconciliationOutcome,
  type GuestResponseReconciliationReasonCode,
  type GuestResponseReconciliationRow,
  type GuestResponseReconciliationSource,
  type GuestResponseStarDistribution,
} from '../../application/guest-response-reconciliation'

type RawRow = Readonly<{
  source: string
  sourceId: string
  dimension: string
  outcome: string
  organizationId: string
  propertyId: string | null
  portalId: string | null
  reasonCode: string
  relatedIds: string[] | null
}>

type RawFact = Readonly<{
  kind: string
  eventId: string
  organizationId: string
  propertyId: string
  portalId: string
  responseId: string
  supersedesSourceEventId: string | null
  star: number | null
  responseRevision: number | null
}>

type RawDistribution = Readonly<{
  kind: keyof GuestResponseRatingDistributions
  star: number
  count: number | string
}>

type RawFactEvidenceAssessment = Readonly<{
  kind: string
  eventId: string
  organizationId: string
  propertyId: string | null
  portalId: string | null
  responseId: string | null
  payloadValid: boolean
  schemaVersionKnown: boolean
  responseExists: boolean
  scopeExact: boolean
  sourceAggregateExact: boolean
  businessTimeExact: boolean
  staffAttribution: string
  feedbackRevision: string
}>

type QueryExecutor = Pick<Database, 'execute'>

const SOURCES = new Set<GuestResponseReconciliationSource>([
  'legacy_rating',
  'legacy_feedback',
  'guest_response',
  'durable_fact',
])
const DIMENSIONS = new Set<GuestResponseReconciliationDimension>([
  'legacy_relationship',
  'active_session_uniqueness',
  'experience_snapshot',
  'rating_lineage',
  'feedback_lineage',
  'integrity_history',
  'withdrawal_state',
  'media_state',
  'contact_state',
  'inbox_link',
  'retention_state',
  'fact_evidence',
])
const OUTCOMES = new Set<GuestResponseReconciliationOutcome>([
  'exact',
  'mappable',
  'conflict',
  'orphan',
  'unsafe',
])
const REASON_CODES = new Set<GuestResponseReconciliationReasonCode>(
  GUEST_RESPONSE_RECONCILIATION_REASON_CODES,
)
const FACT_KINDS = new Set<GuestResponseReconciliationFactKind>([
  'rating_submitted',
  'rating_retracted',
  'feedback_submitted',
  'feedback_retracted',
])
const STAFF_ATTRIBUTION_EVIDENCE = new Set<
  GuestResponseFactEvidenceAssessment['staffAttribution']
>(['exact', 'unknown', 'conflict', 'invalid'])
const FEEDBACK_REVISION_EVIDENCE = new Set<
  GuestResponseFactEvidenceAssessment['feedbackRevision']
>(['exact', 'unknown', 'not_applicable', 'conflict', 'invalid'])

function checkedRow(row: RawRow): GuestResponseReconciliationRow {
  if (!SOURCES.has(row.source as GuestResponseReconciliationSource)) {
    throw new Error(`unknown Guest Response reconciliation source: ${row.source}`)
  }
  if (!DIMENSIONS.has(row.dimension as GuestResponseReconciliationDimension)) {
    throw new Error(`unknown Guest Response reconciliation dimension: ${row.dimension}`)
  }
  if (!OUTCOMES.has(row.outcome as GuestResponseReconciliationOutcome)) {
    throw new Error(`unknown Guest Response reconciliation outcome: ${row.outcome}`)
  }
  if (!REASON_CODES.has(row.reasonCode as GuestResponseReconciliationReasonCode)) {
    throw new Error(`unknown Guest Response reconciliation reason: ${row.reasonCode}`)
  }
  return {
    source: row.source as GuestResponseReconciliationSource,
    sourceId: row.sourceId,
    dimension: row.dimension as GuestResponseReconciliationDimension,
    outcome: row.outcome as GuestResponseReconciliationOutcome,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    reasonCode: row.reasonCode as GuestResponseReconciliationReasonCode,
    relatedIds: row.relatedIds ?? [],
  }
}

function checkedFact(row: RawFact): GuestResponseReconciliationFactIdentity {
  if (!FACT_KINDS.has(row.kind as GuestResponseReconciliationFactKind)) {
    throw new Error(`unknown Guest Response fact identity kind: ${row.kind}`)
  }
  const star = row.star
  if (star !== null && ![1, 2, 3, 4, 5].includes(star)) {
    throw new Error(`invalid Guest Response fact identity star: ${star}`)
  }
  return {
    kind: row.kind as GuestResponseReconciliationFactKind,
    eventId: row.eventId,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalId: row.portalId,
    responseId: row.responseId,
    supersedesSourceEventId: row.supersedesSourceEventId,
    star: star as 1 | 2 | 3 | 4 | 5 | null,
    responseRevision: row.responseRevision,
  }
}

function checkedFactEvidenceAssessment(
  row: RawFactEvidenceAssessment,
): GuestResponseFactEvidenceAssessment {
  if (!FACT_KINDS.has(row.kind as GuestResponseReconciliationFactKind)) {
    throw new Error(`unknown Guest Response fact evidence kind: ${row.kind}`)
  }
  if (
    !STAFF_ATTRIBUTION_EVIDENCE.has(
      row.staffAttribution as GuestResponseFactEvidenceAssessment['staffAttribution'],
    ) ||
    !FEEDBACK_REVISION_EVIDENCE.has(
      row.feedbackRevision as GuestResponseFactEvidenceAssessment['feedbackRevision'],
    )
  ) {
    throw new Error('unknown Guest Response fact evidence classification')
  }
  for (const [field, value] of Object.entries({
    payloadValid: row.payloadValid,
    schemaVersionKnown: row.schemaVersionKnown,
    responseExists: row.responseExists,
    scopeExact: row.scopeExact,
    sourceAggregateExact: row.sourceAggregateExact,
    businessTimeExact: row.businessTimeExact,
  })) {
    if (typeof value !== 'boolean') {
      throw new Error(`Guest Response fact evidence ${field} must be boolean`)
    }
  }
  return {
    ...row,
    kind: row.kind as GuestResponseReconciliationFactKind,
    staffAttribution:
      row.staffAttribution as GuestResponseFactEvidenceAssessment['staffAttribution'],
    feedbackRevision:
      row.feedbackRevision as GuestResponseFactEvidenceAssessment['feedbackRevision'],
  }
}

function emptyDistribution(): GuestResponseStarDistribution {
  return { one: 0, two: 0, three: 0, four: 0, five: 0, total: 0 }
}

function distributionsFromRows(
  rows: readonly RawDistribution[],
): GuestResponseRatingDistributions {
  const result: Record<
    keyof GuestResponseRatingDistributions,
    GuestResponseStarDistribution
  > = {
    legacyRatings: emptyDistribution(),
    canonicalRetainedRatings: emptyDistribution(),
    canonicalEffectiveRatings: emptyDistribution(),
    durableRatingFactHeads: emptyDistribution(),
  }
  const keyForStar = ['one', 'two', 'three', 'four', 'five'] as const
  for (const row of rows) {
    const key = keyForStar[row.star - 1]
    const count = Number(row.count)
    if (!key || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('invalid Guest Response rating distribution row')
    }
    result[row.kind] = {
      ...result[row.kind],
      [key]: count,
      total: result[row.kind].total + count,
    }
  }
  return result
}

function organizationPredicate(
  organizationIds: readonly string[],
  column: ReturnType<typeof sql>,
) {
  return organizationIds.length === 0
    ? sql`TRUE`
    : sql`${column} IN (${sql.join(
        organizationIds.map((organizationId) => sql`${organizationId}`),
        sql`, `,
      )})`
}

async function readRows(
  db: QueryExecutor,
  observedAt: Date,
  organizationIds: readonly string[],
): Promise<readonly GuestResponseReconciliationRow[]> {
  const ratingScope = organizationPredicate(organizationIds, sql`r.organization_id`)
  const feedbackScope = organizationPredicate(organizationIds, sql`f.organization_id`)
  const responseScope = organizationPredicate(organizationIds, sql`r.organization_id`)
  const eventScope = organizationPredicate(organizationIds, sql`e.organization_id`)
  const result = await db.execute(sql`
    WITH scoped_ratings AS (
      SELECT r.id, r.organization_id, r.property_id, r.portal_id, r.session_id,
             r.value, r.source, r.ip_hash, r.created_at
      FROM ratings r
      WHERE ${ratingScope} AND r.created_at <= ${observedAt}
    ),
    scoped_feedback AS (
      SELECT f.id, f.organization_id, f.property_id, f.portal_id, f.session_id,
             f.rating_id, f.source, f.ip_hash, f.created_at
      FROM feedback f
      WHERE ${feedbackScope} AND f.created_at <= ${observedAt}
    ),
    scoped_responses AS (
      SELECT r.id, r.organization_id, r.property_id, r.portal_id, r.status,
             r.integrity_outcome, r.integrity_reason_code, r.integrity_revision,
             r.integrity_assessed_at, r.rating, r.response_consent,
             r.text_consent, r.media_consent, r.private_feedback_threshold,
             r.rating_source_event_id, r.feedback_source_event_id,
             r.submitted_at, r.feedback_submitted_at,
             r.feedback_submission_revision, r.feedback_withdrawn_at,
             r.retention_deadline, r.created_at, r.deleted_at
      FROM guest_responses r
      WHERE ${responseScope} AND r.created_at <= ${observedAt}
    ),
    guest_events AS (
      SELECT e.id, e.event_type, e.organization_id, e.property_id, e.payload,
             e.created_at
      FROM outbox_events e
      WHERE ${eventScope}
        AND e.source_context = 'guest'
        AND e.created_at <= ${observedAt}
        AND e.event_type IN (
          'guest.rating.submitted', 'guest.rating.retracted',
          'guest.feedback.submitted', 'guest.feedback.retracted'
        )
    ),
    rating_events AS (
      SELECT e.id::text AS event_id,
             e.event_type,
             e.organization_id,
             e.property_id,
             e.payload ->> 'portalId' AS portal_id,
             e.payload ->> 'ratingId' AS response_id,
             e.payload ->> 'supersedesSourceEventId' AS supersedes_source_event_id,
             CASE WHEN (e.payload ->> 'value') ~ '^[1-5]$'
               THEN (e.payload ->> 'value')::integer ELSE NULL END AS star
      FROM guest_events e
      WHERE e.event_type IN ('guest.rating.submitted', 'guest.rating.retracted')
    ),
    feedback_events AS (
      SELECT e.id::text AS event_id,
             e.event_type,
             e.organization_id,
             e.property_id,
             e.payload ->> 'portalId' AS portal_id,
             e.payload ->> 'feedbackId' AS response_id,
             e.payload ->> 'supersedesSourceEventId' AS supersedes_source_event_id,
             CASE WHEN (e.payload ->> 'responseRevision') ~ '^[1-9][0-9]*$'
               THEN (e.payload ->> 'responseRevision')::integer ELSE NULL END
               AS response_revision
      FROM guest_events e
      WHERE e.event_type IN ('guest.feedback.submitted', 'guest.feedback.retracted')
    ),
    active_rating_sources AS (
      SELECT 'legacy_rating'::text AS source, r.id::text AS source_id,
             r.organization_id, r.property_id::text, r.portal_id,
             r.session_id::text AS session_id
      FROM scoped_ratings r
      WHERE r.session_id IS NOT NULL
        AND r.created_at + interval '24 hours' > ${observedAt}

      UNION ALL

      SELECT 'guest_response'::text, r.id::text, r.organization_id,
             r.property_id::text, r.portal_id, binding.session_id::text
      FROM scoped_responses r
      JOIN guest_response_session_bindings binding
        ON binding.response_id = r.id
       AND binding.organization_id = r.organization_id
       AND binding.property_id = r.property_id
       AND binding.portal_id = r.portal_id
      WHERE r.rating IS NOT NULL
        AND r.submitted_at IS NOT NULL
        AND binding.expires_at > ${observedAt}
        AND binding.created_at <= ${observedAt}
    ),
    duplicate_active_sessions AS (
      SELECT organization_id, portal_id, session_id,
             array_agg(source_id ORDER BY source_id)::text[] AS source_ids
      FROM active_rating_sources
      GROUP BY organization_id, portal_id, session_id
      HAVING count(*) > 1
    ),
    response_evidence AS (
      SELECT r.*,
             experience.response_id AS experience_id,
             experience.publication_snapshot_id,
             experience.publication_version,
             experience.publication_digest,
             experience.private_feedback_threshold AS snapshot_threshold,
             publication.id AS known_publication_id,
             publication.private_feedback_threshold AS publication_threshold,
             COALESCE(rating_stats.submitted_count, 0) AS rating_submitted_count,
             COALESCE(rating_stats.retracted_count, 0) AS rating_retracted_count,
             COALESCE(rating_stats.current_match_count, 0) AS rating_current_match_count,
             COALESCE(rating_stats.root_count, 0) AS rating_root_count,
             COALESCE(rating_stats.scope_conflict_count, 0)
               AS rating_scope_conflict_count,
             COALESCE(rating_stats.missing_target_count, 0) AS rating_missing_target_count,
             COALESCE(rating_stats.branch_count, 0) AS rating_branch_count,
             COALESCE(feedback_stats.submitted_count, 0) AS feedback_event_count,
             COALESCE(feedback_stats.retracted_count, 0) AS feedback_retracted_count,
             COALESCE(feedback_stats.current_match_count, 0) AS feedback_current_match_count,
             COALESCE(feedback_stats.root_count, 0) AS feedback_root_count,
             COALESCE(feedback_stats.scope_conflict_count, 0)
               AS feedback_scope_conflict_count,
             COALESCE(feedback_stats.missing_target_count, 0) AS feedback_missing_target_count,
             COALESCE(feedback_stats.branch_count, 0) AS feedback_branch_count,
             COALESCE(integrity_stats.decision_count, 0) AS integrity_decision_count,
             COALESCE(integrity_stats.chain_conflict_count, 0)
               AS integrity_chain_conflict_count,
             integrity_stats.minimum_revision,
             integrity_stats.maximum_revision,
             integrity_stats.latest_outcome,
             integrity_stats.latest_reason_code,
             integrity_stats.latest_decided_at,
             COALESCE(content_stats.content_count, 0) AS content_count,
             COALESCE(content_stats.expired_count, 0) AS expired_content_count,
             COALESCE(content_stats.invalid_window_count, 0)
               AS invalid_content_window_count,
             COALESCE(content_stats.content_ids, ARRAY[]::text[]) AS content_ids,
             COALESCE(binding_stats.expired_count, 0) AS expired_binding_count,
             COALESCE(binding_stats.invalid_window_count, 0)
               AS invalid_binding_window_count,
             COALESCE(binding_stats.binding_ids, ARRAY[]::text[]) AS binding_ids,
             COALESCE(media_stats.active_count, 0) AS active_media_count,
             COALESCE(media_stats.nonterminal_count, 0) AS nonterminal_media_count,
             COALESCE(media_stats.media_ids, ARRAY[]::text[]) AS media_ids,
             COALESCE(contact_stats.active_count, 0) AS active_contact_count,
             COALESCE(contact_stats.overdue_count, 0) AS overdue_contact_count,
             COALESCE(contact_stats.contact_ids, ARRAY[]::text[]) AS contact_ids,
             COALESCE(inbox_stats.item_count, 0) AS inbox_item_count,
             COALESCE(inbox_stats.scope_conflict_count, 0) AS inbox_scope_conflict_count,
             COALESCE(inbox_stats.open_count, 0) AS inbox_open_count,
             COALESCE(inbox_stats.item_ids, ARRAY[]::text[]) AS inbox_item_ids
      FROM scoped_responses r
      LEFT JOIN guest_response_experience_snapshots experience
        ON experience.response_id = r.id
       AND experience.organization_id = r.organization_id
       AND experience.captured_at <= ${observedAt}
      LEFT JOIN portal_publication_snapshots publication
        ON publication.organization_id = experience.organization_id
       AND publication.property_id = experience.property_id
       AND publication.portal_id = experience.portal_id
       AND publication.id = experience.publication_snapshot_id
       AND publication.version = experience.publication_version
       AND publication.configuration_digest = experience.publication_digest
       AND publication.created_at <= ${observedAt}
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (
                 WHERE event_type = 'guest.rating.submitted'
               )::integer AS submitted_count,
               count(*) FILTER (
                 WHERE event_type = 'guest.rating.retracted'
               )::integer AS retracted_count,
               count(*) FILTER (
                 WHERE event_id = r.rating_source_event_id
                   AND event_type = 'guest.rating.submitted'
                   AND organization_id = r.organization_id
                   AND property_id = r.property_id::text
                   AND portal_id = r.portal_id::text
                   AND response_id = r.id::text
                   AND star = r.rating
                   AND NOT EXISTS (
                     SELECT 1 FROM rating_events successor
                     WHERE successor.organization_id = source.organization_id
                       AND successor.response_id = source.response_id
                       AND successor.supersedes_source_event_id = source.event_id
                   )
               )::integer AS current_match_count,
               count(*) FILTER (
                 WHERE supersedes_source_event_id IS NULL
               )::integer AS root_count,
               count(*) FILTER (
                 WHERE property_id IS DISTINCT FROM r.property_id::text
                    OR portal_id IS DISTINCT FROM r.portal_id::text
               )::integer AS scope_conflict_count,
               count(*) FILTER (
                 WHERE supersedes_source_event_id IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM rating_events target
                     WHERE target.event_id = source.supersedes_source_event_id
                       AND target.organization_id = source.organization_id
                       AND target.response_id = source.response_id
                   )
               )::integer AS missing_target_count,
               COALESCE((
                 SELECT count(*)::integer
                 FROM (
                   SELECT successor.supersedes_source_event_id
                   FROM rating_events successor
                   WHERE successor.organization_id = r.organization_id
                     AND successor.response_id = r.id::text
                     AND successor.supersedes_source_event_id IS NOT NULL
                   GROUP BY successor.supersedes_source_event_id
                   HAVING count(*) > 1
                 ) branches
               ), 0)::integer AS branch_count
        FROM rating_events source
        WHERE source.organization_id = r.organization_id
          AND source.response_id = r.id::text
      ) rating_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (
                 WHERE event_type = 'guest.feedback.submitted'
               )::integer AS submitted_count,
               count(*) FILTER (
                 WHERE event_type = 'guest.feedback.retracted'
               )::integer AS retracted_count,
               count(*) FILTER (
                 WHERE event_id = r.feedback_source_event_id
                   AND event_type = 'guest.feedback.submitted'
                   AND organization_id = r.organization_id
                   AND property_id = r.property_id::text
                   AND portal_id = r.portal_id::text
                   AND response_id = r.id::text
                   AND response_revision = r.feedback_submission_revision
                   AND NOT EXISTS (
                     SELECT 1 FROM feedback_events successor
                     WHERE successor.organization_id = source.organization_id
                       AND successor.response_id = source.response_id
                       AND successor.supersedes_source_event_id = source.event_id
                   )
               )::integer AS current_match_count,
               count(*) FILTER (
                 WHERE supersedes_source_event_id IS NULL
               )::integer AS root_count,
               count(*) FILTER (
                 WHERE property_id IS DISTINCT FROM r.property_id::text
                    OR portal_id IS DISTINCT FROM r.portal_id::text
               )::integer AS scope_conflict_count,
               count(*) FILTER (
                 WHERE supersedes_source_event_id IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM feedback_events target
                     WHERE target.event_id = source.supersedes_source_event_id
                       AND target.organization_id = source.organization_id
                       AND target.response_id = source.response_id
                   )
               )::integer AS missing_target_count,
               COALESCE((
                 SELECT count(*)::integer
                 FROM (
                   SELECT successor.supersedes_source_event_id
                   FROM feedback_events successor
                   WHERE successor.organization_id = r.organization_id
                     AND successor.response_id = r.id::text
                     AND successor.supersedes_source_event_id IS NOT NULL
                   GROUP BY successor.supersedes_source_event_id
                   HAVING count(*) > 1
                 ) branches
               ), 0)::integer AS branch_count
        FROM feedback_events source
        WHERE source.organization_id = r.organization_id
          AND source.response_id = r.id::text
      ) feedback_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS decision_count,
               min(revision)::integer AS minimum_revision,
               max(revision)::integer AS maximum_revision,
               count(*) FILTER (
                 WHERE (revision = 1 AND previous_outcome IS NOT NULL)
                    OR (revision > 1 AND previous_outcome IS DISTINCT FROM prior_outcome)
               )::integer AS chain_conflict_count,
               (array_agg(outcome ORDER BY revision DESC))[1] AS latest_outcome,
               (array_agg(reason_code ORDER BY revision DESC))[1]
                 AS latest_reason_code,
               (array_agg(decided_at ORDER BY revision DESC))[1]
                 AS latest_decided_at
        FROM (
          SELECT decision.*,
                 lag(outcome) OVER (ORDER BY revision) AS prior_outcome
          FROM guest_response_integrity_decisions decision
          WHERE decision.response_id = r.id
            AND decision.organization_id = r.organization_id
            AND decision.decided_at <= ${observedAt}
        ) decisions
      ) integrity_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS content_count,
               count(*) FILTER (WHERE content.expires_at <= ${observedAt})::integer
                 AS expired_count,
               count(*) FILTER (
                 WHERE content.expires_at <> content.submitted_at + interval '90 days'
               )::integer AS invalid_window_count,
               array_agg(content.response_id::text ORDER BY content.response_id)::text[]
                 AS content_ids
        FROM guest_response_private_feedback content
        WHERE content.response_id = r.id
          AND content.organization_id = r.organization_id
          AND content.created_at <= ${observedAt}
      ) content_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE binding.expires_at <= ${observedAt})::integer
                 AS expired_count,
               count(*) FILTER (
                 WHERE binding.expires_at <> binding.created_at + interval '24 hours'
               )::integer AS invalid_window_count,
               array_agg(binding.response_id::text ORDER BY binding.response_id)::text[]
                 AS binding_ids
        FROM guest_response_session_bindings binding
        WHERE binding.response_id = r.id
          AND binding.organization_id = r.organization_id
          AND binding.created_at <= ${observedAt}
      ) binding_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (
                 WHERE media.deleted_at IS NULL
                   AND media.status IN ('issued', 'processing', 'ready')
               )::integer AS active_count,
               count(*) FILTER (
                 WHERE media.deleted_at IS NULL
                   AND media.status NOT IN (
                     'purge_pending', 'deleted', 'quarantined', 'expired'
                   )
               )::integer AS nonterminal_count,
               array_agg(media.id::text ORDER BY media.id)::text[] AS media_ids
        FROM guest_response_media media
        WHERE media.response_id = r.id
          AND media.organization_id = r.organization_id
          AND media.created_at <= ${observedAt}
      ) media_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (
                 WHERE contact.status = 'active' AND contact.expires_at > ${observedAt}
               )::integer AS active_count,
               count(*) FILTER (
                 WHERE contact.status = 'active' AND contact.expires_at <= ${observedAt}
               )::integer AS overdue_count,
               array_agg(contact.id::text ORDER BY contact.id)::text[] AS contact_ids
        FROM guest_contact_requests contact
        WHERE contact.response_id = r.id
          AND contact.organization_id = r.organization_id
          AND contact.created_at <= ${observedAt}
      ) contact_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS item_count,
               count(*) FILTER (
                 WHERE item.property_id <> r.property_id::text
               )::integer AS scope_conflict_count,
               count(*) FILTER (WHERE item.status = 'open')::integer AS open_count,
               array_agg(item.id::text ORDER BY item.id)::text[] AS item_ids
        FROM inbox_items item
        WHERE item.organization_id = r.organization_id
          AND item.source_type = 'feedback'
          AND item.source_id = r.id
          AND item.created_at <= ${observedAt}
      ) inbox_stats ON TRUE
    ),
    observations AS (
      SELECT 'legacy_rating'::text AS "source", r.id::text AS "sourceId",
             'legacy_relationship'::text AS "dimension",
             CASE
               WHEN r.value NOT BETWEEN 1 AND 5 OR r.source NOT IN ('qr','nfc','direct')
                 THEN 'unsafe'
               WHEN portal.id IS NULL THEN 'orphan'
               WHEN portal.organization_id <> r.organization_id
                 OR portal.property_id::text <> r.property_id THEN 'conflict'
               WHEN canonical.id IS NOT NULL
                 AND canonical.organization_id = r.organization_id
                 AND canonical.property_id::text = r.property_id
                 AND canonical.portal_id = r.portal_id
                 AND canonical.rating = r.value
                 AND canonical.rating_source_event_id IS NOT NULL
                 AND current_event.event_id = canonical.rating_source_event_id
                 THEN 'exact'
               WHEN canonical.id IS NOT NULL THEN 'conflict'
               WHEN COALESCE(linked.conflict_count, 0) > 0
                 OR COALESCE(linked.feedback_count, 0) > 1 THEN 'conflict'
               ELSE 'mappable'
             END::text AS "outcome",
             r.organization_id::text AS "organizationId",
             CASE WHEN portal.organization_id = r.organization_id
                    AND portal.property_id::text = r.property_id
               THEN portal.property_id::text ELSE NULL END AS "propertyId",
             r.portal_id::text AS "portalId",
             CASE
               WHEN r.value NOT BETWEEN 1 AND 5 OR r.source NOT IN ('qr','nfc','direct')
                 THEN 'legacy_rating_invalid_value_or_source'
               WHEN portal.id IS NULL THEN 'legacy_rating_portal_missing'
               WHEN portal.organization_id <> r.organization_id
                 OR portal.property_id::text <> r.property_id
                 THEN 'legacy_rating_scope_conflict'
               WHEN canonical.id IS NOT NULL
                 AND canonical.organization_id = r.organization_id
                 AND canonical.property_id::text = r.property_id
                 AND canonical.portal_id = r.portal_id
                 AND canonical.rating = r.value
                 AND canonical.rating_source_event_id IS NOT NULL
                 AND current_event.event_id = canonical.rating_source_event_id
                 THEN 'legacy_rating_matches_canonical'
               WHEN canonical.id IS NOT NULL THEN 'legacy_rating_canonical_conflict'
               WHEN COALESCE(linked.conflict_count, 0) > 0
                 OR COALESCE(linked.feedback_count, 0) > 1
                 THEN 'legacy_rating_scope_conflict'
               ELSE 'legacy_rating_can_map'
             END::text AS "reasonCode",
             (COALESCE(linked.feedback_ids, ARRAY[]::text[])
               || CASE WHEN canonical.id IS NULL THEN ARRAY[]::text[]
                       ELSE ARRAY[canonical.id::text] END)::text[] AS "relatedIds"
      FROM scoped_ratings r
      LEFT JOIN portals portal ON portal.id = r.portal_id
      LEFT JOIN scoped_responses canonical ON canonical.id = r.id
      LEFT JOIN rating_events current_event
        ON current_event.event_id = canonical.rating_source_event_id
       AND current_event.response_id = canonical.id::text
       AND current_event.organization_id = canonical.organization_id
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS feedback_count,
               count(*) FILTER (
                 WHERE f.organization_id <> r.organization_id
                    OR f.portal_id <> r.portal_id
                    OR f.property_id <> r.property_id
                    OR (f.session_id IS NOT NULL AND r.session_id IS NOT NULL
                        AND f.session_id <> r.session_id)
               )::integer AS conflict_count,
               array_agg(f.id::text ORDER BY f.id)::text[] AS feedback_ids
        FROM scoped_feedback f WHERE f.rating_id = r.id
      ) linked ON TRUE

      UNION ALL

      SELECT 'legacy_feedback', f.id::text, 'legacy_relationship',
             CASE
               WHEN f.source NOT IN ('qr','nfc','direct') THEN 'unsafe'
               WHEN portal.id IS NULL THEN 'orphan'
               WHEN portal.organization_id <> f.organization_id
                 OR portal.property_id::text <> f.property_id THEN 'conflict'
               WHEN canonical.id IS NOT NULL
                 AND canonical.organization_id = f.organization_id
                 AND canonical.property_id::text = f.property_id
                 AND canonical.portal_id = f.portal_id
                 AND canonical.feedback_source_event_id IS NOT NULL
                 AND current_event.event_id = canonical.feedback_source_event_id
                 THEN 'exact'
               WHEN canonical.id IS NOT NULL THEN 'conflict'
               WHEN f.rating_id IS NOT NULL AND explicit_rating.id IS NULL THEN 'orphan'
               WHEN f.rating_id IS NOT NULL AND (
                 explicit_rating.organization_id <> f.organization_id
                 OR explicit_rating.portal_id <> f.portal_id
                 OR explicit_rating.property_id <> f.property_id
               ) THEN 'conflict'
               WHEN f.rating_id IS NOT NULL
                 AND f.session_id IS NOT NULL
                 AND explicit_rating.session_id IS NOT NULL
                 AND f.session_id <> explicit_rating.session_id THEN 'conflict'
               WHEN f.rating_id IS NOT NULL THEN 'mappable'
               WHEN f.session_id IS NULL OR COALESCE(candidate.rating_count, 0) = 0
                 THEN 'orphan'
               WHEN candidate.rating_count > 1 THEN 'conflict'
               ELSE 'mappable'
             END::text,
             f.organization_id::text,
             CASE WHEN portal.organization_id = f.organization_id
                    AND portal.property_id::text = f.property_id
               THEN portal.property_id::text ELSE NULL END,
             f.portal_id::text,
             CASE
               WHEN f.source NOT IN ('qr','nfc','direct')
                 THEN 'legacy_feedback_invalid_source'
               WHEN portal.id IS NULL THEN 'legacy_feedback_portal_missing'
               WHEN portal.organization_id <> f.organization_id
                 OR portal.property_id::text <> f.property_id
                 THEN 'legacy_feedback_scope_conflict'
               WHEN canonical.id IS NOT NULL
                 AND canonical.organization_id = f.organization_id
                 AND canonical.property_id::text = f.property_id
                 AND canonical.portal_id = f.portal_id
                 AND canonical.feedback_source_event_id IS NOT NULL
                 AND current_event.event_id = canonical.feedback_source_event_id
                 THEN 'legacy_feedback_matches_canonical'
               WHEN canonical.id IS NOT NULL THEN 'legacy_feedback_scope_conflict'
               WHEN f.rating_id IS NOT NULL AND explicit_rating.id IS NULL
                 THEN 'legacy_feedback_rating_missing'
               WHEN f.rating_id IS NOT NULL AND (
                 explicit_rating.organization_id <> f.organization_id
                 OR explicit_rating.portal_id <> f.portal_id
                 OR explicit_rating.property_id <> f.property_id
               ) THEN 'legacy_feedback_rating_scope_conflict'
               WHEN f.rating_id IS NOT NULL
                 AND f.session_id IS NOT NULL
                 AND explicit_rating.session_id IS NOT NULL
                 AND f.session_id <> explicit_rating.session_id
                 THEN 'legacy_feedback_session_conflict'
               WHEN f.rating_id IS NOT NULL
                 THEN 'legacy_feedback_can_map_by_rating_id'
               WHEN f.session_id IS NULL OR COALESCE(candidate.rating_count, 0) = 0
                 THEN 'legacy_feedback_without_rating'
               WHEN candidate.rating_count > 1
                 THEN 'legacy_feedback_multiple_rating_candidates'
               ELSE 'legacy_feedback_can_map_by_unique_session'
             END::text,
             (CASE WHEN explicit_rating.id IS NULL THEN ARRAY[]::text[]
                   ELSE ARRAY[explicit_rating.id::text] END
               || COALESCE(candidate.rating_ids, ARRAY[]::text[])
               || CASE WHEN canonical.id IS NULL THEN ARRAY[]::text[]
                       ELSE ARRAY[canonical.id::text] END)::text[]
      FROM scoped_feedback f
      LEFT JOIN portals portal ON portal.id = f.portal_id
      LEFT JOIN scoped_ratings explicit_rating ON explicit_rating.id = f.rating_id
      LEFT JOIN scoped_responses canonical ON canonical.id = f.id
      LEFT JOIN feedback_events current_event
        ON current_event.event_id = canonical.feedback_source_event_id
       AND current_event.response_id = canonical.id::text
       AND current_event.organization_id = canonical.organization_id
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS rating_count,
               array_agg(r.id::text ORDER BY r.id)::text[] AS rating_ids
        FROM scoped_ratings r
        WHERE f.rating_id IS NULL
          AND f.session_id IS NOT NULL
          AND r.session_id = f.session_id
          AND r.organization_id = f.organization_id
          AND r.portal_id = f.portal_id
          AND r.property_id = f.property_id
          AND r.created_at <= f.created_at
      ) candidate ON TRUE

      UNION ALL

      SELECT 'legacy_rating', r.id::text, 'experience_snapshot', 'unsafe',
             r.organization_id::text,
             CASE WHEN portal.organization_id = r.organization_id
                    AND portal.property_id::text = r.property_id
               THEN portal.property_id::text ELSE NULL END,
             r.portal_id::text, 'legacy_experience_snapshot_unknown',
             ARRAY[]::text[]
      FROM scoped_ratings r LEFT JOIN portals portal ON portal.id = r.portal_id

      UNION ALL

      SELECT active.source, active.source_id, 'active_session_uniqueness',
             'conflict', active.organization_id,
             active.property_id::text, active.portal_id::text,
             CASE WHEN active.source = 'legacy_rating'
               THEN 'legacy_active_session_duplicate'
               ELSE 'canonical_active_session_duplicate' END,
             array_remove(duplicate.source_ids, active.source_id)::text[]
      FROM active_rating_sources active
      JOIN duplicate_active_sessions duplicate
        ON duplicate.organization_id = active.organization_id
       AND duplicate.portal_id = active.portal_id
       AND duplicate.session_id = active.session_id

      UNION ALL

      SELECT 'legacy_feedback', f.id::text, 'inbox_link',
             CASE WHEN COALESCE(items.scope_conflict_count, 0) > 0 THEN 'conflict'
                  WHEN COALESCE(items.item_count, 0) = 0 THEN 'orphan'
                  ELSE 'exact' END,
             f.organization_id,
             CASE WHEN portal.organization_id = f.organization_id
                    AND portal.property_id::text = f.property_id
               THEN portal.property_id::text ELSE NULL END,
             f.portal_id::text,
             CASE WHEN COALESCE(items.scope_conflict_count, 0) > 0
                    THEN 'legacy_inbox_link_scope_conflict'
                  WHEN COALESCE(items.item_count, 0) = 0
                    THEN 'legacy_inbox_link_missing'
                  ELSE 'legacy_inbox_link_exact' END,
             COALESCE(items.item_ids, ARRAY[]::text[])
      FROM scoped_feedback f
      LEFT JOIN portals portal ON portal.id = f.portal_id
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS item_count,
               count(*) FILTER (
                 WHERE item.property_id <> f.property_id
               )::integer AS scope_conflict_count,
               array_agg(item.id::text ORDER BY item.id)::text[] AS item_ids
        FROM inbox_items item
        WHERE item.organization_id = f.organization_id
          AND item.source_type = 'feedback'
          AND item.source_id = f.id
          AND item.created_at <= ${observedAt}
      ) items ON TRUE

      UNION ALL

      SELECT 'legacy_rating', r.id::text, 'retention_state', 'unsafe',
             r.organization_id,
             CASE WHEN portal.organization_id = r.organization_id
                    AND portal.property_id::text = r.property_id
               THEN portal.property_id::text ELSE NULL END,
             r.portal_id::text, 'legacy_network_pseudonym_retained',
             ARRAY[]::text[]
      FROM scoped_ratings r LEFT JOIN portals portal ON portal.id = r.portal_id
      WHERE r.ip_hash IS NOT NULL

      UNION ALL

      SELECT 'legacy_feedback', f.id::text, 'retention_state', 'unsafe',
             f.organization_id,
             CASE WHEN portal.organization_id = f.organization_id
                    AND portal.property_id::text = f.property_id
               THEN portal.property_id::text ELSE NULL END,
             f.portal_id::text, 'legacy_network_pseudonym_retained',
             ARRAY[]::text[]
      FROM scoped_feedback f LEFT JOIN portals portal ON portal.id = f.portal_id
      WHERE f.ip_hash IS NOT NULL

      UNION ALL

      SELECT 'legacy_rating', r.id::text, 'retention_state', 'unsafe',
             r.organization_id,
             CASE WHEN portal.organization_id = r.organization_id
                    AND portal.property_id::text = r.property_id
               THEN portal.property_id::text ELSE NULL END,
             r.portal_id::text, 'legacy_session_retention_overdue',
             ARRAY[]::text[]
      FROM scoped_ratings r LEFT JOIN portals portal ON portal.id = r.portal_id
      WHERE r.session_id IS NOT NULL
        AND r.created_at + interval '24 hours' <= ${observedAt}

      UNION ALL

      SELECT 'legacy_feedback', f.id::text, 'retention_state', 'unsafe',
             f.organization_id,
             CASE WHEN portal.organization_id = f.organization_id
                    AND portal.property_id::text = f.property_id
               THEN portal.property_id::text ELSE NULL END,
             f.portal_id::text, 'legacy_session_retention_overdue',
             ARRAY[]::text[]
      FROM scoped_feedback f LEFT JOIN portals portal ON portal.id = f.portal_id
      WHERE f.session_id IS NOT NULL
        AND f.created_at + interval '24 hours' <= ${observedAt}

      UNION ALL

      SELECT source, source_id, 'retention_state', 'exact', organization_id,
             property_id, portal_id, 'legacy_retention_exact', ARRAY[]::text[]
      FROM (
        SELECT 'legacy_rating'::text AS source, r.id::text AS source_id,
               r.organization_id,
               CASE WHEN portal.organization_id = r.organization_id
                      AND portal.property_id::text = r.property_id
                 THEN portal.property_id::text ELSE NULL END AS property_id,
               r.portal_id::text AS portal_id, r.ip_hash, r.session_id,
               r.created_at
        FROM scoped_ratings r LEFT JOIN portals portal ON portal.id = r.portal_id
        UNION ALL
        SELECT 'legacy_feedback', f.id::text, f.organization_id,
               CASE WHEN portal.organization_id = f.organization_id
                      AND portal.property_id::text = f.property_id
                 THEN portal.property_id::text ELSE NULL END,
               f.portal_id::text, f.ip_hash, f.session_id, f.created_at
        FROM scoped_feedback f LEFT JOIN portals portal ON portal.id = f.portal_id
      ) legacy
      WHERE ip_hash IS NULL
        AND (session_id IS NULL OR created_at + interval '24 hours' > ${observedAt})

      UNION ALL

      SELECT 'guest_response', r.id::text, 'experience_snapshot', outcome,
             r.organization_id, r.property_id::text, r.portal_id::text,
             reason_code, related_ids
      FROM response_evidence r
      CROSS JOIN LATERAL (
        SELECT 'orphan'::text AS outcome,
               'canonical_experience_snapshot_missing'::text AS reason_code,
               ARRAY[]::text[] AS related_ids
        WHERE r.experience_id IS NULL
        UNION ALL
        SELECT 'unsafe', 'canonical_publication_snapshot_unknown', ARRAY[]::text[]
        WHERE r.experience_id IS NOT NULL
          AND (r.publication_snapshot_id IS NULL
            OR r.publication_version IS NULL OR r.publication_digest IS NULL
            OR r.known_publication_id IS NULL)
        UNION ALL
        SELECT 'unsafe', 'canonical_threshold_snapshot_unknown', ARRAY[]::text[]
        WHERE r.private_feedback_threshold IS NULL
           OR r.snapshot_threshold IS NULL
        UNION ALL
        SELECT 'conflict', 'canonical_threshold_snapshot_conflict', ARRAY[]::text[]
        WHERE r.private_feedback_threshold IS NOT NULL
          AND r.snapshot_threshold IS NOT NULL
          AND (r.private_feedback_threshold <> r.snapshot_threshold
            OR (r.known_publication_id IS NOT NULL
              AND r.snapshot_threshold <> r.publication_threshold))
        UNION ALL
        SELECT 'exact', 'canonical_experience_snapshot_exact',
               ARRAY[r.publication_snapshot_id::text]
        WHERE r.experience_id IS NOT NULL
          AND r.publication_snapshot_id IS NOT NULL
          AND r.publication_version IS NOT NULL
          AND r.publication_digest IS NOT NULL
          AND r.known_publication_id IS NOT NULL
          AND r.private_feedback_threshold = r.snapshot_threshold
          AND r.snapshot_threshold = r.publication_threshold
      ) experience(outcome, reason_code, related_ids)

      UNION ALL

      SELECT 'guest_response', r.id::text, 'rating_lineage',
             CASE
               WHEN r.rating_missing_target_count > 0 THEN 'orphan'
               WHEN r.rating_branch_count > 0 THEN 'conflict'
               WHEN r.rating_scope_conflict_count > 0 THEN 'conflict'
               WHEN r.rating_submitted_count + r.rating_retracted_count > 0
                    AND r.rating_root_count <> 1 THEN 'conflict'
               WHEN r.deleted_at IS NOT NULL AND r.rating_submitted_count > 0
                    AND r.rating_retracted_count = 0 THEN 'orphan'
               WHEN r.rating_source_event_id IS NULL
                    AND r.deleted_at IS NULL AND r.response_consent = true
                    AND r.integrity_outcome = 'accepted' AND r.rating IS NOT NULL
                 THEN 'orphan'
               WHEN r.rating_source_event_id IS NOT NULL
                    AND (r.deleted_at IS NOT NULL OR r.response_consent = false
                      OR r.integrity_outcome <> 'accepted' OR r.rating IS NULL)
                 THEN 'conflict'
               WHEN r.rating_source_event_id IS NOT NULL
                    AND r.rating_current_match_count <> 1 THEN 'conflict'
               ELSE 'exact'
             END,
             r.organization_id, r.property_id::text, r.portal_id::text,
             CASE
               WHEN r.rating_missing_target_count > 0
                 THEN 'canonical_rating_lineage_target_missing'
               WHEN r.rating_branch_count > 0
                 THEN 'canonical_rating_lineage_branch_conflict'
               WHEN r.rating_scope_conflict_count > 0
                 THEN 'canonical_rating_source_conflict'
               WHEN r.rating_submitted_count + r.rating_retracted_count > 0
                    AND r.rating_root_count <> 1
                 THEN 'canonical_rating_correction_identity_missing'
               WHEN r.deleted_at IS NOT NULL AND r.rating_submitted_count > 0
                    AND r.rating_retracted_count = 0
                 THEN 'canonical_rating_retraction_identity_missing'
               WHEN r.rating_source_event_id IS NULL
                    AND r.deleted_at IS NULL AND r.response_consent = true
                    AND r.integrity_outcome = 'accepted' AND r.rating IS NOT NULL
                 THEN 'canonical_rating_source_missing'
               WHEN r.rating_source_event_id IS NOT NULL
                    AND (r.deleted_at IS NOT NULL OR r.response_consent = false
                      OR r.integrity_outcome <> 'accepted' OR r.rating IS NULL
                      OR r.rating_current_match_count <> 1)
                 THEN 'canonical_rating_source_conflict'
               ELSE 'canonical_rating_lineage_exact'
             END,
             CASE WHEN r.rating_source_event_id IS NULL THEN ARRAY[]::text[]
                  ELSE ARRAY[r.rating_source_event_id] END
      FROM response_evidence r

      UNION ALL

      SELECT 'guest_response', r.id::text, 'feedback_lineage',
             CASE
               WHEN r.feedback_missing_target_count > 0 THEN 'orphan'
               WHEN r.feedback_branch_count > 0 THEN 'conflict'
               WHEN r.feedback_scope_conflict_count > 0 THEN 'conflict'
               WHEN r.feedback_event_count + r.feedback_retracted_count > 0
                    AND r.feedback_root_count <> 1 THEN 'conflict'
               WHEN (r.feedback_withdrawn_at IS NOT NULL OR r.deleted_at IS NOT NULL)
                    AND r.feedback_event_count > 0 AND r.feedback_retracted_count = 0
                 THEN 'orphan'
               WHEN r.feedback_submitted_at IS NOT NULL
                    AND r.feedback_withdrawn_at IS NULL AND r.deleted_at IS NULL
                    AND r.text_consent = true AND r.feedback_source_event_id IS NULL
                 THEN 'orphan'
               WHEN r.feedback_source_event_id IS NOT NULL
                    AND (r.feedback_withdrawn_at IS NOT NULL OR r.deleted_at IS NOT NULL
                      OR r.text_consent = false OR r.feedback_current_match_count <> 1)
                 THEN 'conflict'
               ELSE 'exact'
             END,
             r.organization_id, r.property_id::text, r.portal_id::text,
             CASE
               WHEN r.feedback_missing_target_count > 0
                 THEN 'canonical_feedback_lineage_target_missing'
               WHEN r.feedback_branch_count > 0
                 THEN 'canonical_feedback_lineage_branch_conflict'
               WHEN r.feedback_scope_conflict_count > 0
                 THEN 'canonical_feedback_source_conflict'
               WHEN r.feedback_event_count + r.feedback_retracted_count > 0
                    AND r.feedback_root_count <> 1
                 THEN 'canonical_feedback_correction_identity_missing'
               WHEN (r.feedback_withdrawn_at IS NOT NULL OR r.deleted_at IS NOT NULL)
                    AND r.feedback_event_count > 0 AND r.feedback_retracted_count = 0
                 THEN 'canonical_feedback_retraction_identity_missing'
               WHEN r.feedback_submitted_at IS NOT NULL
                    AND r.feedback_withdrawn_at IS NULL AND r.deleted_at IS NULL
                    AND r.text_consent = true AND r.feedback_source_event_id IS NULL
                 THEN 'canonical_feedback_source_missing'
               WHEN r.feedback_source_event_id IS NOT NULL
                    AND (r.feedback_withdrawn_at IS NOT NULL OR r.deleted_at IS NOT NULL
                      OR r.text_consent = false OR r.feedback_current_match_count <> 1)
                 THEN 'canonical_feedback_source_conflict'
               ELSE 'canonical_feedback_lineage_exact'
             END,
             CASE WHEN r.feedback_source_event_id IS NULL THEN ARRAY[]::text[]
                  ELSE ARRAY[r.feedback_source_event_id] END
      FROM response_evidence r

      UNION ALL

      SELECT 'guest_response', r.id::text, 'integrity_history',
             CASE WHEN r.integrity_decision_count = 0 THEN 'orphan'
                  WHEN r.integrity_decision_count <> r.integrity_revision
                    OR r.minimum_revision <> 1
                    OR r.maximum_revision <> r.integrity_revision
                    OR r.integrity_chain_conflict_count > 0
                    OR r.latest_outcome IS DISTINCT FROM r.integrity_outcome
                    OR r.latest_reason_code IS DISTINCT FROM r.integrity_reason_code
                    OR r.latest_decided_at IS DISTINCT FROM r.integrity_assessed_at
                    THEN 'conflict'
                  ELSE 'exact' END,
             r.organization_id, r.property_id::text, r.portal_id::text,
             CASE WHEN r.integrity_decision_count = 0
                    THEN 'canonical_integrity_history_missing'
                  WHEN r.integrity_decision_count <> r.integrity_revision
                    OR r.minimum_revision <> 1
                    OR r.maximum_revision <> r.integrity_revision
                    OR r.integrity_chain_conflict_count > 0
                    OR r.latest_outcome IS DISTINCT FROM r.integrity_outcome
                    OR r.latest_reason_code IS DISTINCT FROM r.integrity_reason_code
                    OR r.latest_decided_at IS DISTINCT FROM r.integrity_assessed_at
                    THEN 'canonical_integrity_history_conflict'
                  ELSE 'canonical_integrity_history_exact' END,
             ARRAY[]::text[]
      FROM response_evidence r

      UNION ALL

      SELECT 'guest_response', r.id::text, 'withdrawal_state',
             CASE WHEN (
                    r.deleted_at IS NOT NULL AND (
                      r.status <> 'deleted' OR r.rating IS NOT NULL
                      OR r.response_consent OR r.text_consent OR r.media_consent
                      OR r.rating_source_event_id IS NOT NULL
                      OR r.feedback_source_event_id IS NOT NULL
                      OR r.content_count > 0 OR r.active_contact_count > 0
                      OR r.nonterminal_media_count > 0
                    )
                  ) OR (
                    r.feedback_withdrawn_at IS NOT NULL AND (
                      r.text_consent OR r.feedback_source_event_id IS NOT NULL
                      OR r.content_count > 0 OR r.active_contact_count > 0
                    )
                  ) THEN 'conflict' ELSE 'exact' END,
             r.organization_id, r.property_id::text, r.portal_id::text,
             CASE WHEN (
                    r.deleted_at IS NOT NULL AND (
                      r.status <> 'deleted' OR r.rating IS NOT NULL
                      OR r.response_consent OR r.text_consent OR r.media_consent
                      OR r.rating_source_event_id IS NOT NULL
                      OR r.feedback_source_event_id IS NOT NULL
                      OR r.content_count > 0 OR r.active_contact_count > 0
                      OR r.nonterminal_media_count > 0
                    )
                  ) OR (
                    r.feedback_withdrawn_at IS NOT NULL AND (
                      r.text_consent OR r.feedback_source_event_id IS NOT NULL
                      OR r.content_count > 0 OR r.active_contact_count > 0
                    )
                  ) THEN 'canonical_withdrawal_state_conflict'
                  ELSE 'canonical_withdrawal_state_exact' END,
             (r.content_ids || r.media_ids || r.contact_ids)::text[]
      FROM response_evidence r

      UNION ALL

      SELECT 'guest_response', r.id::text, 'media_state',
             CASE WHEN r.deleted_at IS NOT NULL AND r.nonterminal_media_count > 0
                    THEN 'conflict'
                  WHEN r.active_media_count > 0 THEN 'unsafe'
                  ELSE 'exact' END,
             r.organization_id, r.property_id::text, r.portal_id::text,
             CASE WHEN r.deleted_at IS NOT NULL AND r.nonterminal_media_count > 0
                    THEN 'canonical_media_terminal_response_conflict'
                  WHEN r.active_media_count > 0
                    THEN 'canonical_media_active_while_beta_blocked'
                  ELSE 'canonical_media_state_exact' END,
             r.media_ids
      FROM response_evidence r

      UNION ALL

      SELECT 'guest_response', r.id::text, 'contact_state',
             CASE WHEN r.overdue_contact_count > 0 THEN 'unsafe'
                  WHEN (r.deleted_at IS NOT NULL OR r.feedback_withdrawn_at IS NOT NULL)
                    AND r.active_contact_count > 0 THEN 'conflict'
                  WHEN r.active_contact_count > 0 THEN 'unsafe'
                  ELSE 'exact' END,
             r.organization_id, r.property_id::text, r.portal_id::text,
             CASE WHEN r.overdue_contact_count > 0
                    THEN 'canonical_contact_retention_overdue'
                  WHEN (r.deleted_at IS NOT NULL OR r.feedback_withdrawn_at IS NOT NULL)
                    AND r.active_contact_count > 0
                    THEN 'canonical_contact_terminal_response_conflict'
                  WHEN r.active_contact_count > 0
                    THEN 'canonical_contact_active_while_beta_blocked'
                  ELSE 'canonical_contact_state_exact' END,
             r.contact_ids
      FROM response_evidence r

      UNION ALL

      SELECT 'guest_response', r.id::text, 'inbox_link',
             CASE
               WHEN r.inbox_scope_conflict_count > 0 THEN 'conflict'
               WHEN r.inbox_item_count > 1 THEN 'conflict'
               WHEN r.feedback_submitted_at IS NOT NULL AND r.inbox_item_count = 0
                 THEN 'orphan'
               WHEN r.feedback_submitted_at IS NULL AND r.inbox_item_count > 0
                 THEN 'conflict'
               WHEN (r.feedback_withdrawn_at IS NOT NULL OR r.deleted_at IS NOT NULL)
                    AND r.inbox_open_count > 0 THEN 'conflict'
               ELSE 'exact'
             END,
             r.organization_id, r.property_id::text, r.portal_id::text,
             CASE
               WHEN r.inbox_scope_conflict_count > 0
                 OR (r.feedback_submitted_at IS NULL AND r.inbox_item_count > 0)
                 THEN 'canonical_inbox_link_scope_conflict'
               WHEN r.inbox_item_count > 1 THEN 'canonical_inbox_link_duplicate'
               WHEN r.feedback_submitted_at IS NOT NULL AND r.inbox_item_count = 0
                 THEN 'canonical_inbox_link_missing'
               WHEN (r.feedback_withdrawn_at IS NOT NULL OR r.deleted_at IS NOT NULL)
                    AND r.inbox_open_count > 0
                 THEN 'canonical_withdrawn_inbox_open'
               ELSE 'canonical_inbox_link_exact'
             END,
             r.inbox_item_ids
      FROM response_evidence r

      UNION ALL

      SELECT 'guest_response', r.id::text, 'retention_state', outcome,
             r.organization_id, r.property_id::text, r.portal_id::text,
             reason_code, related_ids
      FROM response_evidence r
      CROSS JOIN LATERAL (
        SELECT 'unsafe'::text, 'canonical_response_retention_overdue'::text,
               ARRAY[]::text[]
        WHERE r.retention_deadline <= ${observedAt}
        UNION ALL
        SELECT 'unsafe', 'canonical_response_retention_invalid', ARRAY[]::text[]
        WHERE r.submitted_at IS NULL
           OR r.retention_deadline <> r.submitted_at + interval '24 months'
        UNION ALL
        SELECT 'unsafe', 'canonical_session_retention_overdue', r.binding_ids
        WHERE r.expired_binding_count > 0
        UNION ALL
        SELECT 'unsafe', 'canonical_session_retention_invalid', r.binding_ids
        WHERE r.invalid_binding_window_count > 0
        UNION ALL
        SELECT 'unsafe', 'canonical_feedback_retention_overdue', r.content_ids
        WHERE r.expired_content_count > 0
        UNION ALL
        SELECT 'unsafe', 'canonical_feedback_retention_invalid', r.content_ids
        WHERE r.invalid_content_window_count > 0
        UNION ALL
        SELECT 'orphan', 'canonical_feedback_content_missing_before_expiry',
               ARRAY[]::text[]
        WHERE r.feedback_submitted_at IS NOT NULL
          AND r.feedback_withdrawn_at IS NULL AND r.deleted_at IS NULL
          AND r.text_consent = true
          AND r.feedback_submitted_at + interval '90 days' > ${observedAt}
          AND r.content_count = 0
        UNION ALL
        SELECT 'exact', 'canonical_retention_exact', ARRAY[]::text[]
        WHERE r.retention_deadline > ${observedAt}
          AND r.submitted_at IS NOT NULL
          AND r.retention_deadline = r.submitted_at + interval '24 months'
          AND r.expired_binding_count = 0
          AND r.invalid_binding_window_count = 0
          AND r.expired_content_count = 0
          AND r.invalid_content_window_count = 0
          AND NOT (
            r.feedback_submitted_at IS NOT NULL
            AND r.feedback_withdrawn_at IS NULL AND r.deleted_at IS NULL
            AND r.text_consent = true
            AND r.feedback_submitted_at + interval '90 days' > ${observedAt}
            AND r.content_count = 0
          )
      ) retention(outcome, reason_code, related_ids)
    )
    SELECT "source", "sourceId", "dimension", "outcome",
           "organizationId", "propertyId", "portalId", "reasonCode",
           "relatedIds"
    FROM observations
    ORDER BY "organizationId", "source", "sourceId", "dimension", "reasonCode"
  `)
  return (result.rows as unknown as readonly RawRow[]).map(checkedRow)
}

async function readFactEvidence(
  db: QueryExecutor,
  observedAt: Date,
  organizationIds: readonly string[],
): Promise<readonly GuestResponseReconciliationRow[]> {
  const eventScope = organizationPredicate(organizationIds, sql`e.organization_id`)
  const result = await db.execute(sql`
    WITH fact_events AS (
      SELECT e.id::text AS event_id, e.event_type, e.event_version, e.payload,
             e.organization_id, e.property_id, e.source_aggregate_id
      FROM outbox_events e
      WHERE ${eventScope}
        AND e.source_context = 'guest'
        AND e.created_at <= ${observedAt}
        AND e.event_type IN (
          'guest.rating.submitted', 'guest.rating.retracted',
          'guest.feedback.submitted', 'guest.feedback.retracted'
        )
    ),
    extracted AS (
      SELECT e.*,
             CASE e.event_type
               WHEN 'guest.rating.submitted' THEN 'rating_submitted'
               WHEN 'guest.rating.retracted' THEN 'rating_retracted'
               WHEN 'guest.feedback.submitted' THEN 'feedback_submitted'
               WHEN 'guest.feedback.retracted' THEN 'feedback_retracted'
             END::text AS kind,
             CASE WHEN e.event_type LIKE 'guest.rating.%'
               THEN e.payload ->> 'ratingId'
               ELSE e.payload ->> 'feedbackId' END AS response_id,
             e.payload ->> 'organizationId' AS payload_organization_id,
             e.payload ->> 'propertyId' AS payload_property_id,
             e.payload ->> 'portalId' AS payload_portal_id,
             e.payload ->> 'occurredAt' AS occurred_at,
             e.payload ->> 'supersedesSourceEventId' AS supersedes_source_event_id,
             e.payload ->> 'responseRevision' AS response_revision,
             e.payload -> 'staffAttribution' AS staff_attribution,
             CASE
               WHEN e.event_type LIKE 'guest.rating.%'
                 THEN e.event_version IN (1, 2)
               ELSE e.event_version IN (1, 2, 3)
             END AS schema_version_known,
             (
               (CASE WHEN e.event_type LIKE 'guest.rating.%'
                  THEN e.payload ->> 'ratingId'
                  ELSE e.payload ->> 'feedbackId' END)
                 ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
               AND (e.payload ->> 'organizationId')
                 ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$'
               AND (e.payload ->> 'propertyId')
                 ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
               AND (e.payload ->> 'portalId')
                 ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
               AND (e.payload ->> 'occurredAt')
                 ~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
               AND CASE
                 WHEN e.event_type = 'guest.rating.submitted'
                   THEN jsonb_typeof(e.payload -> 'value') = 'number'
                     AND (e.payload ->> 'value') ~ '^[1-5]$'
                     AND (
                       NOT (e.payload ? 'supersedesSourceEventId')
                       OR e.payload -> 'supersedesSourceEventId' = 'null'::jsonb
                       OR (
                         jsonb_typeof(e.payload -> 'supersedesSourceEventId') = 'string'
                         AND (e.payload ->> 'supersedesSourceEventId')
                           ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
                       )
                     )
                 WHEN e.event_type IN (
                   'guest.rating.retracted', 'guest.feedback.retracted'
                 ) THEN jsonb_typeof(e.payload -> 'supersedesSourceEventId') = 'string'
                   AND (e.payload ->> 'supersedesSourceEventId')
                     ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
                 WHEN e.event_type = 'guest.feedback.submitted'
                   THEN e.payload ? 'ratingId'
                     AND (
                       e.payload -> 'ratingId' = 'null'::jsonb
                       OR (
                         jsonb_typeof(e.payload -> 'ratingId') = 'string'
                         AND (e.payload ->> 'ratingId')
                           ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
                       )
                     )
                 ELSE false
               END
             ) AS base_payload_valid,
             CASE
               WHEN e.event_version = 1 THEN true
               WHEN (e.event_type LIKE 'guest.rating.%' AND e.event_version = 2)
                 OR (e.event_type LIKE 'guest.feedback.%' AND e.event_version IN (2, 3))
               THEN e.payload ? 'staffAttribution' AND (
                 e.payload -> 'staffAttribution' = 'null'::jsonb
                 OR (
                   jsonb_typeof(e.payload -> 'staffAttribution') = 'object'
                   AND (e.payload -> 'staffAttribution' ->> 'staffParticipantId')
                     ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
                   AND (e.payload -> 'staffAttribution' ->> 'staffParticipationId')
                     ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
                   AND (e.payload -> 'staffAttribution' ->> 'portalResponsibilityId')
                     ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
                   AND (e.payload -> 'staffAttribution' ->> 'effectiveFrom')
                     ~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
                   AND e.payload -> 'staffAttribution' ? 'effectiveTo'
                   AND (
                     e.payload -> 'staffAttribution' -> 'effectiveTo' = 'null'::jsonb
                     OR (e.payload -> 'staffAttribution' ->> 'effectiveTo')
                       ~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
                   )
                 )
               )
               ELSE true
             END AS staff_shape_valid,
             CASE
               WHEN e.event_type LIKE 'guest.rating.%' THEN true
               WHEN e.event_version IN (1, 2) THEN true
               WHEN e.event_version = 3 THEN
                 jsonb_typeof(e.payload -> 'responseRevision') = 'number'
                 AND (e.payload ->> 'responseRevision') ~ '^[1-9][0-9]{0,8}$'
               ELSE true
             END AS revision_shape_valid
      FROM fact_events e
    ),
    evidence AS (
      SELECT e.*, r.id AS canonical_response_id, r.organization_id AS response_org,
             r.property_id::text AS response_property,
             r.portal_id::text AS response_portal, r.submitted_at, r.corrected_at,
             r.feedback_submitted_at, r.feedback_withdrawn_at, r.deleted_at,
             r.feedback_submission_revision,
             r.attributed_staff_participant_id::text AS attributed_staff_participant_id,
             r.attributed_staff_participation_id::text AS attributed_staff_participation_id,
             r.attribution_responsibility_id::text AS attribution_responsibility_id,
             r.staff_attribution_effective_from,
             r.staff_attribution_effective_to
      FROM extracted e
      LEFT JOIN guest_responses r
        ON r.id::text = e.response_id
       AND r.created_at <= ${observedAt}
    )
    SELECT kind AS "kind", event_id AS "eventId",
           CASE WHEN organization_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$'
             THEN organization_id ELSE 'invalid-envelope-organization' END
             AS "organizationId",
           CASE WHEN property_id
             ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
             THEN property_id ELSE NULL END AS "propertyId",
           CASE WHEN payload_portal_id
             ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
             THEN payload_portal_id ELSE NULL END AS "portalId",
           CASE WHEN response_id
             ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
             THEN response_id ELSE NULL END AS "responseId",
           COALESCE(
             base_payload_valid AND staff_shape_valid AND revision_shape_valid,
             false
           )
             AS "payloadValid",
           schema_version_known AS "schemaVersionKnown",
           (canonical_response_id IS NOT NULL) AS "responseExists",
           COALESCE((
             canonical_response_id IS NOT NULL
             AND organization_id = response_org
             AND property_id = response_property
             AND payload_organization_id = response_org
             AND payload_property_id = response_property
             AND payload_portal_id = response_portal
             AND (
               event_type <> 'guest.feedback.submitted'
               OR event_version < 3
               OR payload ->> 'ratingId' = response_id
             )
           ), false) AS "scopeExact",
           (canonical_response_id IS NOT NULL AND source_aggregate_id = response_id)
             AS "sourceAggregateExact",
           COALESCE((
             canonical_response_id IS NOT NULL AND CASE
               WHEN event_type = 'guest.rating.submitted'
                 THEN occurred_at IN (
                   to_char(submitted_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   to_char(corrected_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                 )
               WHEN event_type = 'guest.rating.retracted'
                 THEN occurred_at IN (
                   to_char(corrected_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   to_char(deleted_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                 ) OR EXISTS (
                   SELECT 1 FROM guest_response_integrity_decisions decision
                   WHERE decision.response_id = canonical_response_id
                     AND decision.organization_id = response_org
                     AND decision.decided_at <= ${observedAt}
                     AND occurred_at = to_char(decision.decided_at AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                 )
               WHEN event_type = 'guest.feedback.submitted'
                 THEN occurred_at = to_char(feedback_submitted_at AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
               WHEN event_type = 'guest.feedback.retracted'
                 THEN occurred_at IN (
                   to_char(feedback_withdrawn_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   to_char(deleted_at AT TIME ZONE 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                 )
               ELSE false
             END
           ), false) AS "businessTimeExact",
           CASE
             WHEN NOT schema_version_known OR event_version = 1 THEN 'unknown'
             WHEN NOT staff_shape_valid THEN 'invalid'
             WHEN canonical_response_id IS NULL THEN 'unknown'
             WHEN staff_attribution = 'null'::jsonb THEN
               CASE WHEN attributed_staff_participant_id IS NULL
                 AND attributed_staff_participation_id IS NULL
                 AND attribution_responsibility_id IS NULL
                 AND staff_attribution_effective_from IS NULL
                 AND staff_attribution_effective_to IS NULL
               THEN 'exact' ELSE 'conflict' END
             WHEN staff_attribution IS NOT NULL THEN
               CASE WHEN staff_attribution ->> 'staffParticipantId'
                       = attributed_staff_participant_id
                 AND staff_attribution ->> 'staffParticipationId'
                       = attributed_staff_participation_id
                 AND staff_attribution ->> 'portalResponsibilityId'
                       = attribution_responsibility_id
                 AND staff_attribution ->> 'effectiveFrom'
                       = to_char(staff_attribution_effective_from AT TIME ZONE 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                 AND (
                   (staff_attribution -> 'effectiveTo' = 'null'::jsonb
                     AND staff_attribution_effective_to IS NULL)
                   OR staff_attribution ->> 'effectiveTo'
                     = to_char(staff_attribution_effective_to AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                 )
               THEN 'exact' ELSE 'conflict' END
             ELSE 'invalid'
           END::text AS "staffAttribution",
           CASE
             WHEN event_type LIKE 'guest.rating.%' THEN 'not_applicable'
             WHEN NOT schema_version_known THEN 'unknown'
             WHEN event_version IN (1, 2) THEN 'unknown'
             WHEN NOT revision_shape_valid THEN 'invalid'
             WHEN canonical_response_id IS NULL THEN 'exact'
             WHEN response_revision::integer = feedback_submission_revision THEN 'exact'
             ELSE 'conflict'
           END::text AS "feedbackRevision"
    FROM evidence
    ORDER BY organization_id, event_id
  `)
  return (result.rows as unknown as readonly RawFactEvidenceAssessment[]).flatMap((row) =>
    classifyGuestResponseFactEvidence(checkedFactEvidenceAssessment(row)),
  )
}

async function readFacts(
  db: QueryExecutor,
  observedAt: Date,
  organizationIds: readonly string[],
): Promise<readonly GuestResponseReconciliationFactIdentity[]> {
  const eventScope = organizationPredicate(organizationIds, sql`e.organization_id`)
  const result = await db.execute(sql`
    SELECT CASE e.event_type
             WHEN 'guest.rating.submitted' THEN 'rating_submitted'
             WHEN 'guest.rating.retracted' THEN 'rating_retracted'
             WHEN 'guest.feedback.submitted' THEN 'feedback_submitted'
             WHEN 'guest.feedback.retracted' THEN 'feedback_retracted'
           END::text AS "kind",
           e.id::text AS "eventId",
           e.organization_id::text AS "organizationId",
           e.property_id::text AS "propertyId",
           e.payload ->> 'portalId' AS "portalId",
           CASE WHEN e.event_type LIKE 'guest.rating.%'
             THEN e.payload ->> 'ratingId'
             ELSE e.payload ->> 'feedbackId' END AS "responseId",
           e.payload ->> 'supersedesSourceEventId' AS "supersedesSourceEventId",
           CASE WHEN e.event_type = 'guest.rating.submitted'
                  AND (e.payload ->> 'value') ~ '^[1-5]$'
             THEN (e.payload ->> 'value')::integer ELSE NULL END AS "star",
           CASE WHEN e.event_type LIKE 'guest.feedback.%'
                  AND (e.payload ->> 'responseRevision') ~ '^[1-9][0-9]{0,8}$'
             THEN (e.payload ->> 'responseRevision')::integer ELSE NULL END
             AS "responseRevision"
    FROM outbox_events e
    WHERE ${eventScope}
      AND e.source_context = 'guest'
      AND e.created_at <= ${observedAt}
      AND e.event_type IN (
        'guest.rating.submitted', 'guest.rating.retracted',
        'guest.feedback.submitted', 'guest.feedback.retracted'
      )
      AND e.organization_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$'
      AND e.property_id
        ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
      AND (e.payload ->> 'portalId')
        ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
      AND (CASE WHEN e.event_type LIKE 'guest.rating.%'
             THEN e.payload ->> 'ratingId'
             ELSE e.payload ->> 'feedbackId' END)
        ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
      AND CASE
        WHEN e.event_type = 'guest.rating.submitted'
          THEN (e.payload ->> 'value') ~ '^[1-5]$'
        WHEN e.event_type IN ('guest.rating.retracted', 'guest.feedback.retracted')
          THEN (e.payload ->> 'supersedesSourceEventId')
            ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
        ELSE true
      END
      AND (
        e.event_type NOT LIKE 'guest.feedback.%'
        OR e.event_version IN (1, 2)
        OR (e.payload ->> 'responseRevision') ~ '^[1-9][0-9]{0,8}$'
      )
    ORDER BY e.id
  `)
  return (result.rows as unknown as readonly RawFact[]).map(checkedFact)
}

async function readDistributions(
  db: QueryExecutor,
  observedAt: Date,
  organizationIds: readonly string[],
): Promise<GuestResponseRatingDistributions> {
  const ratingScope = organizationPredicate(organizationIds, sql`r.organization_id`)
  const responseScope = organizationPredicate(organizationIds, sql`r.organization_id`)
  const result = await db.execute(sql`
    SELECT kind, star, count(*)::bigint AS count
    FROM (
      SELECT 'legacyRatings'::text AS kind, r.value::integer AS star
      FROM ratings r
      WHERE ${ratingScope}
        AND r.created_at <= ${observedAt}
        AND r.value BETWEEN 1 AND 5

      UNION ALL

      SELECT 'canonicalRetainedRatings', r.rating::integer
      FROM guest_responses r
      WHERE ${responseScope}
        AND r.created_at <= ${observedAt}
        AND r.rating BETWEEN 1 AND 5

      UNION ALL

      SELECT 'canonicalEffectiveRatings', r.rating::integer
      FROM guest_responses r
      WHERE ${responseScope}
        AND r.created_at <= ${observedAt}
        AND r.deleted_at IS NULL
        AND r.response_consent = true
        AND r.integrity_outcome = 'accepted'
        AND r.rating_source_event_id IS NOT NULL
        AND r.rating BETWEEN 1 AND 5

      UNION ALL

      SELECT 'durableRatingFactHeads',
             (event.payload ->> 'value')::integer
      FROM guest_responses r
      JOIN outbox_events event
        ON event.id::text = r.rating_source_event_id
       AND event.organization_id = r.organization_id
       AND event.property_id = r.property_id::text
       AND event.event_type = 'guest.rating.submitted'
       AND event.payload ->> 'ratingId' = r.id::text
       AND event.payload ->> 'portalId' = r.portal_id::text
       AND event.created_at <= ${observedAt}
       AND NOT EXISTS (
         SELECT 1
         FROM outbox_events successor
         WHERE successor.source_context = 'guest'
           AND successor.organization_id = event.organization_id
           AND successor.created_at <= ${observedAt}
           AND successor.event_type IN (
             'guest.rating.submitted', 'guest.rating.retracted'
           )
           AND successor.payload ->> 'ratingId' = r.id::text
           AND successor.payload ->> 'supersedesSourceEventId' = event.id::text
       )
      WHERE ${responseScope}
        AND r.created_at <= ${observedAt}
        AND r.deleted_at IS NULL
        AND r.response_consent = true
        AND r.integrity_outcome = 'accepted'
        AND r.rating_source_event_id IS NOT NULL
        AND (event.payload ->> 'value') ~ '^[1-5]$'
    ) distributions
    GROUP BY kind, star
    ORDER BY kind, star
  `)
  return distributionsFromRows(result.rows as unknown as readonly RawDistribution[])
}

export async function buildGuestResponseReconciliationReportFromDatabase(
  db: Database,
  input: Readonly<{ observedAt: Date; organizationIds?: readonly string[] }>,
) {
  if (Number.isNaN(input.observedAt.getTime())) {
    throw new Error('invalid Guest Response reconciliation observation time')
  }
  const organizationIds = [...new Set(input.organizationIds ?? [])].sort()
  return db.transaction(
    async (snapshot) => {
      const rows = [
        ...(await readRows(snapshot, input.observedAt, organizationIds)),
        ...(await readFactEvidence(snapshot, input.observedAt, organizationIds)),
      ]
      const facts = await readFacts(snapshot, input.observedAt, organizationIds)
      const ratingDistributions = await readDistributions(
        snapshot,
        input.observedAt,
        organizationIds,
      )
      return buildGuestResponseReconciliationReport({
        observedAt: input.observedAt,
        organizationIds,
        rows,
        facts,
        ratingDistributions,
      })
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}
