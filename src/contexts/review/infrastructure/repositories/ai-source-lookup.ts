// Review context — the SQL and row checks behind the AI source reads
// (`readForAi`, `assertCurrentForAi`, the Trend population). The canonical-source
// limits come from the AI source contract (`#/shared/ai-review-source-contract`),
// the one definition the writer's refusal marker and these readers both compare
// against; the "which Review revision is this" expectation lives here.

import { sql } from 'drizzle-orm'
import {
  MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1,
  MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1,
} from '#/shared/ai-review-source-contract'
import type {
  AiReviewSourceDenial,
  AiReviewSourceRequest,
} from '../../application/ports/ai-review-source.port'

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

export function parseSafeNonnegativeInteger(value: unknown): number | null {
  try {
    const parsed =
      typeof value === 'bigint'
        ? value
        : typeof value === 'number' && Number.isSafeInteger(value)
          ? BigInt(value)
          : typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
            ? BigInt(value)
            : null
    if (parsed == null || parsed < 0n || parsed > MAX_SAFE_INTEGER_BIGINT) return null
    return Number(parsed)
  } catch {
    return null
  }
}

export function expectationDenial(
  input: AiReviewSourceRequest,
  row: Readonly<{
    source_epoch: unknown
    source_revision: unknown
    analysis_sequence: unknown
  }>,
): AiReviewSourceDenial | null {
  const sourceEpoch = parseSafeNonnegativeInteger(row.source_epoch)
  const sourceRevision = parseSafeNonnegativeInteger(row.source_revision)
  const analysisSequence = parseSafeNonnegativeInteger(row.analysis_sequence)
  if (sourceEpoch == null || sourceRevision == null || analysisSequence == null) {
    return 'policy_unavailable'
  }
  if (sourceEpoch !== input.expected.sourceEpoch) return 'source_epoch_changed'
  if (sourceRevision !== input.expected.sourceRevision) return 'source_revision_changed'
  if (
    input.expected.kind === 'analysis' &&
    analysisSequence !== input.expected.analysisSequence
  ) {
    return 'analysis_sequence_changed'
  }
  return null
}

export type AiSourceDatabaseRow = Readonly<{
  source_epoch: unknown
  source_revision: unknown
  analysis_sequence: unknown
  content_expires_at_epoch_millis: unknown
  reviewed_at_epoch_millis: unknown
  ai_source_byte_length: unknown
  ai_source_digest: unknown
  raw_source_bytes: unknown
  is_unexpired: unknown
  text: unknown
  rating: unknown
  language_code: unknown
  reviewer_name: unknown
}>

export function aiSourceLookupSql(input: AiReviewSourceRequest) {
  return sql`
    WITH captured AS (
      SELECT transaction_timestamp() AS now
    )
    SELECT
      review.source_epoch,
      review.source_revision,
      review.analysis_sequence,
      ai_epoch_millis_v1(source.content_expires_at) AS content_expires_at_epoch_millis,
      ai_epoch_millis_v1(source.reviewed_at) AS reviewed_at_epoch_millis,
      source.ai_source_byte_length,
      source.ai_source_digest,
      (
        COALESCE(octet_length(source.text), 0)::bigint
        + COALESCE(octet_length(source.language_code), 0)::bigint
        + COALESCE(octet_length(source.reviewer_name), 0)::bigint
      ) AS raw_source_bytes,
      source.content_expires_at > captured.now AS is_unexpired,
      CASE WHEN
        source.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
        AND (
          COALESCE(octet_length(source.text), 0)::bigint
          + COALESCE(octet_length(source.language_code), 0)::bigint
          + COALESCE(octet_length(source.reviewer_name), 0)::bigint
        ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
        AND source.content_expires_at > captured.now
      THEN source.text ELSE NULL END AS text,
      CASE WHEN
        source.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
        AND (
          COALESCE(octet_length(source.text), 0)::bigint
          + COALESCE(octet_length(source.language_code), 0)::bigint
          + COALESCE(octet_length(source.reviewer_name), 0)::bigint
        ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
        AND source.content_expires_at > captured.now
      THEN source.rating ELSE NULL END AS rating,
      CASE WHEN
        source.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
        AND (
          COALESCE(octet_length(source.text), 0)::bigint
          + COALESCE(octet_length(source.language_code), 0)::bigint
          + COALESCE(octet_length(source.reviewer_name), 0)::bigint
        ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
        AND source.content_expires_at > captured.now
      THEN source.language_code ELSE NULL END AS language_code,
      CASE WHEN
        source.ai_source_byte_length <= ${MAX_AI_REVIEW_SOURCE_CANONICAL_BYTES_V1}
        AND (
          COALESCE(octet_length(source.text), 0)::bigint
          + COALESCE(octet_length(source.language_code), 0)::bigint
          + COALESCE(octet_length(source.reviewer_name), 0)::bigint
        ) <= ${MAX_AI_REVIEW_SOURCE_RAW_BYTES_V1}
        AND source.content_expires_at > captured.now
      THEN source.reviewer_name ELSE NULL END AS reviewer_name
    FROM reviews AS review
    LEFT JOIN review_source_contents AS source ON source.review_id = review.id
      AND source.organization_id = review.organization_id AND source.property_id = review.property_id
    CROSS JOIN captured
    WHERE review.organization_id = ${input.organizationId}
      AND review.property_id = ${input.propertyId}::uuid
      AND review.id = ${input.reviewId}::uuid
    LIMIT 1
  `
}
