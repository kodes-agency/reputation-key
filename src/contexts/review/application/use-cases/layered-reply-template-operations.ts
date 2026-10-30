import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ReviewId } from '#/shared/domain/ids'
import {
  mapReviewLanguageMetadata,
  type EvaluatedReviewLanguage,
} from '#/shared/ai-review-language-catalogue'
import type { ConcreteReplyLanguageResult } from '#/shared/ai-reply-language-verifier'
import {
  parseCanonicalReplyLanguageTag,
  type ReplyTemplateLanguageGroup,
} from '#/shared/reply-language-catalogue'
import { BUILTIN_REPLY_LIBRARY } from '#/shared/reply-library/builtin-library'
import {
  isBuiltinReplyVoiceLanguageGroup,
  type BuiltinReplyVoiceLanguageGroup,
} from '#/shared/reply-library/reply-voice-language-groups'
import { checkReplyText } from '#/shared/reply-library/reply-checks'
import { isReplyRenderError, renderReply } from '#/shared/reply-library/render-reply'
import { pickLeastRecentlyUsed } from '#/shared/reply-library/reply-rotation'
import {
  maxSimilarity,
  REPLY_DUPLICATE_SIMILARITY_THRESHOLD,
} from '#/shared/reply-library/reply-similarity'
import {
  BUILTIN_REPLY_VOICE,
  replyBand,
  resolveVoice,
} from '#/shared/reply-library/reply-voice'
import type {
  LoadedReplyTemplateDto,
  ReplyDraftCheckDto,
  ReplyLibraryRef,
  ReplyTemplateLanguageTarget as ReplyTemplateLanguageTargetDto,
  ReplyTemplateListItemDto,
  ReplyTemplateListResultDto,
} from '../dto/reply-library.dto'
import type { ReplyLibraryRepository } from '../ports/reply-library.repository'
import type { ReviewRepository } from '../ports/review.repository'
import { resolveReplyLibraryTemplates } from '../reply-library-resolver'
import type { Review } from '../../domain/types'
import { reviewError } from '../../domain/errors'
import type { DraftReply } from './reply-operations'
import { requireAccessibleReview, requireReplyManager } from './reply-access'

type ReplyTemplateLanguageTarget = ReplyTemplateLanguageTargetDto
export type ReplyTemplateListItem = ReplyTemplateListItemDto
export type ReplyTemplateListResult = ReplyTemplateListResultDto
export type ResolveReplyTemplateLanguage = (
  input: Readonly<{ text: string; evaluatedLanguage: EvaluatedReviewLanguage }>,
) => Promise<ConcreteReplyLanguageResult>

export type ListReplyTemplates = (
  input: Readonly<{ reviewId: ReviewId; targetLanguage: ReplyTemplateLanguageTarget }>,
  ctx: AuthContext,
) => Promise<ReplyTemplateListResult>

export type ReplyDraftCheck = ReplyDraftCheckDto

export type LoadReplyTemplate = (
  input: Readonly<{
    reviewId: ReviewId
    ref: ReplyLibraryRef
    targetLanguage: ReplyTemplateLanguageTarget
    excludeWordingKeys?: readonly string[]
  }>,
  ctx: AuthContext,
) => Promise<LoadedReplyTemplateDto>

type Deps = Readonly<{
  repository: ReplyLibraryRepository
  reviewRepo: ReviewRepository
  staffPublicApi: StaffPublicApi
  draftReply: DraftReply
  resolveReplyLanguage: ResolveReplyTemplateLanguage
}>

async function loadScope(deps: Deps, review: Review) {
  const snapshot = await deps.repository.loadSnapshot(
    review.organizationId,
    review.propertyId,
  )
  if (!snapshot) throw reviewError('property_not_found', 'Property not found')
  const templates = resolveReplyLibraryTemplates({
    builtin: BUILTIN_REPLY_LIBRARY,
    accountTemplates: snapshot.accountTemplates,
    propertyTemplates: snapshot.propertyTemplates,
    visibility: snapshot.visibility,
  })
  const voice = resolveVoice(
    BUILTIN_REPLY_VOICE,
    snapshot.accountVoice,
    snapshot.propertyVoice,
  )
  return { snapshot, templates, voice }
}

async function targetLanguageGroup(
  deps: Pick<Deps, 'resolveReplyLanguage'>,
  review: Review,
  propertyDefault: string | null,
  target: ReplyTemplateLanguageTarget,
): Promise<ReplyTemplateLanguageGroup | null> {
  if (target.kind === 'review_language' && review.text?.trim()) {
    const evaluatedLanguage = mapReviewLanguageMetadata(review.languageCode)
    if (evaluatedLanguage.status === 'supported') {
      const resolved = await deps.resolveReplyLanguage({
        text: review.text,
        evaluatedLanguage: evaluatedLanguage.language,
      })
      if (resolved.status === 'resolved') return resolved.language.templateGroup
    }
  }
  if (propertyDefault === null) return null
  return parseCanonicalReplyLanguageTag(propertyDefault)?.templateGroup ?? null
}

