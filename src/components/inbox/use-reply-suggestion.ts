import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_REPLY_LENGTH } from '#/contexts/review/application/public-api'
import type { ReplyDraftSnapshot } from './use-reply-autosave'
import {
  replySuggestionFixTarget,
  replySuggestionUnavailableMessage,
  type PendingReplySuggestion,
  type ReplySuggestionFixTarget,
  type ReplySuggestionResult,
  type ReplyTone,
} from './reply-suggestion-contract'
import {
  resolveSuggestedReplyLanguageTag,
  type ReplyLanguageTarget,
} from './reply-language-options'

export type { ReplySuggestionResult, ReplyTone } from './reply-suggestion-contract'

/**
 * The draft and the language target one assist request runs against, stated
 * explicitly instead of read from the render that built `request`.
 *
 * Row 18's result tag regenerates "in the other target" — a language the
 * composer has NOT selected. The row used to select it first (`updateLanguage`)
 * and pass the scope that change committed, because `request` closes over the
 * render it was created in and would otherwise have generated in the language
 * just left. Committing first had its own cost: the manager's text was retagged
 * and flushed in the new language before the call was made, so a mis-tap, a
 * dismissed preview or a failed call left it saved in a language it is not
 * written in (PR 4 review). The scope is now built without committing
 * (`regenerateScope`, `reply-composer-transitions.ts`) and the language commits
 * on adoption.
 *
 * `draft` is only what the ANSWER is verified against
 * (`resolveSuggestedReplyLanguageTag` below): an explicit tag must match, a
 * `null` tag accepts the review language the boundary detected. What is
 * flushed before generating is always the text in the box as it is — the
 * render's own draft, under the render's own selection — so a regenerate can
 * never persist a language nobody chose. Omitted, `request` reads the render's
 * draft and target exactly as before.
 */
export type ReplyAssistScope = Readonly<{
  draft: ReplyDraftSnapshot
  target: ReplyLanguageTarget | null
}>

type Input = Readonly<{
  draft: ReplyDraftSnapshot
  revision: React.RefObject<number>
  target: ReplyLanguageTarget | null
  /** Saves the box's current draft, under the composer's current selection. */
  onFlush: (draft: ReplyDraftSnapshot) => Promise<void>
  onAccept: (draft: ReplyDraftSnapshot, provenanceToken: string | null) => Promise<void>
  onAdopt: (draft: ReplyDraftSnapshot, kind: 'personalized' | 'local_fallback') => void
  onGenerate?: (
    tone: ReplyTone,
    target: ReplyLanguageTarget,
    templateOnly?: boolean,
  ) => Promise<ReplySuggestionResult>
}>

export function useReplySuggestion(input: Input) {
  const [tone, setTone] = useState<ReplyTone>('professional')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAdopting, setIsAdopting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorFixTarget, setErrorFixTarget] = useState<ReplySuggestionFixTarget | null>(
    null,
  )
  const [suggestion, setSuggestion] = useState<PendingReplySuggestion | null>(null)
  const sequence = useRef(0)

  useEffect(
    () => () => {
      sequence.current += 1
    },
    [],
  )

  const request = useCallback(
    async (
      requestedTone: ReplyTone = tone,
      templateOnly = false,
      scope?: ReplyAssistScope,
    ) => {
      const target = scope ? scope.target : input.target
      if (!input.onGenerate || !target) return
      const requestSequence = ++sequence.current
      const baseRevision = input.revision.current
      const baseDraft = scope ? scope.draft : input.draft
      setTone(requestedTone)
      setIsGenerating(true)
      setError(null)
      setErrorFixTarget(null)
      try {
        await input.onFlush(input.draft)
        const result = templateOnly
          ? await input.onGenerate(requestedTone, target, true)
          : await input.onGenerate(requestedTone, target)
        if (
          requestSequence !== sequence.current ||
          baseRevision !== input.revision.current
        )
          return
        if (result.status === 'unavailable') {
          setError(replySuggestionUnavailableMessage(result.code))
          setErrorFixTarget(replySuggestionFixTarget(result.code))
          return
        }
        const verifiedLanguageTag = resolveSuggestedReplyLanguageTag(
          result.concreteLanguageTag,
          baseDraft.languageTag,
          target,
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
        setSuggestion(
          result.status === 'ready'
            ? {
                draft: nextDraft,
                kind: 'personalized',
                provenanceToken: result.provenanceToken,
              }
            : {
                draft: nextDraft,
                kind: 'local_fallback',
                provenanceToken: null,
                reason: result.reason,
                languageSource: result.languageSource,
              },
        )
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
    setErrorFixTarget(null)
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
    errorFixTarget,
    suggestion,
    request,
    adopt,
    dismiss,
  }
}
