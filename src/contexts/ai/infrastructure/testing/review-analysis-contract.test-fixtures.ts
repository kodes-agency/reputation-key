import { createReviewAnalysisContractV3 } from '#/contexts/ai/application/review-analysis-contract-v3'
import type { AiOutputStorePort } from '#/contexts/ai/application/ports/ai-output-store.port'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from '#/shared/review-analysis-v3-normalizer'

export const TEST_REVIEW_SENTENCES = Object.freeze([
  Object.freeze({ number: 1, text: 'The kitchen made several guests sick.' }),
])

const PROVIDER_LINEAGE = Object.freeze({
  providerId: 'openai' as const,
  model: 'synthetic-model-2026-10-01',
  requestProfileVersion: 'synthetic-request-profile-v1',
  requestProfileDigest: '1'.repeat(64),
})

/** A provider answer under the v3 contract, with one cited mention. */
export const VALID_V3_ANSWER = Object.freeze({
  contract: 'review-analysis-v3' as const,
  answer: {
    sentiment: 'negative' as const,
    mentions: [
      {
        topic: 'food_drink',
        polarity: 'negative',
        strength: 'strong',
        thing: 'kitchen',
        issue: 'sick',
        sentences: [1],
        names_person: null,
      },
    ],
    urgent: { reason: 'health' },
  },
  normalization: {
    version: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
    digest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
    flags: [] as string[],
    droppedMentionCount: 0,
  },
})

/** The v3 contract the use-case tests run under, with a fixed provider and no hints. */
export function createTestReviewAnalysisContract(
  outputs: Pick<AiOutputStorePort, 'storeAnalysisV3'>,
) {
  return createReviewAnalysisContractV3({
    outputs,
    vocabularyContext: { readGooglePrimaryCategory: async () => null },
    providerChoice: {
      chooseForReviewAnalysis: async () => ({
        status: 'chosen' as const,
        lineage: PROVIDER_LINEAGE,
      }),
    },
  })
}
