import { REPLY_DRAFTING_V2_APOLOGIES } from '#/shared/domain/reply-drafting-v2'
import { REPLY_BODY_RULES } from '#/shared/domain/reply-body-lint-policy'
import { sql } from 'drizzle-orm'
import { check, type AnyPgColumn } from 'drizzle-orm/pg-core'

const APOLOGY_SQL = sql.raw(
  Object.values(REPLY_DRAFTING_V2_APOLOGIES)
    .flat()
    .map((value) => `'${value.replaceAll("'", "''")}'`)
    .join(', '),
)
const HARD_RULES_SQL = sql.raw(
  `'${JSON.stringify(Object.keys(REPLY_BODY_RULES).filter((code) => REPLY_BODY_RULES[code as keyof typeof REPLY_BODY_RULES][0] === 'hard'))}'::jsonb`,
)

export function aiOperationsReplyV2Valid(
  t: Readonly<
    Record<
      'operationProfileVersion' | 'replyDraftingV2' | 'rewriteParentOperationId',
      AnyPgColumn
    >
  >,
) {
  return check(
    'ai_operations_reply_v2_valid',
    sql`((
      (${t.operationProfileVersion} <> 'reply-suggestion-v2' AND ${t.replyDraftingV2} IS NULL AND ${t.rewriteParentOperationId} IS NULL)
      OR (${t.operationProfileVersion} = 'reply-suggestion-v2' AND ${t.replyDraftingV2} IS NOT NULL
        AND jsonb_typeof(${t.replyDraftingV2}) = 'object'
        AND ${t.replyDraftingV2} ?& ARRAY['options','voiceDigest','generationSeed','parentOperationId','rewriteOrdinal','rewriteIssues']
        AND (${t.replyDraftingV2} - ARRAY['options','voiceDigest','generationSeed','parentOperationId','rewriteOrdinal','rewriteIssues']) = '{}'::jsonb
        AND jsonb_typeof(${t.replyDraftingV2}->'options') = 'object'
        AND (${t.replyDraftingV2}->'options') ?& ARRAY['variation','length','opening','apologyStart']
        AND ((${t.replyDraftingV2}->'options') - ARRAY['variation','length','maxWords','opening','apologyStart']) = '{}'::jsonb
        AND jsonb_typeof(${t.replyDraftingV2}->'voiceDigest') = 'string'
        AND jsonb_typeof(${t.replyDraftingV2}->'generationSeed') = 'string'
        AND jsonb_typeof(${t.replyDraftingV2}->'options'->'apologyStart') = 'string'
        AND jsonb_typeof(${t.replyDraftingV2}->'options'->'length') = 'string'
        AND jsonb_typeof(${t.replyDraftingV2}->'options'->'variation') = 'number'
        AND jsonb_typeof(${t.replyDraftingV2}->'options'->'opening') = 'number'
        AND jsonb_typeof(${t.replyDraftingV2}->'rewriteOrdinal') = 'number'
        AND ${t.replyDraftingV2}->>'voiceDigest' ~ '^[0-9a-f]{64}$'
        AND ${t.replyDraftingV2}->>'generationSeed' ~ '^[0-9a-f]{64}$'
        AND ${t.replyDraftingV2}->'options'->>'apologyStart' = ANY (ARRAY[${APOLOGY_SQL}])
        AND ${t.replyDraftingV2}->'options'->>'length' = ANY (ARRAY['standard','short'])
        AND trunc((${t.replyDraftingV2}->'options'->>'variation')::numeric) = (${t.replyDraftingV2}->'options'->>'variation')::numeric
        AND (${t.replyDraftingV2}->'options'->>'variation')::numeric >= 0::numeric AND (${t.replyDraftingV2}->'options'->>'variation')::numeric <= '9007199254740991'::numeric
        AND (${t.replyDraftingV2}->'options'->>'opening')::numeric >= 1::numeric AND (${t.replyDraftingV2}->'options'->>'opening')::numeric <= 3::numeric
        AND trunc((${t.replyDraftingV2}->'options'->>'opening')::numeric) = (${t.replyDraftingV2}->'options'->>'opening')::numeric
        AND (NOT (${t.replyDraftingV2}->'options' ? 'maxWords') OR (
          jsonb_typeof(${t.replyDraftingV2}->'options'->'maxWords') = 'number'
          AND ${t.replyDraftingV2}->'options'->>'length' = 'short'
          AND (${t.replyDraftingV2}->'options'->>'maxWords')::numeric >= 8::numeric AND (${t.replyDraftingV2}->'options'->>'maxWords')::numeric <= 80::numeric
          AND trunc((${t.replyDraftingV2}->'options'->>'maxWords')::numeric) = (${t.replyDraftingV2}->'options'->>'maxWords')::numeric))
        AND jsonb_typeof(${t.replyDraftingV2}->'rewriteIssues') = 'array'
        AND (${t.replyDraftingV2}->'rewriteIssues') <@ ${HARD_RULES_SQL}
        AND ((${t.rewriteParentOperationId} IS NULL AND jsonb_typeof(${t.replyDraftingV2}->'parentOperationId') = 'null' AND jsonb_array_length(${t.replyDraftingV2}->'rewriteIssues') = 0)
          OR (${t.rewriteParentOperationId} IS NOT NULL AND jsonb_typeof(${t.replyDraftingV2}->'parentOperationId') = 'string' AND jsonb_array_length(${t.replyDraftingV2}->'rewriteIssues') BETWEEN 1 AND ${sql.raw(String(Object.keys(REPLY_BODY_RULES).length))}))

        AND NOT (${t.rewriteParentOperationId} IS DISTINCT FROM ((${t.replyDraftingV2}->>'parentOperationId')::uuid))
        AND ((${t.replyDraftingV2}->>'rewriteOrdinal')::numeric = CASE WHEN ${t.rewriteParentOperationId} IS NULL THEN 0 ELSE 1 END))
    ) IS TRUE)`,
  )
}

