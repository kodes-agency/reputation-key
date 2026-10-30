// What a provider is sent in the evaluation and how its answer is accepted
// (contract section 8): the production prompt, the production answer schema,
// the production source canonicalizer, redaction and request payload, and the
// production acceptance point, so the evaluation measures what the live path
// would do. Only the transport differs. A provider here is anything that turns a request into an
// answer: a fake in tests and CI, a file of recorded answers, and later the real
// providers, which this module never calls and cannot reach.

import { performance } from 'node:perf_hooks'
import { acceptReviewAnalysisV3Answer } from '#/shared/ai-provider-control/review-evidence-request'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewSentences,
} from '#/shared/ai-deterministic-redactor'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from '#/shared/ai-structured-marker-detectors'
import { AI_ROUTE_OUTPUT_JSON_SCHEMAS } from '#/shared/ai-route-output-schemas'
import {
  AiReviewSourceRefusal,
  canonicalizeRawAiReviewSentences,
} from '#/shared/ai-review-source-contract'
import type { ReviewAnalysisV3Stored } from '#/shared/review-analysis-v3'
import { REVIEW_ANALYSIS_V3_DEVELOPER_PROMPT } from '#/shared/review-analysis-v3-prompt'
import { buildReviewAnalysisV3ProviderPayload } from '#/shared/review-analysis-v3-request'
import { resolveReviewPropertyContext } from '#/shared/review-vocabulary-hints'
import type { EvaluationItem } from './review-analysis-v3-testset'

/** The country the deterministic redactor reads phone numbers and addresses for. */
export const EVALUATION_REDACTION_COUNTRY = 'US'

type ProviderPayload = ReturnType<typeof buildReviewAnalysisV3ProviderPayload>

/** Everything a real provider adapter needs to ask the production question. */
export type EvaluationRequest = Readonly<{
  itemId: string
  developerPrompt: string
  /** The provider answer's JSON Schema, as the production route derives it. */
  answerSchema: unknown
  payload: ProviderPayload
}>

export type EvaluationUsage = Readonly<{ inputTokens: number; outputTokens: number }>

export type EvaluationOutcome =
  | Readonly<{
      status: 'answered'
      /** The provider's own answer, untrusted: the production normalizer decides. */
      answer: unknown
      latencyMillis?: number
      usage?: EvaluationUsage
    }>
  | Readonly<{
      status: 'refused' | 'truncated' | 'failed'
      latencyMillis?: number
      usage?: EvaluationUsage
    }>

export type EvaluationProvider = Readonly<{
  id: string
  /** The exact model snapshot (decision 4 of the contract); a fake names itself. */
  model: string
  analyze: (request: EvaluationRequest) => Promise<EvaluationOutcome>
}>

type ReviewEvidence = Parameters<typeof acceptReviewAnalysisV3Answer>[1]

export type PreparedEvaluationItem =
  | Readonly<{
      status: 'prepared'
      itemId: string
      request: EvaluationRequest
      /** What the provider reads and the hints it was given; the normalizer needs both. */
      evidence: ReviewEvidence
    }>
  | Readonly<{
      /** The live path would not send this review: its source or its redaction was refused. */
      status: 'redaction_blocked'
      itemId: string
      reason: string
    }>

function languageTagOf(language: string): string {
  return language === 'mixed' ? 'und' : language
}

/** The reviews a Property holds carry a date; the evaluation never reads it. */
const NO_REVIEW_DATE = 0

/**
 * The numbered sentences the live path hands the redactor: the raw text cut by
 * the production splitter, each sentence normalized (NFKC, control characters,
 * identity markers) exactly as the Review context does. A review the source
 * canonicalizer refuses is one the live path never sends.
 */
function canonicalSentencesOf(
  item: EvaluationItem,
  languageCode: string,
): readonly string[] | null {
  try {
    return canonicalizeRawAiReviewSentences({
      text: item.text,
      rating: item.rating,
      languageCode,
      reviewedAtEpochMillis: NO_REVIEW_DATE,
      reviewerDisplayName: null,
    }).map((sentence) => sentence.text)
  } catch (error) {
    if (error instanceof AiReviewSourceRefusal) return null
    throw error
  }
}

/**
 * Canonicalize and redact the item's sentences and build the request exactly as
 * the live path does. An item either step refuses is never sent, as in production.
 */