function matchingTemplates(
  templates: Awaited<ReturnType<typeof loadScope>>['templates'],
  review: Review,
  languageGroup: string | null,
) {
  const reviewKind = review.text?.trim() ? 'text' : 'rating_only'
  return languageGroup === null
    ? []
    : templates
        .filter(
          (template) =>
            template.status !== 'hidden' &&
            template.starsMin <= review.rating &&
            template.starsMax >= review.rating &&
            template.reviewKind === reviewKind &&
            template.wordings[languageGroup as keyof typeof template.wordings]?.length,
        )
        .sort((left, right) => {
          const general = Number(left.topic !== null) - Number(right.topic !== null)
          return general || left.title.localeCompare(right.title)
        })
}

async function loadReviewTemplateContext(
  deps: Deps,
  ctx: AuthContext,
  reviewId: ReviewId,
  target: ReplyTemplateLanguageTarget,
) {
  requireReplyManager(ctx)
  const review = await requireAccessibleReview(deps, ctx, reviewId)
  const scope = await loadScope(deps, review)
  const languageGroup = await targetLanguageGroup(
    deps,
    review,
    scope.snapshot.defaultReplyLanguage,
    target,
  )
  return { review, scope, languageGroup }
}

export const listReplyTemplates =
  (deps: Deps): ListReplyTemplates =>
  async (input, ctx) => {
    const { review, scope, languageGroup } = await loadReviewTemplateContext(
      deps,
      ctx,
      input.reviewId,
      input.targetLanguage,
    )
    const templates = matchingTemplates(scope.templates, review, languageGroup)
    const items = templates.map((template): ReplyTemplateListItem => ({
      id: template.ref,
      ref: template.ref,
      title: template.title,
      aspect: null,
      openLabel: null,
      languageTag: languageGroup!,
      version: template.revision,
      layer: template.layer,
    }))
    return {
      profile: null,
      groups:
        languageGroup === null || items.length === 0
          ? []
          : [{ languageGroup, templates: items }],
      recommendedTemplateId: items[0]?.ref ?? null,
      recommendedReason:
        items.length === 0
          ? null
          : `${review.rating} ${review.rating === 1 ? 'star' : 'stars'} · least used`,
    }
  }

async function checkDraft(
  deps: Deps,
  review: Review,
  text: string,
  languageGroup: string,
  privacyMode: boolean,
  emojiAllowed: boolean,
): Promise<ReplyDraftCheck> {
  const findings = checkReplyText({
    text,
    kind: 'final_reply',
    rating: review.rating,
    reviewKind: review.text?.trim() ? 'text' : 'rating_only',
    languageGroup,
    privacyMode,
    emojiAllowed,
  })
  const recent =
    (await deps.repository.findRecentLiveReplyTexts?.({
      organizationId: review.organizationId,
      propertyId: review.propertyId,
      excludeReviewId: review.id,
      limit: 20,
    })) ?? []
  const similarity = maxSimilarity(text, recent)
  return {
    ...findings,
    maxSimilarity: similarity,
    similar: similarity >= REPLY_DUPLICATE_SIMILARITY_THRESHOLD,
  }
}

function leastUsedIndex(
  length: number,
  usages: readonly Readonly<{ key: string; usedAtEpochMillis: number }>[],
  seed: string,
): number {
  const selected = pickLeastRecentlyUsed(
    Array.from({ length }, (_, index) => String(index)),
    usages,
    seed,
  )
  return selected === null ? 0 : Number(selected)
}

