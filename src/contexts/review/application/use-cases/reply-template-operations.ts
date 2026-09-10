import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { ReplyTemplateAspect } from '#/shared/aspect-taxonomy'
import {
  AI_REPLY_STYLE_MAX_EXEMPLARS,
  replyStyleExampleHasRestrictedMaterial,
  type AiReplyStyle,
} from '#/shared/ai-reply-style-contract'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import {
  mapReplyLanguageMetadata,
  parseCanonicalReplyLanguageTag,
  type ConcreteReplyLanguage,
  type ReplyTemplateLanguageGroup,
} from '#/shared/reply-language-catalogue'
import {
  applyReplyTemplateEmojiPolicy,
  renderReplyTemplate,
  stripReplyTemplateProfileFraming,
  type ReplyTemplateRenderProfile,
  type ReplyTemplateRenderTemplate,
} from '#/shared/reply-template-rendering'
import type {
  PropertyReplyProfile,
  PropertyReplyTemplate,
  ReplyTemplateRepository,
} from '../ports/reply-template.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { DraftReply } from './reply-operations'
import type { Reply, Review, StarRating } from '../../domain/types'
import { MAX_REPLY_LENGTH, REPLY_TEMPLATE_SLOT_TOKENS } from '../../domain/rules'
import { reviewError } from '../../domain/errors'
import { requireAccessibleReview, requireReplyManager } from './reply-access'

export type ReplyTemplateLanguageTarget =
  Readonly<{ kind: 'property_default' }> | Readonly<{ kind: 'review_language' }>

export type ReplyTemplateListItem = Readonly<{
  id: string
  title: string
  aspect: PropertyReplyTemplate['aspect']
  openLabel: string | null
  languageTag: string
  version: number
}>

export type ReplyTemplateListResult = Readonly<{
  profile: null | Readonly<{
    greeting: string
    signOffPositive: string
    signOffNegative: string
    emojiAllowed: boolean
    escalationContact: string | null
    version: number
  }>
  groups: readonly Readonly<{
    languageGroup: ReplyTemplateLanguageGroup
    templates: readonly ReplyTemplateListItem[]
  }>[]
  recommendedTemplateId: string | null
}>
export type ListReplyTemplates = (
  input: Readonly<{
    reviewId: ReviewId
    targetLanguage: ReplyTemplateLanguageTarget
  }>,
  ctx: AuthContext,
) => Promise<ReplyTemplateListResult>

export type LoadReplyTemplate = (
  input: Readonly<{
    reviewId: ReviewId
    templateId: string
    targetLanguage: ReplyTemplateLanguageTarget
  }>,
  ctx: AuthContext,
) => Promise<Reply>

type ReplyTemplateDeps = Readonly<{
  repository: ReplyTemplateRepository
  reviewRepo: ReviewRepository
  staffPublicApi: StaffPublicApi
}>

type ResolvedTargetLanguage = Readonly<{
  language: ConcreteReplyLanguage
  source: 'review_language' | 'property_default'
}>

async function resolveTargetLanguage(
  deps: ReplyTemplateDeps,
  review: Review,
  target: ReplyTemplateLanguageTarget,
): Promise<ResolvedTargetLanguage | null> {
  if (target.kind === 'review_language') {
    const mapped = mapReplyLanguageMetadata(review.languageCode)
    if (mapped.status === 'supported' && mapped.language !== null) {
      return { language: mapped.language, source: 'review_language' }
    }
  }
  const configured = await deps.repository.readDefaultReplyLanguage(
    review.organizationId,
    review.propertyId,
  )
  const language = configured === null ? null : parseCanonicalReplyLanguageTag(configured)
  return language === null ? null : { language, source: 'property_default' }
}

function publicProfile(
  profile: PropertyReplyProfile | null,
): ReplyTemplateListResult['profile'] {
  return profile === null
    ? null
    : {
        greeting: profile.greeting,
        signOffPositive: profile.signOffPositive,
        signOffNegative: profile.signOffNegative,
        emojiAllowed: profile.emojiAllowed,
        escalationContact: profile.escalationContact,
        version: profile.version,
      }
}

function compareRecommended(a: PropertyReplyTemplate, b: PropertyReplyTemplate): number {
  const generalDifference = Number(a.aspect !== null) - Number(b.aspect !== null)
  return generalDifference === 0 ? a.title.localeCompare(b.title) : generalDifference
}

export const listReplyTemplates =
  (deps: ReplyTemplateDeps): ListReplyTemplates =>
  async (input, ctx) => {
    requireReplyManager(ctx)
    const review = await requireAccessibleReview(deps, ctx, input.reviewId)
    const [profile, templates, target] = await Promise.all([
      deps.repository.findProfile(ctx.organizationId, review.propertyId),
      deps.repository.findApplicableTemplates({
        organizationId: ctx.organizationId,
        propertyId: review.propertyId,
        rating: review.rating,
        hasText: review.text !== null && review.text.trim().length > 0,
      }),
      resolveTargetLanguage(deps, review, input.targetLanguage),
    ])
    const matching =
      target === null
        ? []
        : templates
            .filter(
              (template) =>
                parseCanonicalReplyLanguageTag(template.languageTag)?.templateGroup ===
                target.language.templateGroup,
            )
            .sort(compareRecommended)
    const groups =
      target === null || matching.length === 0
        ? []
        : [
            {
              languageGroup: target.language.templateGroup,
              templates: matching.map((template): ReplyTemplateListItem => ({
                id: template.id,
                title: template.title,
                aspect: template.aspect,
                openLabel: template.openLabel,
                languageTag: template.languageTag,
                version: template.version,
              })),
            },
          ]
    return {
      profile: publicProfile(profile),
      groups,
      recommendedTemplateId: matching[0]?.id ?? null,
    }
  }