export function prepareEvaluationItem(
  item: EvaluationItem,
  options: Readonly<{ redactionCountry?: string }> = {},
): PreparedEvaluationItem {
  const languageCode = languageTagOf(item.language)
  const sentences = canonicalSentencesOf(item, languageCode)
  if (sentences === null) {
    return Object.freeze({
      status: 'redaction_blocked',
      itemId: item.id,
      reason: 'source_refused',
    })
  }
  const redaction = redactAiReviewSentences({
    sentences,
    countryCode: options.redactionCountry ?? EVALUATION_REDACTION_COUNTRY,
    expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
    expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
    expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
  if (redaction.status !== 'redacted') {
    return Object.freeze({
      status: 'redaction_blocked',
      itemId: item.id,
      reason: redaction.reason,
    })
  }
  const { propertyContext } = resolveReviewPropertyContext(item.business)
  return Object.freeze({
    status: 'prepared',
    itemId: item.id,
    request: Object.freeze({
      itemId: item.id,
      developerPrompt: REVIEW_ANALYSIS_V3_DEVELOPER_PROMPT,
      answerSchema: AI_ROUTE_OUTPUT_JSON_SCHEMAS['review-analysis-v3'],
      payload: buildReviewAnalysisV3ProviderPayload({
        rating: item.rating,
        languageCode,
        propertyContext,
        sentences: redaction.sentences,
      }),
    }),
    evidence: Object.freeze({
      redactedSentences: Object.freeze([...redaction.sentences]),
      vocabularyHints: structuredClone(propertyContext.vocabularyHints),
    }),
  })
}

/** What the production acceptance point makes of an answer, or why it refused one. */
export type AcceptedAnswer = Readonly<{
  answer: ReviewAnalysisV3Stored
  flags: readonly string[]
  droppedMentionCount: number
}>

export function acceptEvaluationAnswer(
  raw: unknown,
  evidence: ReviewEvidence,
): AcceptedAnswer | null {
  const accepted = acceptReviewAnalysisV3Answer(raw, evidence)
  if (accepted === null) return null
  return Object.freeze({
    answer: accepted.answer,
    flags: Object.freeze([...accepted.normalization.flags]),
    droppedMentionCount: accepted.normalization.droppedMentionCount,
  })
}

export type ItemRunStatus =
  'accepted' | 'output_invalid' | 'refused' | 'truncated' | 'failed' | 'redaction_blocked'

/** One item in one run: the final normalized label, never the provider's envelope. */
export type ItemRunResult = Readonly<{
  itemId: string
  status: ItemRunStatus
  answer: ReviewAnalysisV3Stored | null
  flags: readonly string[]
  droppedMentionCount: number
  latencyMillis: number | null
  usage: EvaluationUsage | null
}>

function resultOf(
  itemId: string,
  status: ItemRunStatus,
  rest: Partial<Omit<ItemRunResult, 'itemId' | 'status'>> = {},
): ItemRunResult {
  return Object.freeze({
    itemId,
    status,
    answer: null,
    flags: Object.freeze([]),
    droppedMentionCount: 0,
    latencyMillis: null,
    usage: null,
    ...rest,
  })
}

async function analyzeOne(
  provider: EvaluationProvider,
  prepared: Extract<PreparedEvaluationItem, { status: 'prepared' }>,
  now: () => number,
): Promise<ItemRunResult> {
  const started = now()
  let outcome: EvaluationOutcome
  try {
    outcome = await provider.analyze(prepared.request)
  } catch {
    // A provider that throws is a failed call, not a crashed run. The reason is
    // withheld: it could carry a request or a key.
    return resultOf(prepared.itemId, 'failed', { latencyMillis: now() - started })
  }
  const timing = {
    latencyMillis: outcome.latencyMillis ?? now() - started,
    usage: outcome.usage ?? null,
  }
  if (outcome.status !== 'answered')
    return resultOf(prepared.itemId, outcome.status, timing)
  const accepted = acceptEvaluationAnswer(outcome.answer, prepared.evidence)
  if (accepted === null) return resultOf(prepared.itemId, 'output_invalid', timing)
  return resultOf(prepared.itemId, 'accepted', { ...accepted, ...timing })
}

/** Run every prepared item through the provider once, in order, one call at a time. */
export async function runProvider(
  provider: EvaluationProvider,
  prepared: readonly PreparedEvaluationItem[],
  options: Readonly<{ now?: () => number }> = {},
): Promise<readonly ItemRunResult[]> {
  const now = options.now ?? (() => performance.now())
  const results: ItemRunResult[] = []
  for (const item of prepared) {
    results.push(
      item.status === 'prepared'
        ? await analyzeOne(provider, item, now)
        : resultOf(item.itemId, 'redaction_blocked'),
    )
  }
  return Object.freeze(results)
}
