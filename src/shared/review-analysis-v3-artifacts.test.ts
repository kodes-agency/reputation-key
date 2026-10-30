import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { describe, expect, it } from 'vitest'
import { AI_OPERATION_PROFILES } from './ai-operation-profiles'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from './ai-route-output-schemas'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { REVIEW_ANALYSIS_V3_STORED_SCHEMA } from './review-analysis-v3'
import {
  REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS,
  REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS_DIGEST,
} from './review-analysis-v3-artifacts'

function digest(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}

function plainStoredJsonSchema(): ReturnType<typeof z.toJSONSchema> {
  return JSON.parse(
    JSON.stringify(
      z.toJSONSchema(REVIEW_ANALYSIS_V3_STORED_SCHEMA, { target: 'draft-7' }),
    ),
  ) as ReturnType<typeof z.toJSONSchema>
}

describe('review analysis v3 logical artifacts', () => {
  it('pins every artifact version and digest', () => {
    expect(REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS).toEqual({
      topicTaxonomyVersion: 'review-topic-taxonomy-v3',
      topicTaxonomyDigest:
        '6d69e3f14e8ca3ef34b6078db763ca719c4613f11ab9bf4a4d05391a50b30eb0',
      sentenceRulesVersion: 'review-sentences-v1',
      sentenceRulesDigest:
        'b7e81ba1117905c6ef567418dba1696af46fa11ab0b2a87c33100214b8fc451a',
      normalizerVersion: 'review-analysis-normalization-v1',
      normalizerDigest:
        '793a9d95b421469ed9794fb92e922366770736454cd9ef78aea1b7c5df1a1fd2',
      attentionFormulaVersion: 'review-attention-v2',
      attentionFormulaDigest:
        '42473e84ab5b376cd06940ac4060b7e8c875100507247c91e70450d220bed687',
      providerAnswerSchemaDigest:
        'dec7c35b4ab98677c64f5b74016af70f6a6192bc59a291044a6c264ea3ac6ef4',
      storedSchemaDigest:
        '27eb2a788d851796e5e9a11ae69768f4981e7f2b1722154893cac51a9c10b685',
    })
    expect(REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS_DIGEST).toBe(
      '3e1aa101b347f90fc14e037b357602537c6972f8fb0c7eca9267034efcdbb3e2',
    )
    expect(Object.isFrozen(REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS)).toBe(true)
  })

  it('derives the provider-answer and stored-schema digests from closed JSON', () => {
    expect(REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS.providerAnswerSchemaDigest).toBe(
      digest(
        'repkey-ai-output-schema-v1\0',
        AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3'],
      ),
    )
    expect(REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS.storedSchemaDigest).toBe(
      digest('repkey-review-analysis-v3-stored-schema-v1\0', plainStoredJsonSchema()),
    )
  })

  it('uses the live operation-profile output-schema digest scheme', () => {
    expect(AI_OPERATION_PROFILES[0]?.profileVersion).toBe('review-analysis-v2')
    expect(AI_OPERATION_PROFILES[0]?.outputSchemaDigest).toBe(
      digest(
        'repkey-ai-output-schema-v1\0',
        AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v2'],
      ),
    )
  })

  it('derives the aggregate artifact digest from the pinned object', () => {
    expect(REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS_DIGEST).toBe(
      digest(
        'repkey-review-analysis-v3-logical-artifacts-v1\0',
        REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS,
      ),
    )
  })
})