export {
  renderReplyTemplate,
  type ReplyTemplateRenderProfile,
  type ReplyTemplateRenderTemplate,
}

export type AiReplyStyleReader = Readonly<{
  readForAi(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    rating: StarRating
    hasText: boolean
    targetLanguageTag: string
    aspects: readonly ReplyTemplateAspect[] | null
  }): Promise<AiReplyStyle | null>
}>

function sanitizedStyleExample(
  template: PropertyReplyTemplate,
  profile: PropertyReplyProfile,
): string | null {
  const escalationContact =
    profile.escalationContact?.normalize('NFKC').toLowerCase() ?? null
  let body = stripReplyTemplateProfileFraming(template.body, profile)
    .split(/\r?\n/u)
    .filter((line) => {
      const normalized = line.normalize('NFKC').toLowerCase()
      return (
        !normalized.includes('{escalation_contact}') &&
        (escalationContact === null || !normalized.includes(escalationContact))
      )
    })
    .join('\n')
  for (const slot of REPLY_TEMPLATE_SLOT_TOKENS) {
    body = body.replaceAll(slot, '')
  }
  body = body
    .replace(/\{[^{}\r\n]*\}/gu, '')
    .replace(/[ \t]+([.,!?;:])/gu, '$1')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/^[ \t]*[,;:.-]+[ \t]*/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  body = applyReplyTemplateEmojiPolicy(body, profile.emojiAllowed)
  return body.length === 0 ||
    replyStyleExampleHasRestrictedMaterial(body, profile.escalationContact)
    ? null
    : body
}

/**
 * Review-owned read seam for the AI context. It deliberately returns no style
 * unless both a property profile and applicable templates exist, preserving
 * the pre-style drafting path for partially configured properties.
 */
export const createAiReplyStyleReader = (
  repository: ReplyTemplateRepository,
): AiReplyStyleReader => ({
  async readForAi(input) {
    const targetLanguage = parseCanonicalReplyLanguageTag(input.targetLanguageTag)
    if (targetLanguage === null) return null
    const [profile, applicable] = await Promise.all([
      repository.findProfile(input.organizationId, input.propertyId),
      repository.findApplicableTemplates({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        rating: input.rating,
        hasText: input.hasText,
      }),
    ])
    if (profile === null) return null

    const inLanguage = applicable.filter(
      (template) =>
        parseCanonicalReplyLanguageTag(template.languageTag)?.templateGroup ===
        targetLanguage.templateGroup,
    )
    let selected = inLanguage
    if (input.aspects !== null) {
      const aspects = new Set<ReplyTemplateAspect>(input.aspects)
      const matchingAspects = inLanguage.filter(
        (template) => template.aspect !== null && aspects.has(template.aspect),
      )
      selected =
        matchingAspects.length > 0
          ? matchingAspects
          : inLanguage.filter((template) => template.aspect === null)
    }

    const utf8 = new TextEncoder()
    const exemplars = selected
      .map((template) => {
        const body = sanitizedStyleExample(template, profile)
        return body === null
          ? null
          : {
              body,
              byteLength: utf8.encode(body).byteLength,
              id: template.id,
              title: template.title,
            }
      })
      .filter(
        (
          exemplar,
        ): exemplar is Readonly<{
          body: string
          byteLength: number
          id: string
          title: string
        }> => exemplar !== null,
      )
      .sort(
        (left, right) =>
          right.byteLength - left.byteLength ||
          left.title.localeCompare(right.title) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, AI_REPLY_STYLE_MAX_EXEMPLARS)
      .map((exemplar) => exemplar.body)
    if (exemplars.length === 0) return null
    return {
      localProfile: {
        greeting: profile.greeting,
        signOffPositive: profile.signOffPositive,
        signOffNegative: profile.signOffNegative,
        emojiAllowed: profile.emojiAllowed,
        escalationContact: profile.escalationContact,
      },
      exemplars,
    }
  },
})

export const loadReplyTemplate =
  (deps: ReplyTemplateDeps & Readonly<{ draftReply: DraftReply }>): LoadReplyTemplate =>
  async (input, ctx) => {
    requireReplyManager(ctx)
    const review = await requireAccessibleReview(deps, ctx, input.reviewId)
    const [profile, template, target] = await Promise.all([
      deps.repository.findProfile(ctx.organizationId, review.propertyId),
      deps.repository.findEnabledTemplateById({
        organizationId: ctx.organizationId,
        propertyId: review.propertyId,
        templateId: input.templateId,
      }),
      resolveTargetLanguage(deps, review, input.targetLanguage),
    ])
    if (template === null)
      throw reviewError('invalid_input', 'Reply template is unavailable')
    const reviewHasText = review.text !== null && review.text.trim().length > 0
    if (
      template.hasText !== reviewHasText ||
      review.rating < template.ratingMin ||
      review.rating > template.ratingMax
    ) {
      throw reviewError('invalid_input', 'Reply template does not apply to this review')
    }
    const templateLanguage = parseCanonicalReplyLanguageTag(template.languageTag)
    if (
      target === null ||
      templateLanguage === null ||
      templateLanguage.templateGroup !== target.language.templateGroup
    ) {
      throw reviewError(
        'invalid_input',
        'Reply template does not match the target language',
      )
    }
    const text = renderReplyTemplate(template, profile, review.rating)
    if (!text.trim() || text.length > MAX_REPLY_LENGTH) {
      throw reviewError(
        'invalid_reply',
        'Rendered reply template is outside reply limits',
      )
    }
    return deps.draftReply(
      {
        reviewId: review.id,
        text,
        replyLanguageTag: target.language.tag,
        templateId: template.id,
        templateVersion: template.version,
      },
      ctx,
    )
  }
