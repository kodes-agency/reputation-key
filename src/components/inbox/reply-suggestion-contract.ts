import type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from '#/contexts/ai/application/public-api'
import type { ReplyTemplateListResult } from '#/contexts/review/application/use-cases/reply-template-operations'
import {
  equivalentReplyLanguageTags,
  languageDisplayName,
} from './reply-language-options'
import type {
  ReplyLanguageTarget,
  ReviewLanguageReadiness,
} from './reply-language-options'
import type { ReplyDraftSnapshot } from './use-reply-autosave'

export type ReplyTone = GenerateReplySuggestionInput['tone']
export type ReplySuggestionResult = GenerateReplySuggestionResult

/**
 * One assist request. `idempotencyKey` belongs to the compose session: the
 * composer reuses it for a retry after a busy answer and for a repeated click
 * while the same draft is being written, and mints a new one for Regenerate
 * or once a request has finished (`use-reply-suggestion.ts`).
 */
export type ReplySuggestionGenerate = (
  tone: ReplyTone,
  target: ReplyLanguageTarget,
  templateOnly: boolean,
  idempotencyKey: string,
) => Promise<ReplySuggestionResult>

type FallbackSuggestionResult = Extract<ReplySuggestionResult, { status: 'fallback' }>

export type PendingReplySuggestion =
  | Readonly<{
      draft: ReplyDraftSnapshot
      kind: 'personalized'
      provenanceToken: string
    }>
  | Readonly<{
      draft: ReplyDraftSnapshot
      kind: 'local_fallback'
      provenanceToken: null
      reason: FallbackSuggestionResult['reason']
      languageSource: FallbackSuggestionResult['languageSource']
    }>

export type LoadedReplyTemplateDraft = Readonly<{
  text: string
  replyLanguageTag?: string | null
  templateId: string | null
  templateVersion: number | null
}>

export type ReplyComposerInput = Readonly<{
  initialText: string
  initialLanguageTag: string | null
  initialAiGenerated: boolean
  propertyLanguage: string | null
  reviewLanguage: string | null
  reviewLanguageReadiness: ReviewLanguageReadiness
  onSaveDraft: (
    text: string,
    provenanceToken?: string,
    replyLanguageTag?: string,
  ) => Promise<unknown>
  onSubmit: () => Promise<unknown>
  onGenerate?: ReplySuggestionGenerate
  onListTemplates?: (target: ReplyLanguageTarget) => Promise<ReplyTemplateListResult>
  onLoadTemplate?: (
    templateId: string,
    target: ReplyLanguageTarget,
  ) => Promise<LoadedReplyTemplateDraft>
}>

export type ReplySuggestionFixTarget = 'public_display_name' | 'ai_settings'

/**
 * A refusal with an operator-clearable requirement. Imported properties often
 * have neither AI enablement nor a Portal brand profile. Both requirements are
 * Property-wide: AI enablement lives in AI settings, while the public display
 * name lives in Property settings and does not require creating a Portal.
 */
export const replySuggestionFixTarget = (
  code: string,
): ReplySuggestionFixTarget | null => {
  if (code === 'brand_profile_unavailable') return 'public_display_name'
  if (code === 'not_authorized') return 'ai_settings'
  return null
}

export const replyTemplateLoadedMessage = (
  suggestion: Pick<
    FallbackSuggestionResult,
    'reason' | 'languageSource' | 'concreteLanguageTag'
  >,
  propertyLanguage: string | null,
): string | null => {
  // The manager asked for the template; there is nothing to explain.
  if (suggestion.reason === 'template_requested') return null
  const languageName =
    languageDisplayName(suggestion.concreteLanguageTag) ?? suggestion.concreteLanguageTag
  const languageSource =
    suggestion.languageSource === 'property_default' ||
    equivalentReplyLanguageTags(suggestion.concreteLanguageTag, propertyLanguage)
      ? 'property default'
      : 'selected language'
  if (suggestion.reason === 'language_not_personalized') {
    return `Personalized drafts aren't available in ${languageName} yet — template loaded (${languageSource}).`
  }
  return suggestion.reason === 'language_undetermined'
    ? `Review language couldn't be detected — template loaded in ${languageName} (${languageSource}).`
    : `This review has no text — template loaded in ${languageName} (${languageSource}).`
}

export const replySuggestionUnavailableMessage = (code: string): string => {
  if (code === 'language_not_supported')
    return 'AI drafting is unavailable for this review language.'
  if (code === 'target_language_unavailable')
    return 'Set a property default reply language in property settings before loading a template.'
  if (code === 'not_authorized')
    return 'AI reply drafting is not enabled for this property.'
  if (code === 'source_changed') return 'The review changed. Reload and try again.'
  if (code === 'brand_profile_unavailable')
    return "Reply suggestions need this property's public display name before they can be generated."
  if (code === 'brand_profile_changed')
    return "This property's display name was updated. Generate the suggestion again to use the latest name."
  if (code === 'busy') return 'AI drafting is handling other requests for this property.'
  if (code === 'provider_unavailable')
    return "AI couldn't write a personalized draft this time."
  return 'AI drafting is unavailable right now. Try again.'
}

/**
 * The refusals after which the governed template is still a sound starting
 * point, offered as the manager's explicit choice — never substituted.
 */
export const replySuggestionOffersTemplate = (code: string): boolean =>
  code === 'busy' || code === 'provider_unavailable' || code === 'not_authorized'
