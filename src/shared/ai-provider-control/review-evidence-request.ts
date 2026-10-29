import type { AiGatewayRouteRequestV1 } from '#/shared/ai-gateway-transport-contract'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewSentences,
} from '#/shared/ai-deterministic-redactor'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from '#/shared/ai-structured-marker-detectors'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
  normalizeReviewAnalysisV3,
} from '#/shared/review-analysis-v3-normalizer'
import {
  buildReviewAnalysisV3ProviderPayload,
  isCatalogueReviewPropertyContext,
  reviewAnalysisV3GatewayResultSchema,
  reviewRedactionsAgree,
  reviewSentencesAreNumberedFromOne,
  reviewSentencesMatchText,
  REVIEW_ANALYSIS_V3_OPERATION_PROFILE,
  type ReviewAnalysisV3GatewayResult,
} from '#/shared/review-analysis-v3-request'
import type { ReviewPropertyContext } from '#/shared/review-vocabulary-hints'
import { GatewayPreparationError } from './contracts'

// The evidence request path of review-analysis v3 (contract section 6): what the
// provider is sent and how its answer is accepted. The sentences are the review's
// own, numbered by the Review context over the RAW text; this module redacts them
// one by one, so a sentence keeps its number whatever is removed from it, and
// holds the one place a provider answer is normalized into the stored contract.

type ReviewAnalysisRequest = Extract<
  AiGatewayRouteRequestV1,
  { route: 'review-analysis' }
>

export type PreparedReviewEvidence = Readonly<{
  providerPayload: Readonly<Record<string, unknown>>
  /** What the provider reads, sentence `n` at index `n - 1`. Held for the answer. */
  redactedSentences: readonly string[]
  vocabularyHints: ReviewPropertyContext['vocabularyHints']
}>

export function isReviewAnalysisV3Operation(
  request: Readonly<{ binding: Readonly<{ operationProfileVersion: string }> }>,
): boolean {
  return request.binding.operationProfileVersion === REVIEW_ANALYSIS_V3_OPERATION_PROFILE
}

/**
 * The provider payload of a v3 request.
 *
 * `redactedWholeText` is the redaction of the whole canonical text, the v2 fence
 * and the one that has always run. The sentences are redacted from a scan of the
 * review as a whole (`redactAiReviewSentences`), but their whitespace is not the
 * whole text's, so the two redactions are compared: when they differ the review is
 * refused, and a sentence-wise redaction is never weaker than the whole text's.
 */
export function prepareReviewEvidence(
  request: ReviewAnalysisRequest,
  input: Readonly<{ languageTag: string; redactedWholeText: string }>,
): PreparedReviewEvidence {
  const { sentences } = request.source
  const context = request.propertyContext
  const text = request.source.text
  if (sentences === undefined || context === undefined || text === null) {
    throw new GatewayPreparationError('invalid_request')
  }
  if (sentences.length === 0) throw new GatewayPreparationError('text_unavailable')
  if (
    !reviewSentencesAreNumberedFromOne(sentences) ||
    !reviewSentencesMatchText(text, sentences)
  ) {
    throw new GatewayPreparationError('invalid_request')
  }
  if (!isCatalogueReviewPropertyContext(context)) {
    throw new GatewayPreparationError('policy_unavailable')
  }
  const redaction = redactAiReviewSentences({
    sentences: sentences.map((sentence) => sentence.text),
    countryCode: request.redactionCountry,
    expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
    expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
    expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
  if (
    redaction.status !== 'redacted' ||
    !reviewRedactionsAgree(input.redactedWholeText, redaction.sentences)
  ) {
    throw new GatewayPreparationError('redaction_blocked')
  }
  const redactedSentences = [...redaction.sentences]
  return Object.freeze({
    providerPayload: buildReviewAnalysisV3ProviderPayload({
      rating: request.source.rating,
      languageCode: input.languageTag,
      propertyContext: context,
      sentences: redactedSentences,
    }),
    redactedSentences: Object.freeze(redactedSentences),
    vocabularyHints: structuredClone(context.vocabularyHints),
  })
}

/**
 * The single point where a v3 provider answer becomes the stored contract. A
 * correctly shaped answer with faults the normalizer repairs is accepted and its
 * repairs are reported; only an answer with no usable top level is refused, and
 * the call has been billed either way.
 */
export function acceptReviewAnalysisV3Answer(
  rawAnswer: unknown,
  evidence: Pick<PreparedReviewEvidence, 'redactedSentences' | 'vocabularyHints'>,
): ReviewAnalysisV3GatewayResult | null {
  const normalized = normalizeReviewAnalysisV3(rawAnswer, {
    sentences: evidence.redactedSentences,
    vocabularyHints: evidence.vocabularyHints,
  })
  if (normalized.status !== 'normalized') return null
  const result = reviewAnalysisV3GatewayResultSchema.safeParse({
    contract: REVIEW_ANALYSIS_V3_OPERATION_PROFILE,
    answer: normalized.answer,
    normalization: {
      version: REVIEW_ANALYSIS_NORMALIZATION_VERSION,
      digest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
      flags: [...normalized.flags],
      droppedMentionCount: normalized.droppedMentionCount,
    },
  })
  return result.success ? result.data : null
}
