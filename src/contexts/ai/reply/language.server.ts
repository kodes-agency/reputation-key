import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type {
  GenerateReplySuggestionDependencies,
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from '../application/reply-suggestion-contract'
import {
  mapReviewLanguageMetadata,
  parseCanonicalReplyLanguageTag,
  type ConcreteReplyLanguage,
  type EvaluatedReviewLanguage,
} from '#/shared/ai-review-language-catalogue'
import { resolveAiReplyTemplate } from '#/shared/ai-reply-template-catalogue'
import { REPLY_DRAFTING_V2_SERVED_LANGUAGES } from '#/shared/reply/schema'
import { replyUnavailable as unavailable } from './requests.server'

const SERVED_LANGUAGE_SET: ReadonlySet<string> = new Set(
  REPLY_DRAFTING_V2_SERVED_LANGUAGES,
)

type FallbackResult = Extract<GenerateReplySuggestionResult, { status: 'fallback' }>

function localFallback(
  input: Pick<GenerateReplySuggestionInput, 'tone'>,
  language: ConcreteReplyLanguage,
  rating: 1 | 2 | 3 | 4 | 5,
  metadata: Pick<FallbackResult, 'reason' | 'languageSource'>,
): GenerateReplySuggestionResult {
  const templateId =
    rating === 1
      ? 'recovery_service'
      : rating === 2
        ? 'acknowledge_concern'
        : rating === 3
          ? 'appreciation_neutral'
          : 'appreciation_positive'
  try {
    return {
      status: 'fallback',
      kind: 'local_safe_template',
      reason: metadata.reason,
      languageSource: metadata.languageSource,
      replyText: resolveAiReplyTemplate({
        templateGroup: language.templateGroup,
        tone: input.tone,
        templateId,
      }),
      concreteLanguageTag: language.tag,
    }
  } catch {
    return unavailable('provider_unavailable')
  }
}

type ResolvedTargetReplyLanguage = Readonly<{
  language: ConcreteReplyLanguage
  languageSource: FallbackResult['languageSource']
}>

async function resolveTargetReplyLanguage(
  dependencies: Pick<GenerateReplySuggestionDependencies, 'propertyReplyLanguages'>,
  input: GenerateReplySuggestionInput,
  reviewLanguage: ConcreteReplyLanguage | null,
): Promise<ResolvedTargetReplyLanguage | null> {
  if (input.targetLanguage.kind === 'review_language' && reviewLanguage !== null) {
    return { language: reviewLanguage, languageSource: 'explicit' }
  }
  const configured = await dependencies.propertyReplyLanguages.readDefaultReplyLanguage({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
  })
  const language = configured === null ? null : parseCanonicalReplyLanguageTag(configured)
  return language === null
    ? null
    : {
        language,
        languageSource:
          input.targetLanguage.kind === 'review_language'
            ? 'property_default'
            : 'explicit',
      }
}

type ReviewObservation = Extract<
  Awaited<ReturnType<AiReviewSourcePort['readForAi']>>,
  { status: 'available' }
>['observation']

type SuggestionLanguage =
  // Answered without provider work: a local template or a refusal.
  | Readonly<{ kind: 'settled'; result: GenerateReplySuggestionResult }>
  // A personalized draft in this language may be requested from the provider.
  | Readonly<{
      kind: 'draftable'
      reviewText: string
      evaluatedLanguage: EvaluatedReviewLanguage
      concreteReplyLanguage: ConcreteReplyLanguage
    }>

const settledWith = (result: GenerateReplySuggestionResult): SuggestionLanguage => ({
  kind: 'settled',
  result,
})

/**
 * A local template in a target language chosen without a review language, or
 * the refusal when the Property has none that resolves.
 */
async function templateWithoutReviewLanguage(
  dependencies: Pick<GenerateReplySuggestionDependencies, 'propertyReplyLanguages'>,
  input: GenerateReplySuggestionInput,
  rating: ReviewObservation['rating'],
  reason: Extract<FallbackResult['reason'], 'no_review_text' | 'language_undetermined'>,
): Promise<GenerateReplySuggestionResult> {
  const target = await resolveTargetReplyLanguage(dependencies, input, null)
  return target === null
    ? unavailable('target_language_unavailable')
    : localFallback(input, target.language, rating, {
        reason,
        languageSource: target.languageSource,
      })
}

/**
 * Decides the draft's language before any AI authorization is read. A review
 * without text, metadata or text in no supported language, an explicit
 * template request, and a target language with no personalized profile each
 * settle here with a local template or a refusal; only a target language that
 * can be personalized goes on to provider work.
 */
export async function resolveSuggestionLanguage(
  dependencies: Pick<
    GenerateReplySuggestionDependencies,
    'propertyReplyLanguages' | 'resolveReplyLanguage'
  >,
  input: GenerateReplySuggestionInput,
  observation: ReviewObservation,
): Promise<SuggestionLanguage> {
  if (observation.text === null) {
    return settledWith(
      await templateWithoutReviewLanguage(
        dependencies,
        input,
        observation.rating,
        'no_review_text',
      ),
    )
  }
  const reviewText = observation.text
  const evaluatedLanguage = mapReviewLanguageMetadata(observation.languageCode)
  if (evaluatedLanguage.status !== 'supported') {
    if (!input.templateOnly) {
      return settledWith(
        unavailable(
          evaluatedLanguage.status === 'language_not_supported'
            ? 'language_not_supported'
            : 'policy_unavailable',
        ),
      )
    }
    return settledWith(
      await templateWithoutReviewLanguage(
        dependencies,
        input,
        observation.rating,
        'language_undetermined',
      ),
    )
  }

  const reviewLanguage = await dependencies.resolveReplyLanguage({
    text: reviewText,
    evaluatedLanguage: evaluatedLanguage.language,
  })
  if (reviewLanguage.status !== 'resolved') {
    const canUseTemplate =
      input.templateOnly ||
      (reviewLanguage.status === 'language_not_supported' &&
        reviewLanguage.reason !== 'metadata_language_mismatch')
    if (!canUseTemplate) {
      return settledWith(
        unavailable(
          reviewLanguage.status === 'language_not_supported'
            ? 'language_not_supported'
            : 'policy_unavailable',
        ),
      )
    }
    return settledWith(
      await templateWithoutReviewLanguage(
        dependencies,
        input,
        observation.rating,
        'language_undetermined',
      ),
    )
  }

  const target = await resolveTargetReplyLanguage(
    dependencies,
    input,
    reviewLanguage.language,
  )
  if (target === null) return settledWith(unavailable('target_language_unavailable'))
  if (input.templateOnly) {
    return settledWith(
      localFallback(input, target.language, observation.rating, {
        reason: 'template_requested',
        languageSource: target.languageSource,
      }),
    )
  }
  if (!SERVED_LANGUAGE_SET.has(target.language.templateGroup)) {
    return settledWith(
      localFallback(input, target.language, observation.rating, {
        reason: 'language_not_personalized',
        languageSource: target.languageSource,
      }),
    )
  }
  return {
    kind: 'draftable',
    reviewText,
    evaluatedLanguage: evaluatedLanguage.language,
    concreteReplyLanguage: target.language,
  }
}
