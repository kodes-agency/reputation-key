// The AI part of an Organization data export: the analysis the product still
// serves (topic, polarity, strength, the cause phrases and the numbers of the
// sentences that state each) and the manager corrections beside it, as two
// allowlisted JSON files. No review text and no provider identifiers leave.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { RightsExportFile } from '#/shared/ops/rights/rights-executor'

const CONTEXT = 'ai'
const UTC_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

export const AI_EXPORT_MENTION_COLUMNS = [
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

export const AI_EXPORT_CORRECTION_COLUMNS = [
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

type ExportRow = Record<string, unknown>

/**
 * The analyses the product still serves, as `FROM … WHERE` over the aliases
 * `analysis`, `merchant`, `profile`, `review` and `content`. The merchant
 * authorization must be enabled and still carry `review_analysis`; the analysis
 * must sit on its lineage, epoch and source epoch at or after its start
 * sequence; the analysis, review and processing profile must agree on source
 * epoch, revision and sequence; the source content and the analysis must not
 * have expired; and the profile must be active.
 */
function servedAnalyses(organizationId: string, asOf: string): SQL {
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
    INNER JOIN review_source_contents AS content
      ON content.organization_id = review.organization_id
     AND content.property_id = review.property_id
     AND content.review_id = review.id
    WHERE analysis.organization_id = ${organizationId}
      AND analysis.status = 'ready'
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
      AND content.content_expires_at > ${asOf}::timestamptz
      AND analysis.expires_at > ${asOf}::timestamptz`
}

function inServedAnalyses(alias: string, organizationId: string, asOf: string): SQL {
  const column = (name: string) => sql.raw(`${alias}.${name}`)
  return sql`(${column('organization_id')}, ${column('property_id')}, ${column('review_id')},
      ${column('source_epoch')}, ${column('source_revision')}, ${column('analysis_sequence')}) IN (
    SELECT analysis.organization_id, analysis.property_id, analysis.review_id,
           analysis.source_epoch, analysis.source_revision, analysis.analysis_sequence
    ${servedAnalyses(organizationId, asOf)}
  )`
}

function mentionsQuery(organizationId: string, asOf: string): SQL {
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
    WHERE mention.organization_id = ${organizationId}
      AND ${inServedAnalyses('mention', organizationId, asOf)}
    ORDER BY mention.property_id, mention.review_id, mention.analysis_sequence,
             mention.mention_ordinal`
}

function correctionsQuery(organizationId: string, asOf: string): SQL {
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
    WHERE correction.organization_id = ${organizationId}
      AND ${inServedAnalyses('correction', organizationId, asOf)}
    ORDER BY correction.property_id, correction.review_id, correction.analysis_sequence,
             correction.mention_ordinal`
}

/** Keeps only the allowlisted columns, so a column added later never leaves unreviewed. */
function allowlisted(
  rows: ReadonlyArray<ExportRow>,
  columns: ReadonlyArray<string>,
): ReadonlyArray<ExportRow> {
  return rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null])))
}

function jsonFile(
  name: string,
  columns: ReadonlyArray<string>,
  records: ReadonlyArray<ExportRow>,
): RightsExportFile {
  const document = { collection: name, columns, records }
  return {
    path: `${CONTEXT}/${name}.json`,
    bytes: new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`),
  }
}

export async function readAiOrganizationExport(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<ReadonlyArray<RightsExportFile>> {
  const asOfIso = asOf.toISOString()
  const { mentions, corrections } = await db.transaction(
    async (tx) => ({
      mentions: (await tx.execute(mentionsQuery(organizationId, asOfIso)))
        .rows as ExportRow[],
      corrections: (await tx.execute(correctionsQuery(organizationId, asOfIso)))
        .rows as ExportRow[],
    }),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
  return [
    jsonFile(
      'review-analysis-mentions',
      AI_EXPORT_MENTION_COLUMNS,
      allowlisted(mentions, AI_EXPORT_MENTION_COLUMNS),
    ),
    jsonFile(
      'review-analysis-mention-corrections',
      AI_EXPORT_CORRECTION_COLUMNS,
      allowlisted(corrections, AI_EXPORT_CORRECTION_COLUMNS),
    ),
  ]
}
