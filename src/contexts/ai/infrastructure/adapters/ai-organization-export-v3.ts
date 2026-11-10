import { sql, type SQL } from 'drizzle-orm'

export const UTC_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

/**
 * The serving fence for Review Analysis, as one `FROM … WHERE` over the aliases
 * `analysis`, `merchant`, `profile` and `review`. The export of an analysis and
 * of everything that hangs off it (mentions, corrections) selects through this
 * one fragment, so none of them can outlive what the product still serves.
 *
 * The merchant authorization must be enabled and still carry `review_analysis`;
 * the analysis must sit on that authorization's lineage, epoch and source epoch
 * at or after its start sequence; the analysis, the review and the processing
 * profile must agree on source epoch, revision and sequence; the source content
 * must not have expired; the profile must be active; and the derivative's own
 * retention must not have lapsed. An analysis recorded on an older profile is
 * served while the rebuilt contribution for its exact sequence sits on the
 * current one, the same predicate the product serves it by.
 */
export function reviewAnalysisServingFence(organizationId: string, asOfIso: string): SQL {
  return sql`FROM ai_review_analyses AS analysis
            INNER JOIN merchant_ai_enablement AS merchant
              ON merchant.organization_id = analysis.organization_id
             AND merchant.property_id = analysis.property_id
            INNER JOIN ai_property_processing_profiles AS profile
              ON profile.organization_id = analysis.organization_id
             AND profile.property_id = analysis.property_id
            INNER JOIN reviews AS review
              ON review.organization_id = analysis.organization_id
             AND review.property_id = analysis.property_id
             AND review.id = analysis.review_id
            WHERE analysis.organization_id = ${organizationId}
              AND merchant.state = 'enabled'
              AND merchant.capabilities @> ARRAY['review_analysis']::text[]
              AND analysis.authorization_lineage_id = merchant.authorization_lineage_id
              AND analysis.review_analysis_epoch = merchant.review_analysis_epoch
              AND analysis.source_epoch = merchant.authorized_source_epoch
              AND analysis.analysis_sequence >= merchant.analysis_start_sequence
              AND profile.lifecycle_state = 'active'
              AND (
                profile.profile_version = analysis.property_profile_version
                OR EXISTS (
                  SELECT 1 FROM ai_property_aggregate_contributions AS projection
                  WHERE projection.organization_id = analysis.organization_id
                    AND projection.property_id = analysis.property_id
                    AND projection.review_id = analysis.review_id
                    AND projection.source_epoch = analysis.source_epoch
                    AND projection.source_revision = analysis.source_revision
                    AND projection.analysis_sequence = analysis.analysis_sequence
                    AND projection.review_analysis_epoch = analysis.review_analysis_epoch
                    AND projection.status = analysis.status
                    AND projection.property_profile_version = profile.profile_version
                )
              )
              AND profile.source_epoch = analysis.source_epoch
              AND review.source_epoch = analysis.source_epoch
              AND review.source_revision = analysis.source_revision
              AND review.analysis_sequence = analysis.analysis_sequence
              AND EXISTS (SELECT 1 FROM review_source_contents content WHERE content.review_id = review.id AND content.organization_id = review.organization_id AND content.property_id = review.property_id AND content.content_expires_at > ${asOfIso}::timestamptz)
              AND analysis.expires_at > ${asOfIso}::timestamptz`
}

/** The served analyses, with their aspects folded into one JSON column. */
export function reviewAnalysesQuery(organizationId: string, asOfIso: string): SQL {
  return sql`SELECT
          analysis.property_id::text AS property_id,
          analysis.review_id::text AS review_id,
          analysis.source_epoch,
          analysis.source_revision,
          analysis.analysis_sequence,
          analysis.review_analysis_epoch,
          analysis.property_profile_version,
          analysis.analysis_profile_version,
          analysis.authorization_lineage_id::text AS authorization_lineage_id,
          analysis.status,
          analysis.unavailable_reason,
          analysis.sentiment,
          analysis.primary_category,
          COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'aspect', analysis_aspect.aspect,
                'polarity', analysis_aspect.polarity,
                'intensity', analysis_aspect.intensity
              )
              ORDER BY analysis_aspect.aspect
            )
            FROM ai_review_analysis_aspects AS analysis_aspect
            WHERE analysis_aspect.organization_id = analysis.organization_id
              AND analysis_aspect.property_id = analysis.property_id
              AND analysis_aspect.review_id = analysis.review_id
              AND analysis_aspect.source_epoch = analysis.source_epoch
              AND analysis_aspect.source_revision = analysis.source_revision
              AND analysis_aspect.analysis_sequence = analysis.analysis_sequence
          ), '[]'::jsonb) AS aspects,
          analysis.issue_label,
          analysis.attention,
          to_char(analysis.generated_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS generated_at,
          to_char(analysis.expires_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS expires_at
        ${reviewAnalysisServingFence(organizationId, asOfIso)}`
}

