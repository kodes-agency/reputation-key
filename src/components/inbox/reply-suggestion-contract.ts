import type {
  GenerateReplySuggestionInput,
  GenerateReplySuggestionResult,
} from '#/contexts/ai/application/public-api'
import type { ReplyLanguageTarget } from './reply-language-options'
import type { ReplyDraftSnapshot } from './use-reply-autosave'

export type ReplyTone = GenerateReplySuggestionInput['tone']
export type ReplySuggestionResult = GenerateReplySuggestionResult

export type PendingReplySuggestion = Readonly<{
  draft: ReplyDraftSnapshot
  kind: 'personalized' | 'local_fallback'
  provenanceToken: string | null
}>

export type ReplyComposerInput = Readonly<{
  initialText: string
  initialLanguageTag: string | null
  initialAiGenerated: boolean
  propertyLanguage: string | null
  reviewLanguage: string | null
  canDetectReviewLanguage: boolean
  onSaveDraft: (
    text: string,
    provenanceToken?: string,
    replyLanguageTag?: string,
  ) => Promise<unknown>
  onSubmit: () => Promise<unknown>
  onGenerate?: (
    tone: ReplyTone,
    target: ReplyLanguageTarget,
  ) => Promise<ReplySuggestionResult>
}>

export const replySuggestionUnavailableMessage = (code: string): string => {
  if (code === 'language_not_supported')
    return 'AI drafting is unavailable for this review language.'
  if (code === 'language_undetermined')
    return 'The review is too short to determine its language.'
  if (code === 'target_language_unavailable')
    return 'AI drafting is unavailable in the selected reply language.'
  if (code === 'not_authorized')
    return 'AI reply drafting is not enabled for this property.'
  if (code === 'no_review_text') return 'This review has no text to draft from.'
  if (code === 'source_changed') return 'The review changed. Reload and try again.'
  if (code === 'brand_profile_unavailable')
    return "Reply suggestions need this property's public display name before they can be generated."
  if (code === 'brand_profile_changed')
    return "This property's display name was updated. Generate the suggestion again to use the latest name."
  return 'AI drafting is unavailable right now. Try again.'
}
