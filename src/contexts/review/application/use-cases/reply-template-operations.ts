import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ReviewId } from '#/shared/domain/ids'
import {
  mapReplyLanguageMetadata,
  parseCanonicalReplyLanguageTag,
  type ConcreteReplyLanguage,
  type ReplyTemplateLanguageGroup,
} from '#/shared/reply-language-catalogue'
import type {
  PropertyReplyProfile,
  PropertyReplyTemplate,
  ReplyTemplateRepository,
} from '../ports/reply-template.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { DraftReply } from './reply-operations'
import type { Reply, Review } from '../../domain/types'
import { MAX_REPLY_LENGTH } from '../../domain/rules'
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

const GREETING_LINE =
  /^(?:dear|hello|hi|greetings|good (?:morning|afternoon|evening))\b.*[,!:]$/iu
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\uFE0F\u20E3]/gu

function hasGreetingLine(body: string, greeting: string): boolean {
  const [firstLine = ''] = body.trimStart().split(/\r?\n/, 1)
  return (
    firstLine
      .trim()
      .localeCompare(greeting.trim(), undefined, { sensitivity: 'accent' }) === 0 ||
    GREETING_LINE.test(firstLine.trim())
  )
}

function stripKnownSignOff(body: string, profile: PropertyReplyProfile): string {
  const trimmed = body.trimEnd()
  const normalized = trimmed.toLocaleLowerCase()
  for (const signOff of [profile.signOffPositive, profile.signOffNegative]) {
    const candidate = signOff.trim()
    if (candidate && normalized.endsWith(candidate.toLocaleLowerCase())) {
      return trimmed.slice(0, trimmed.length - candidate.length).trimEnd()
    }
  }
  return trimmed
}

export function renderReplyTemplate(
  template: PropertyReplyTemplate,
  profile: PropertyReplyProfile | null,
  rating: Review['rating'],
): string {
  let rendered = template.body.trim()
  if (profile === null) return rendered
  if (profile.escalationContact !== null) {
    rendered = rendered.replaceAll('{escalation_contact}', profile.escalationContact)
  }
  if (profile.greeting.trim() && !hasGreetingLine(rendered, profile.greeting)) {
    rendered = `${profile.greeting.trim()}\n\n${rendered}`
  }
  const signOff =
    rating >= 4 ? profile.signOffPositive.trim() : profile.signOffNegative.trim()
  if (signOff) rendered = `${stripKnownSignOff(rendered, profile)}\n\n${signOff}`
  if (!profile.emojiAllowed) {
    rendered = rendered
      .replace(EMOJI, '')
      .replaceAll(/[ \t]+(?=\r?\n|$)/g, '')
      .replaceAll(/[ \t]{2,}/g, ' ')
      .trim()
  }
  return rendered
}

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