export function aiOperationsBudgetValid(
  t: Readonly<
    Record<
      | 'actualMicros'
      | 'budgetReservedAt'
      | 'budgetSettledAt'
      | 'costWindowId'
      | 'reservedMicros',
      AnyPgColumn
    >
  >,
) {
  return check(
    'ai_operations_budget_valid',
    sql`${t.reservedMicros} BETWEEN 0 AND '9007199254740991'::bigint
        AND (${t.actualMicros} IS NULL OR ${t.actualMicros} BETWEEN 0 AND ${t.reservedMicros})
        AND ((${t.costWindowId} IS NULL AND ${t.reservedMicros} = 0 AND ${t.budgetReservedAt} IS NULL)
          OR (${t.costWindowId} IS NOT NULL AND ${t.reservedMicros} > 0 AND ${t.budgetReservedAt} IS NOT NULL))
        AND ((${t.budgetSettledAt} IS NULL AND ${t.actualMicros} IS NULL)
          OR (${t.budgetSettledAt} IS NOT NULL AND ${t.actualMicros} IS NOT NULL AND ${t.budgetSettledAt} >= ${t.budgetReservedAt}))`,
  )
}

export function aiOperationsSafeIntegers(
  t: Readonly<
    Record<
      | 'adoptedReplyRevision'
      | 'adoptedReviewReplyStateRevision'
      | 'aggregateRevision'
      | 'analysisSequence'
      | 'baseReplyStateRevision'
      | 'reviewedAtEpochMillis'
      | 'sourceRevision'
      | 'terminalAnalysisSequence',
      AnyPgColumn
    >
  >,
) {
  return check(
    'ai_operations_safe_integers',
    sql`COALESCE(${t.sourceRevision}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.reviewedAtEpochMillis}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.analysisSequence}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.baseReplyStateRevision}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.terminalAnalysisSequence}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.aggregateRevision}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.adoptedReplyRevision}, 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE(${t.adoptedReviewReplyStateRevision}, 0) BETWEEN 0 AND '9007199254740991'::bigint`,
  )
}
