import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from './ai-route-output-schemas'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import {
  REVIEW_ANALYSIS_V3_STORED_SCHEMA,
  REVIEW_ATTENTION_V2_DIGEST,
  REVIEW_ATTENTION_V2_VERSION,
} from './review-analysis-v3'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from './review-analysis-v3-normalizer'
import { REVIEW_SENTENCES_DIGEST, REVIEW_SENTENCES_VERSION } from './review-sentences'
import {
  REVIEW_TOPIC_TAXONOMY_V3_DIGEST,
  REVIEW_TOPIC_TAXONOMY_VERSION,
} from './review-topic-taxonomy'

function digest(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}

const providerAnswerSchemaDigest = digest(
  'repkey-ai-output-schema-v1\0',
  AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3'],
)
// Zod attaches non-JSON metadata to the returned root object. The governed
// artifact is the JSON Schema document, so close it to plain JSON first.
const storedJsonSchema = JSON.parse(
  JSON.stringify(z.toJSONSchema(REVIEW_ANALYSIS_V3_STORED_SCHEMA, { target: 'draft-7' })),
) as ReturnType<typeof z.toJSONSchema>
const storedSchemaDigest = digest(
  'repkey-review-analysis-v3-stored-schema-v1\0',
  storedJsonSchema,
)

export const REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS = Object.freeze({
  topicTaxonomyVersion: REVIEW_TOPIC_TAXONOMY_VERSION,
  topicTaxonomyDigest: REVIEW_TOPIC_TAXONOMY_V3_DIGEST,
  sentenceRulesVersion: REVIEW_SENTENCES_VERSION,
  sentenceRulesDigest: REVIEW_SENTENCES_DIGEST,
  normalizerVersion: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
  normalizerDigest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  attentionFormulaVersion: REVIEW_ATTENTION_V2_VERSION,
  attentionFormulaDigest: REVIEW_ATTENTION_V2_DIGEST,
  providerAnswerSchemaDigest,
  storedSchemaDigest,
})

export const REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS_DIGEST = digest(
  'repkey-review-analysis-v3-logical-artifacts-v1\0',
  REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS,
)
