import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import type { ReplyDraftSnapshot } from './use-reply-autosave'
import type { ReplyLanguageTarget } from './reply-language-options'

export type ReplyTone = 'professional' | 'friendly' | 'casual'
export type ReplySuggestionResult =
  | Readonly<{
      status: 'ready'
      replyText: string
      provenanceToken: string
      expiresAtEpochMillis: number
      baseReplyStateRevision: number
      concreteLanguageTag: string
    }>
  | Readonly<{
      status: 'unavailable'
      code: string
      retryAfterEpochMillis: number | null
    }>

type Input = Readonly<{
  draft: ReplyDraftSnapshot
  revision: React.RefObject<number>
  target: ReplyLanguageTarget | null
  onFlush: (draft: ReplyDraftSnapshot) => Promise<void>
  onAccept: (draft: ReplyDraftSnapshot, provenanceToken: string) => Promise<void>
  onAdopt: (draft: ReplyDraftSnapshot) => void
  onGenerate?: (
    tone: ReplyTone,
    target: ReplyLanguageTarget,
  ) => Promise<ReplySuggestionResult>
}>

function unavailableMessage(code: string): string {
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
  return 'AI drafting is unavailable right now. Try again.'
}

export function useReplySuggestion(input: Input) {
  const [tone, setTone] = useState<ReplyTone>('professional')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)

  useEffect(
    () => () => {
      sequence.current += 1
    },
    [],
  )

  const request = useCallback(
    async (requestedTone: ReplyTone = tone) => {
      if (!input.onGenerate || !input.target) return
      const requestSequence = ++sequence.current
      const baseRevision = input.revision.current
      const baseDraft = input.draft
      setTone(requestedTone)
      setIsGenerating(true)
      setError(null)
      try {
        await input.onFlush(baseDraft)
        const result = await input.onGenerate(requestedTone, input.target)
        if (
          requestSequence !== sequence.current ||
          baseRevision !== input.revision.current
        )
          return
        if (result.status === 'unavailable') {
          setError(unavailableMessage(result.code))
          return
        }
        if (
          !result.replyText ||
          result.replyText.length > MAX_REPLY_LENGTH ||
          result.expiresAtEpochMillis <= Date.now() ||
          result.concreteLanguageTag !== baseDraft.languageTag
        ) {
          setError('The AI draft could not be verified. Try again.')
          return
        }
        const nextDraft = {
          text: result.replyText,
          languageTag: result.concreteLanguageTag,
        }
        await input.onAccept(nextDraft, result.provenanceToken)
        if (
          requestSequence === sequence.current &&
          baseRevision === input.revision.current
        )
          input.onAdopt(nextDraft)
      } catch {
        if (requestSequence === sequence.current) {
          setError('The AI draft could not be saved. Try again.')
        }
      } finally {
        if (requestSequence === sequence.current) setIsGenerating(false)
      }
    },
    [input, tone],
  )

  return { tone, setTone, isGenerating, error, request }
}