export const REVIEW_ANALYSIS_MENTION_COLUMNS = [
  'property_id',
  'review_id',
  'source_epoch',
  'source_revision',
  'analysis_sequence',
  'mention_ordinal',
  'topic',
  'polarity',
  'strength',
  'thing',
  'issue',
  'names_person',
  'sentence_numbers',
] as const

export const REVIEW_ANALYSIS_MENTION_CORRECTION_COLUMNS = [
  'property_id',
  'review_id',
  'source_epoch',
  'source_revision',
  'analysis_sequence',
  'mention_ordinal',
  'topic',
  'kind',
  'replacement_thing',
  'replacement_issue',
  'replacement_issue_group_id',
  'corrected_by',
  'created_at',
  'updated_at',
] as const

/**
 * Allowlisted columns of the analysed mentions: the provider's answer as kept,
 * with the numbers of the sentences that state each one but never the sentences.
 */
export function reviewAnalysisMentionsQuery(
  organizationId: string,
  asOfIso: string,
): SQL {
  return sql`SELECT
        mention.property_id::text AS property_id,
        mention.review_id::text AS review_id,
        mention.source_epoch,
        mention.source_revision,
        mention.analysis_sequence,
        mention.mention_ordinal,
        mention.topic,
        mention.polarity,
        mention.strength,
        mention.thing,
        mention.issue,
        mention.names_person,
        COALESCE((
          SELECT jsonb_agg(sentence.sentence_number ORDER BY sentence.sentence_number)
          FROM ai_review_analysis_mention_sentences AS sentence
          WHERE sentence.organization_id = mention.organization_id
            AND sentence.property_id = mention.property_id
            AND sentence.review_id = mention.review_id
            AND sentence.source_epoch = mention.source_epoch
            AND sentence.source_revision = mention.source_revision
            AND sentence.analysis_sequence = mention.analysis_sequence
            AND sentence.mention_ordinal = mention.mention_ordinal
        ), '[]'::jsonb) AS sentence_numbers
      FROM ai_review_analysis_mentions AS mention
      WHERE (mention.organization_id, mention.property_id, mention.review_id,
             mention.source_epoch, mention.source_revision, mention.analysis_sequence) IN (
        SELECT analysis.organization_id, analysis.property_id, analysis.review_id,
               analysis.source_epoch, analysis.source_revision, analysis.analysis_sequence
        ${reviewAnalysisServingFence(organizationId, asOfIso)}
      )`
}

/** A manager's correction beside a served mention: a kind and short chosen phrases only. */
export function reviewAnalysisMentionCorrectionsQuery(
  organizationId: string,
  asOfIso: string,
): SQL {
  return sql`SELECT
        correction.property_id::text AS property_id,
        correction.review_id::text AS review_id,
        correction.source_epoch,
        correction.source_revision,
        correction.analysis_sequence,
        correction.mention_ordinal,
        correction.topic,
        correction.kind,
        correction.replacement_thing,
        correction.replacement_issue,
        correction.replacement_issue_group_id::text AS replacement_issue_group_id,
        correction.corrected_by,
        to_char(correction.created_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS created_at,
        to_char(correction.updated_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS updated_at
      FROM ai_review_analysis_mention_corrections AS correction
      WHERE (correction.organization_id, correction.property_id, correction.review_id,
             correction.source_epoch, correction.source_revision, correction.analysis_sequence) IN (
        SELECT analysis.organization_id, analysis.property_id, analysis.review_id,
               analysis.source_epoch, analysis.source_revision, analysis.analysis_sequence
        ${reviewAnalysisServingFence(organizationId, asOfIso)}
      )`
}
