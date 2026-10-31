import { isDraftWaiting } from './reply-draft-session'
import {
  useStreamedReplyDraft,
  useRestoreStreamedReplyDraft,
} from './use-streamed-reply-draft'
import { createDraftMeasurementSession, measuredDraftSnapshot } from './reply-measurement'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReplyDraftSnapshot } from './use-reply-autosave'
import {
  isReplySuggestionVerifiable,
  retryPendingReply,
  chooseReplyTone,
  type PendingReplyRequest,
  type ReplyAssistScope,
  replySuggestionFixTarget,
  replySuggestionOffersTemplate,
  replySuggestionUnavailableMessage,
  type PendingReplySuggestion,
  type ReplySuggestionFixTarget,
  type ReplySuggestionGenerate,
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
export type { ReplyAssistScope } from './reply-suggestion-contract'

type Input = Readonly<{
  draft: ReplyDraftSnapshot
  revision: React.RefObject<number>
  target: ReplyLanguageTarget | null
  /** Saves the box's current draft, under the composer's current selection. */
  onFlush: (draft: ReplyDraftSnapshot) => Promise<void>
  onAccept: (draft: ReplyDraftSnapshot, provenanceToken: string | null) => Promise<void>
  onAdopt: (draft: ReplyDraftSnapshot, kind: 'personalized' | 'local_fallback') => void
  initialMeasurementGenerationId?: string | null
  initialMeasurementBaseReplyRevision?: number | null
  onMeasure?: (
    event: import('#/shared/domain/draft-measurement').DraftMeasurementEvent,
  ) => void
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
  trigger?: string,
  maxWords?: number,
): string {
  return `${templateOnly ? 'template' : 'ai'}:${tone}:${target.kind}:${trigger ?? 'draft'}:${maxWords ?? 'standard'}`
}

export function useReplySuggestion(input: Input) {
  const stream = useStreamedReplyDraft(input.onGenerate)
  const [tone, setTone] = useState<ReplyTone>(stream.initialTone)
  const [{ isGenerating, isAdopting }, setActivity] = useState({
    isGenerating: false,
    isAdopting: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [errorFixTarget, setErrorFixTarget] = useState<ReplySuggestionFixTarget | null>(
    null,
  )
  const [suggestion, setSuggestion] = useState<PendingReplySuggestion | null>(null)
  /** Set when our own AI capacity is busy; the retry time the server gave. */
  const [busyUntil, setBusyUntil] = useState<number | null>(null)
  /** The last refusal leaves the governed template as a sound, explicit choice. */
  const [offersTemplate, setOffersTemplate] = useState(false)
  const [measurement] = useState(() =>
    createDraftMeasurementSession(
      input.onMeasure,
      input.initialMeasurementGenerationId,
      input.initialMeasurementBaseReplyRevision,
    ),
  )
  useEffect(() => measurement.setEmitter(input.onMeasure), [measurement, input.onMeasure])
  const sequence = useRef(0)
  const idempotencyKeys = useRef(new Map<string, PendingReplyRequest>())
  const inFlight = useRef<Readonly<{ identity: string; promise: Promise<void> }> | null>(
    null,
  )
  /**
   * Which request currently owns `isGenerating`, which is NOT the same question
   * as which request's ANSWER still counts.
   *
   * `sequence` is bumped by three things — a new request, `dismiss()`, and
   * unmount — because all three retire a pending answer. Clearing the spinner on
   * `requestSequence === sequence.current` therefore skipped whenever a request
   * was superseded by a dismiss, and `updateDraft` calls `ai.dismiss()` on every
   * keystroke while the textarea stays enabled during generation
   * (`reply-editor-compose.tsx` omits `isGenerating` from its `disabled` list on
   * purpose). One character typed before the draft landed left `isGenerating`
   * true for the life of the mount: `busy` disabled every assist control and
   * `canSubmit` — which reads `!ai.isGenerating` — refused the reply for good.
   *
   * Only a new REQUEST takes ownership, and it re-raises the flag itself, so the
   * owner may always clear unconditionally. A click that joins the request in
   * flight (`inFlight`) is not a new request: it takes nothing, and the owner's
   * `finally` clears the flag for both.
   */
  const generatingRequest = useRef(0)

  useEffect(() => {
    const detach = measurement.attach()
    return () => {
      sequence.current += 1
      detach()
    }
  }, [measurement])

  const showResult = useCallback(
    (
      result: Extract<ReplySuggestionResult, { status: 'ready' | 'fallback' }>,
      baseDraft: ReplyDraftSnapshot,
      target: ReplyLanguageTarget,
    ) => {
      const verifiedLanguageTag = resolveSuggestedReplyLanguageTag(
        result.concreteLanguageTag,
        baseDraft.languageTag,
        target,
      )
      if (!isReplySuggestionVerifiable(result, verifiedLanguageTag)) {
        setError('The AI draft could not be verified. Try again.')
        return
      }
      measurement.show(result)
      const nextDraft = measuredDraftSnapshot(result, {
        text: result.replyText,
        languageTag: verifiedLanguageTag,
      })
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
    },
    [measurement],
  )

  const request = useCallback(
    (
      requestedTone: ReplyTone = tone,
      templateOnly = false,
      scope?: ReplyAssistScope,
      explicitTrigger?: 'draft' | 'try_again' | 'shorter' | 'tone',
      options?: Readonly<{ length: 'short'; maxWords: number }>,
    ): Promise<void> => {
      const target = scope ? scope.target : input.target
      const onGenerate = stream.generate
      if (!onGenerate || !target) return Promise.resolve()
      const identity = requestIdentity(
        requestedTone,
        target,
        templateOnly,
        explicitTrigger,
        options?.maxWords,
      )
      // A repeated click while the same draft is being written joins it
      // instead of racing it: the later answer would otherwise win.
      if (inFlight.current?.identity === identity) return inFlight.current.promise
      const pending = idempotencyKeys.current.get(identity)
      const trigger = measurement.request(
        requestedTone,
        pending?.trigger ?? explicitTrigger,
        templateOnly,
      )
      const requestSequence = ++sequence.current
      generatingRequest.current = requestSequence
      const baseRevision = input.revision.current
      const baseDraft = scope ? scope.draft : input.draft
      const idempotencyKey = pending?.key ?? crypto.randomUUID()
      idempotencyKeys.current.set(identity, {
        key: idempotencyKey,
        trigger,
        args: [requestedTone, templateOnly, scope, explicitTrigger, options],
      })
      setTone(requestedTone)
      stream.session?.reveal()
      setActivity((current) => ({ ...current, isGenerating: true }))
      setSuggestion(null)
      setError(null)
      setErrorFixTarget(null)
      setBusyUntil(null)
      setOffersTemplate(false)
      const run = async () => {
        try {
          // The flush is a SAVE, not a generation, and it has its own failure
          // message. Inside the generation `try` a rejected save printed "The
          // draft suggestion could not be generated" while the composer head
          // printed `Not saved` — two accounts of one event, and the actionable
          // one was the one the error line did not give. The autosave channel
          // already says what went wrong and offers `Try saving again`, so this
          // returns and lets it speak. The request still ends as a failure: its
          // key goes, so the next click is a new draft, and the `finally` below
          // releases `inFlight` and, for its owner, the spinner.
          try {
            await input.onFlush(input.draft)
          } catch {
            idempotencyKeys.current.delete(identity)
            return
          }
          if (requestSequence !== sequence.current) return
          const result = await onGenerate(
            requestedTone,
            target,
            templateOnly,
            idempotencyKey,
            trigger,
            ...(options ? ([options] as const) : []),
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
            return measurement.discard(result)
          if (result.status === 'unavailable') {
            setError(replySuggestionUnavailableMessage(result.code))
            setErrorFixTarget(replySuggestionFixTarget(result.code))
            setOffersTemplate(!templateOnly && replySuggestionOffersTemplate(result.code))
            if (result.code === 'busy' && result.retryAfterEpochMillis !== null) {
              setBusyUntil(result.retryAfterEpochMillis)
            }
            return
          }
          showResult(result, baseDraft, target)
        } catch {
          idempotencyKeys.current.delete(identity)
          // Typing or dismissal retires thrown failures as well as returned refusals.
          if (requestSequence === sequence.current) {
            setError('The draft suggestion could not be generated. Try again.')
          }
        } finally {
          if (inFlight.current?.identity === identity) inFlight.current = null
          if (generatingRequest.current === requestSequence)
            setActivity((current) => ({ ...current, isGenerating: false }))
        }
      }
      const promise = run()
      inFlight.current = { identity, promise }
      return promise
    },
    [input, tone, measurement, stream, showResult],
  )

  useRestoreStreamedReplyDraft({
    stream,
    isGenerating,
    suggestion,
    restore: (result, options) => {
      measurement.request(options.tone, options.trigger)
      setTone(options.tone)
      showResult(
        result,
        { ...input.draft, languageTag: result.concreteLanguageTag },
        options.targetLanguage,
      )
    },
    retire: () => {
      sequence.current += 1
      setSuggestion(null)
      setActivity((current) => ({ ...current, isGenerating: false }))
      measurement.dismiss(false)
    },
  })

  /** The explicit choice after a refusal: the governed template, never a substitute. */
  const requestTemplate = () => request(tone, true)

  const dismiss = useCallback(
    (explicit = true) => {
      measurement.dismiss(explicit)
      stream.session?.dismiss()
      sequence.current += 1
      inFlight.current = null
      idempotencyKeys.current.clear()
      setSuggestion(null)
      setError(null)
      setErrorFixTarget(null)
      setBusyUntil(null)
      setOffersTemplate(false)
      setActivity((current) => ({ ...current, isGenerating: false }))
    },
    [measurement, stream.session],
  )

  const adopt = useCallback(async () => {
    if (suggestion === null || isAdopting) return
    setActivity((current) => ({ ...current, isAdopting: true }))
    setError(null)
    setErrorFixTarget(null)
    try {
      await input.onAccept(suggestion.draft, suggestion.provenanceToken)
      input.onAdopt(suggestion.draft, suggestion.kind)
      measurement.adopt()
      stream.session?.dismiss()
      setSuggestion(null)
    } catch {
      setError('The suggested draft could not be saved. Try again.')
    } finally {
      setActivity((current) => ({ ...current, isAdopting: false }))
    }
  }, [input, isAdopting, suggestion, measurement, stream.session])

  return {
    restoreMeasurement: measurement.restore,
    tone,
    changeTone: (tone: ReplyTone) => chooseReplyTone(tone, setTone),
    stream,
    stop: () => {
      dismiss(false)
      setActivity((current) => ({ ...current, isGenerating: false }))
    },
    isGenerating,
    isWaiting: isDraftWaiting(Boolean(stream.session), isGenerating, stream.state),
    isAdopting,
    error,
    errorFixTarget,
    busyUntil,
    offersTemplate,
    suggestion,
    request,
    requestTemplate,
    retry: () => retryPendingReply(idempotencyKeys.current, request),
    requestAi: (tone?: ReplyTone, trigger?: Parameters<typeof request>[3]) =>
      request(tone, false, undefined, trigger),
    adopt,
    dismiss,
  }
}
