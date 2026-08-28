import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import type { ReplyDraftSnapshot } from './use-reply-autosave'
import {
  replySuggestionUnavailableMessage,
  type PendingReplySuggestion,
  type ReplySuggestionResult,
  type ReplyTone,
} from './reply-suggestion-contract'
import {
  resolveSuggestedReplyLanguageTag,
  type ReplyLanguageTarget,
} from './reply-language-options'

export type { ReplySuggestionResult, ReplyTone } from './reply-suggestion-contract'

type Input = Readonly<{
  draft: ReplyDraftSnapshot
  revision: React.RefObject<number>
  target: ReplyLanguageTarget | null
  onFlush: (draft: ReplyDraftSnapshot) => Promise<void>
  onAccept: (draft: ReplyDraftSnapshot, provenanceToken: string | null) => Promise<void>
  onAdopt: (draft: ReplyDraftSnapshot, kind: 'personalized' | 'local_fallback') => void
  onGenerate?: (
    tone: ReplyTone,
    target: ReplyLanguageTarget,
  ) => Promise<ReplySuggestionResult>
}>

export function useReplySuggestion(input: Input) {
  const [tone, setTone] = useState<ReplyTone>('professional')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAdopting, setIsAdopting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<PendingReplySuggestion | null>(null)
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
          setError(replySuggestionUnavailableMessage(result.code))
          return
        }
        const verifiedLanguageTag = resolveSuggestedReplyLanguageTag(
          result.concreteLanguageTag,
          baseDraft.languageTag,
          input.target,
        )
        if (
          !result.replyText ||
          result.replyText.length > MAX_REPLY_LENGTH ||
          (result.status === 'ready' &&
            (result.profileVersion !== 'reply-draft-v2' ||
              result.expiresAtEpochMillis <= Date.now())) ||
          verifiedLanguageTag === null
        ) {
          setError('The AI draft could not be verified. Try again.')
          return
        }
        const nextDraft = {
          text: result.replyText,
          languageTag: verifiedLanguageTag,
        }
        setSuggestion({
          draft: nextDraft,
          kind: result.status === 'ready' ? 'personalized' : 'local_fallback',
          provenanceToken: result.status === 'ready' ? result.provenanceToken : null,
        })
      } catch {
        if (requestSequence === sequence.current) {
          setError('The draft suggestion could not be generated. Try again.')
        }
      } finally {
        if (requestSequence === sequence.current) setIsGenerating(false)
      }
    },
    [input, tone],
  )

  const dismiss = useCallback(() => {
    sequence.current += 1
    setSuggestion(null)
  }, [])

  const adopt = useCallback(async () => {
    if (suggestion === null || isAdopting) return
    setIsAdopting(true)
    setError(null)
    try {
      await input.onAccept(suggestion.draft, suggestion.provenanceToken)
      input.onAdopt(suggestion.draft, suggestion.kind)
      setSuggestion(null)
    } catch {
      setError('The suggested draft could not be saved. Try again.')
    } finally {
      setIsAdopting(false)
    }
  }, [input, isAdopting, suggestion])

  return {
    tone,
    setTone,
    isGenerating,
    isAdopting,
    error,
    suggestion,
    request,
    adopt,
    dismiss,
  }
}
