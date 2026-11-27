import { templateFrameChoices } from './template-frame-choices.server'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
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
import {
  isBuiltinReplyVoiceLanguageGroup,
  type BuiltinReplyVoiceLanguageGroup,
} from '#/shared/reply-library/reply-voice-language-groups'
import { checkReplyText } from '#/shared/reply-library/reply-checks'
import { isReplyRenderError, renderReply } from '#/shared/reply-library/render-reply'
import {
  orderOptions,
  pickLeastRecentlyUsed,
} from '#/shared/reply-library/reply-rotation'
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
} from './contracts'
import type { ReplyLibraryRepository } from './reply-library-repository.port.server'
import type { ReviewRepository } from '../reviews/review-repository.port.server'
import { resolveSnapshotTemplates } from './reply-library-resolver.contracts'
import type { Review } from '../domain/review-types'
import { reviewError } from '../domain/review-errors'
import type { DraftReply } from '../replies/reply-operations.server'
import {
  requireAccessibleReview,
  requireReplyManager,
} from '../replies/reply-access.server'

type ReplyTemplateLanguageTarget = ReplyTemplateLanguageTargetDto
export type ResolveReplyTemplateLanguage = (
  input: Readonly<{ text: string; evaluatedLanguage: EvaluatedReviewLanguage }>,
) => Promise<ConcreteReplyLanguageResult>

export type ListReplyTemplates = (
  input: Readonly<{ reviewId: ReviewId; targetLanguage: ReplyTemplateLanguageTarget }>,
  ctx: AuthContext,
) => Promise<ReplyTemplateListResultDto>

export type LoadReplyTemplate = (
  input: Readonly<{
    reviewId: ReviewId
    ref: ReplyLibraryRef
    targetLanguage: ReplyTemplateLanguageTarget
    expectedReply?: import('#/shared/reply/reply-revision').ReplyRevision | null
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
  const voice = resolveVoice(
    BUILTIN_REPLY_VOICE,
    snapshot.accountVoice,
    snapshot.propertyVoice,
  )
  return { snapshot, voice }
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
  templates: ReturnType<typeof resolveSnapshotTemplates>,
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
    const templates = matchingTemplates(
      resolveSnapshotTemplates(scope.snapshot),
      review,
      languageGroup,
    )
    const items = templates.map((template): ReplyTemplateListItemDto => ({
      id: template.ref,
      title: template.title,
    }))
    return {
      groups:
        languageGroup === null || items.length === 0
          ? []
          : [{ languageGroup, templates: items }],
      recommendedTemplateId: items[0]?.id ?? null,
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
): Promise<ReplyDraftCheckDto> {
  const findings = checkReplyText({
    text,
    kind: 'final_reply',
    rating: review.rating,
    reviewKind: review.text?.trim() ? 'text' : 'rating_only',
    languageGroup,
    privacyMode,
    emojiAllowed,
  })
  const recent = await deps.repository.findRecentLiveReplyTexts({
    organizationId: review.organizationId,
    propertyId: review.propertyId,
    excludeReviewId: review.id,
    limit: 20,
  })
  const similarity = maxSimilarity(text, recent)
  return {
    ...findings,
    maxSimilarity: similarity,
    similar: similarity >= REPLY_DUPLICATE_SIMILARITY_THRESHOLD,
  }
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
    const template = matchingTemplates(
      resolveSnapshotTemplates(scope.snapshot),
      review,
      languageGroup,
    ).find(({ ref }) => ref === input.ref)
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
    const usage = await deps.repository.findPublishedUsage({
      organizationId: review.organizationId,
      propertyId: review.propertyId,
      templateRef: template.ref,
    })
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
      const recentVoice = await deps.repository.findPublishedUsage({
        organizationId: review.organizationId,
        propertyId: review.propertyId,
      })
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
        closing:
          orderOptions(
            locale.closings[band].value.length,
            choiceUsage('closing'),
            `${review.id}:closing`,
          )[0] ?? 0,
        signOff:
          orderOptions(
            locale.signOffWords[review.rating >= 4 ? 'positive' : 'negative'].value
              .length,
            choiceUsage('signOff'),
            `${review.id}:sign-off`,
          )[0] ?? 0,
        contactSentence:
          orderOptions(
            locale.contactSentences.value.length,
            choiceUsage('contactSentence'),
            `${review.id}:contact`,
          )[0] ?? 0,
        emoji:
          orderOptions(
            scope.voice.emojiSet.value.length,
            choiceUsage('emoji'),
            `${review.id}:emoji`,
          )[0] ?? 0,
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
        expectedReply: input.expectedReply,
        replyLanguageTag: languageGroup,
        template: {
          layer: template.layer,
          ref: template.ref,
          revision: template.revision,
          wordingKey: wording.key,
        },
        ...(rendered === null
          ? {}
          : {
              voice: {
                digest: rendered.voiceDigest,
                choices: templateFrameChoices(
                  rendered.choices,
                  replyBand(review.rating, Boolean(review.text?.trim())),
                ),
              },
            }),
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
  ): Promise<ReplyDraftCheckDto> => {
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
