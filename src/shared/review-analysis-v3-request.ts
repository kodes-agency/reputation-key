import '@tanstack/react-start/server-only'
import { z } from 'zod/v4'
import { canonicalizeRfc8785 } from './canonical-json'
import { REVIEW_ANALYSIS_V3_STORED_SCHEMA } from './review-analysis-v3'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_FLAGS,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
} from './review-analysis-v3-normalizer'
import {
  resolveReviewPropertyContext,
  type ReviewPropertyContext,
} from './review-vocabulary-hints'

// The request side of review-analysis v3 (contract §4 and §6), shared by the
// gateway transport contract and the route preparer: how a request names its
// operation profile, which sentences it carries, what the provider is sent and
// what the gateway answers with. Nothing here selects a v3 analysis: the live
// runtime catalogue holds no v3 entry, so a request that names this profile is
// refused as cross-wired before it is prepared.

/** The operation profile a request names to carry sentences and a property context. */
export const REVIEW_ANALYSIS_V3_OPERATION_PROFILE = 'review-analysis-v3' as const

/**
 * A review-analysis request in this profile is bounded by the sentences it
 * carries as well as by its text: up to twice the 64 KB route bound of v2,
 * which a worst case of 16 KB of text in sentences, the same text again, 512
 * sentence wrappers and 4 KB of property context stays under with JSON escaping.
 */
export const AI_REVIEW_V3_ROUTE_MAX_BYTES = 98_304

/** The characters a sentence is compared in: no whitespace, no reviewer markers. */
function comparable(value: string): string {
  return value.replaceAll('[PERSON]', '').replace(/\s+/gu, '')
}

/**
 * Whether the sentences are the whole canonical text, cut. A sentence boundary is
 * whitespace and a masked name leaves one marker per sentence it touches, so the
 * text and its sentences agree on everything but those two. This is the
 * gateway's check that the numbered sentences it was handed describe the review
 * whose digest the operation was claimed under.
 */
export function reviewSentencesMatchText(
  text: string,
  sentences: readonly Readonly<{ text: string }>[],
): boolean {
  return (
    comparable(text) === comparable(sentences.map((sentence) => sentence.text).join(' '))
  )
}

const REDACTION_PLACEHOLDER_RUN =
  /(\[(?:CONTACT|ADDRESS|FINANCIAL|IDENTIFIER|SECRET)\])(?:\1)+/gu

/**
 * Whether the sentences, redacted one by one, say what the redaction of the whole
 * text says. Whitespace and the reviewer markers are set aside as above, and a
 * marker that crossed a sentence boundary stands once in each sentence it touched
 * where the whole text has it once, so a run of the same placeholder counts as
 * one. Anything else that differs is a marker one redaction read and the other
 * did not.
 */
export function reviewRedactionsAgree(
  redactedWholeText: string,
  redactedSentences: readonly string[],
): boolean {
  const normalize = (value: string) =>
    comparable(value).replace(REDACTION_PLACEHOLDER_RUN, '$1')
  return normalize(redactedWholeText) === normalize(redactedSentences.join(' '))
}

/** Whether sentence `n` is at index `n - 1` for every sentence, starting at 1. */
export function reviewSentencesAreNumberedFromOne(
  sentences: readonly Readonly<{ number: number }>[],
): boolean {
  return sentences.every((sentence, index) => sentence.number === index + 1)
}

/**
 * Whether the property context is exactly what the vocabulary catalogue yields
 * for its category: the same hint set, the same hints. The category is a stored
 * fact and the set follows from it, so a context that is anything else was not
 * made by `resolveReviewPropertyContext` in this build.
 */
export function isCatalogueReviewPropertyContext(
  context: ReviewPropertyContext,
): boolean {
  try {
    const expected = resolveReviewPropertyContext(context.googlePrimaryCategory)
    return canonicalizeRfc8785(context) === canonicalizeRfc8785(expected.propertyContext)
  } catch {
    return false
  }
}

/** What the provider is sent (contract §6.1): the redacted, numbered sentences and the hints. */
export function buildReviewAnalysisV3ProviderPayload(
  input: Readonly<{
    rating: number
    languageCode: string
    propertyContext: ReviewPropertyContext
    sentences: readonly string[]
  }>,
): Readonly<{
  rating: number
  languageCode: string
  propertyContext: ReviewPropertyContext
  sentences: readonly Readonly<{ number: number; text: string }>[]
}> {
  return {
    rating: input.rating,
    languageCode: input.languageCode,
    propertyContext: structuredClone(input.propertyContext),
    sentences: input.sentences.map((text, index) => ({ number: index + 1, text })),
  }
}

/**
 * What the gateway answers a v3 request with: the one normalized answer and what
 * the normalizer did to get it, never the provider's own answer. `contract` tells
 * it from a v2 answer, whose keys it shares none of.
 */
export const reviewAnalysisV3GatewayResultSchema = z
  .object({
    contract: z.literal(REVIEW_ANALYSIS_V3_OPERATION_PROFILE),
    answer: REVIEW_ANALYSIS_V3_STORED_SCHEMA,
    normalization: z
      .object({
        version: z.literal(REVIEW_ANALYSIS_NORMALIZATION_VERSION),
        digest: z.literal(REVIEW_ANALYSIS_NORMALIZATION_DIGEST),
        flags: z
          .array(z.enum(REVIEW_ANALYSIS_NORMALIZATION_FLAGS))
          .superRefine((flags, context) => {
            if (new Set(flags).size !== flags.length) {
              context.addIssue({ code: 'custom', message: 'flags must be unique' })
            }
          }),
        droppedMentionCount: z.number().int().min(0).max(48),
      })
      .strict(),
  })
  .strict()

export type ReviewAnalysisV3GatewayResult = z.infer<
  typeof reviewAnalysisV3GatewayResultSchema
>
