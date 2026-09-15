import { useCallback, useEffect, useRef, useState } from 'react'
import { replyCommentProblem } from '#/shared/google-provider-control/reply-comment'
import type { ReplyDraftSnapshot } from './use-reply-autosave'
import {
  replySuggestionFixTarget,
  replySuggestionOffersTemplate,
  replySuggestionUnavailableMessage,
  type PendingReplySuggestion,
  type ReplySuggestionFixTarget,
  type ReplySuggestionGenerate,
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
  onGenerate?: ReplySuggestionGenerate
}>

/**
 * Which draft a request is for. A request with the same identity reuses its
 * idempotency key, so the server coalesces it onto the operation already
 * waiting or running; a different tone or language target is another draft.
 */
function requestIdentity(
  tone: ReplyTone,
  target: ReplyLanguageTarget,
  templateOnly: boolean,
): string {
  return `${templateOnly ? 'template' : 'ai'}:${tone}:${target.kind}`
}

export function useReplySuggestion(input: Input) {
  const [tone, setTone] = useState<ReplyTone>('professional')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAdopting, setIsAdopting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorFixTarget, setErrorFixTarget] = useState<ReplySuggestionFixTarget | null>(
    null,
  )
  const [suggestion, setSuggestion] = useState<PendingReplySuggestion | null>(null)
  /** Set when our own AI capacity is busy; the retry time the server gave. */
  const [busyUntil, setBusyUntil] = useState<number | null>(null)
  /** The last refusal leaves the governed template as a sound, explicit choice. */
  const [offersTemplate, setOffersTemplate] = useState(false)
  const sequence = useRef(0)
  const idempotencyKeys = useRef(new Map<string, string>())
  const inFlight = useRef<Readonly<{ identity: string; promise: Promise<void> }> | null>(
    null,
  )

  useEffect(
    () => () => {
      sequence.current += 1
    },
    [],
  )

  const request = useCallback(
    (
      requestedTone: ReplyTone = tone,
      templateOnly = false,
      scope?: ReplyAssistScope,
    ): Promise<void> => {
      const target = scope ? scope.target : input.target
      const onGenerate = input.onGenerate
      if (!onGenerate || !target) return Promise.resolve()
      const identity = requestIdentity(requestedTone, target, templateOnly)
      // A repeated click while the same draft is being written joins it
      // instead of racing it: the later answer would otherwise win.
      if (inFlight.current?.identity === identity) return inFlight.current.promise
      const requestSequence = ++sequence.current
      const baseRevision = input.revision.current
      const baseDraft = scope ? scope.draft : input.draft
      const idempotencyKey = idempotencyKeys.current.get(identity) ?? crypto.randomUUID()
      idempotencyKeys.current.set(identity, idempotencyKey)
      setTone(requestedTone)
      setIsGenerating(true)
      setError(null)
      setErrorFixTarget(null)
      setBusyUntil(null)
      setOffersTemplate(false)
      const run = async () => {
        try {
          await input.onFlush(input.draft)
          const result = await onGenerate(
            requestedTone,
            target,
            templateOnly,
            idempotencyKey,
          )
          // Busy is the only answer that keeps the key: the retry belongs to
          // the same request. Everything else finished that request, so the
          // next click (including Regenerate) is a new draft.
          if (result.status !== 'unavailable' || result.code !== 'busy') {
            idempotencyKeys.current.delete(identity)
          }
          if (
            requestSequence !== sequence.current ||
            baseRevision !== input.revision.current
          )
            return
          if (result.status === 'unavailable') {
            setError(replySuggestionUnavailableMessage(result.code))
            setErrorFixTarget(replySuggestionFixTarget(result.code))
            setOffersTemplate(!templateOnly && replySuggestionOffersTemplate(result.code))
            if (result.code === 'busy' && result.retryAfterEpochMillis !== null) {
              setBusyUntil(result.retryAfterEpochMillis)
            }
            return
          }
          const verifiedLanguageTag = resolveSuggestedReplyLanguageTag(
            result.concreteLanguageTag,
            baseDraft.languageTag,
            target,
          )
          if (
            !result.replyText ||
            replyCommentProblem(result.replyText) !== null ||
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
          idempotencyKeys.current.delete(identity)
          if (requestSequence === sequence.current) {
            setError('The draft suggestion could not be generated. Try again.')
          }
        } finally {
          if (inFlight.current?.identity === identity) inFlight.current = null
          if (requestSequence === sequence.current) setIsGenerating(false)
        }
      }
      const promise = run()
      inFlight.current = { identity, promise }
      return promise
    },
    [input, tone],
  )

  /** The explicit choice after a refusal: the governed template, never a substitute. */
  const requestTemplate = useCallback(() => request(tone, true), [request, tone])

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
    busyUntil,
    offersTemplate,
    suggestion,
    request,
    requestTemplate,
    adopt,
    dismiss,
  }
}