export const loadReplyTemplate =
  (deps: Deps): LoadReplyTemplate =>
  async (input, ctx) => {
    const { review, scope, languageGroup } = await loadReviewTemplateContext(
      deps,
      ctx,
      input.reviewId,
      input.targetLanguage,
    )
    const template = matchingTemplates(scope.templates, review, languageGroup).find(
      ({ ref }) => ref === input.ref,
    )
    if (!template || languageGroup === null) {
      throw reviewError('invalid_input', 'Reply template is unavailable')
    }
    const candidates = template.wordings[languageGroup] ?? []
    const allowed = candidates.filter(
      ({ key }) => !input.excludeWordingKeys?.includes(key),
    )
    if (allowed.length === 0) {
      throw reviewError('invalid_input', 'No other template wording is available')
    }
    const usage =
      (await deps.repository.findPublishedUsage?.({
        organizationId: review.organizationId,
        propertyId: review.propertyId,
        templateRef: template.ref,
      })) ?? []
    const wording = pickLeastRecentlyUsed<(typeof allowed)[number]>(
      allowed,
      usage.flatMap(({ wordingKey, publishedAt }) =>
        wordingKey === null
          ? []
          : [{ key: wordingKey, usedAtEpochMillis: publishedAt.getTime() }],
      ),
      `${review.id}:${template.ref}`,
    )!
    const voiceLanguageGroup: BuiltinReplyVoiceLanguageGroup | null =
      isBuiltinReplyVoiceLanguageGroup(languageGroup) ? languageGroup : null
    let rendered: ReturnType<typeof renderReply> | null = null
    if (voiceLanguageGroup !== null) {
      const recentVoice =
        (await deps.repository.findPublishedUsage?.({
          organizationId: review.organizationId,
          propertyId: review.propertyId,
        })) ?? []
      const band = replyBand(review.rating, Boolean(review.text?.trim()))
      const locale = scope.voice.localized[voiceLanguageGroup]
      const choiceUsage = (field: 'closing' | 'signOff' | 'contactSentence' | 'emoji') =>
        recentVoice.flatMap(({ voiceChoices, publishedAt }) =>
          voiceChoices === null
            ? []
            : [
                {
                  key: String(voiceChoices[field]),
                  usedAtEpochMillis: publishedAt.getTime(),
                },
              ],
        )
      const choices = {
        closing: leastUsedIndex(
          locale.closings[band].value.length,
          choiceUsage('closing'),
          `${review.id}:closing`,
        ),
        signOff: leastUsedIndex(
          locale.signOffWords[review.rating >= 4 ? 'positive' : 'negative'].value.length,
          choiceUsage('signOff'),
          `${review.id}:sign-off`,
        ),
        contactSentence: leastUsedIndex(
          locale.contactSentences.value.length,
          choiceUsage('contactSentence'),
          `${review.id}:contact`,
        ),
        emoji: leastUsedIndex(
          scope.voice.emojiSet.value.length,
          choiceUsage('emoji'),
          `${review.id}:emoji`,
        ),
        includeContact: true,
      }
      rendered = renderTemplateReply({
        body: wording.body,
        voice: scope.voice,
        languageGroup: voiceLanguageGroup,
        rating: review.rating,
        hasText: Boolean(review.text?.trim()),
        reviewerDisplayName: review.reviewerName,
        propertyDisplayName: scope.snapshot.propertyName,
        choices,
      })
    }
    const replyText = rendered?.text ?? wording.body
    const draft = await deps.draftReply(
      {
        reviewId: review.id,
        text: replyText,
        replyLanguageTag: languageGroup,
        templateLayer: template.layer,
        templateRef: template.ref,
        templateRevision: template.revision,
        templateWordingKey: wording.key,
        ...(rendered === null
          ? {}
          : { voiceDigest: rendered.voiceDigest, voiceChoices: rendered.choices }),
      },
      ctx,
    )
    return {
      ...draft,
      hasAlternativeWording: candidates.length > 1,
      duplicateCheck: await checkDraft(
        deps,
        review,
        replyText,
        languageGroup,
        scope.voice.privacyMode.value,
        scope.voice.emojiMode.value === 'positive',
      ),
    }
  }

export type CheckReplyDraft = ReturnType<typeof checkReplyDraft>
export const checkReplyDraft =
  (deps: Deps) =>
  async (
    input: Readonly<{ reviewId: ReviewId; text: string }>,
    ctx: AuthContext,
  ): Promise<ReplyDraftCheck> => {
    const {
      review,
      scope,
      languageGroup: resolvedLanguageGroup,
    } = await loadReviewTemplateContext(deps, ctx, input.reviewId, {
      kind: 'review_language',
    })
    const languageGroup = resolvedLanguageGroup ?? 'en-Latn'
    return checkDraft(
      deps,
      review,
      input.text,
      languageGroup,
      scope.voice.privacyMode.value,
      scope.voice.emojiMode.value === 'positive',
    )
  }

/** A reply the voice cannot fit within Google's limit is the manager's to shorten, not a 500. */
function renderTemplateReply(
  input: Parameters<typeof renderReply>[0],
): ReturnType<typeof renderReply> {
  try {
    return renderReply(input)
  } catch (error) {
    if (isReplyRenderError(error)) {
      throw reviewError(
        'invalid_input',
        'This template is too long once the greeting and signature are added. Shorten it.',
      )
    }
    throw error
  }
}
