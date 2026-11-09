import {
  createAssistRequests,
  isDraftWaiting,
  type AssistRequests,
} from './reply-draft-session'
import {
  useReplyDraftSession,
  useDraftSessionSnapshot,
  useRestoreDraftSession,
} from './reply-draft-session-context'
import { createDraftMeasurementSession, measuredDraftSnapshot } from './reply-measurement'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReplyDraftSnapshot } from './use-reply-autosave'
import {
  isReplySuggestionVerifiable,
  retryPendingReply,
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

function pendingSuggestion(
  result: Extract<ReplySuggestionResult, { status: 'ready' | 'fallback' }>,
  draft: ReplyDraftSnapshot,
): PendingReplySuggestion {
  if (result.status === 'ready') {
    return { draft, kind: 'personalized', provenanceToken: result.provenanceToken }
  }
  return {
    draft,
    kind: 'local_fallback',
    provenanceToken: null,
    reason: result.reason,
    languageSource: result.languageSource,
  }
}

type AssistTrigger = 'draft' | 'try_again' | 'shorter' | 'tone'
type AssistLength = Readonly<{ length: 'short'; maxWords: number }>

type AssistHooks = Readonly<{
  input: Input
  assist: AssistRequests
  generate: ReplySuggestionGenerate | undefined
  measurement: ReturnType<typeof createDraftMeasurementSession>
  showResult: AssistRun['showResult']
  showRefusal: AssistRun['showRefusal']
  showFailure: () => void
  endSpinner: () => void
  /** Called once a request is accepted, before it runs. */
  onStart: (tone: ReplyTone) => void
}>

type AssistParams = Readonly<{
  requestedTone: ReplyTone
  templateOnly: boolean
  scope: ReplyAssistScope | undefined
  explicitTrigger: AssistTrigger | undefined
  options: AssistLength | undefined
}>

function startAssist(hooks: AssistHooks, params: AssistParams): Promise<void> {
  const { input, assist, generate, measurement, onStart, ...rest } = hooks
  const { requestedTone, templateOnly, scope, explicitTrigger, options } = params
  const target = scope ? scope.target : input.target
  if (!generate || !target) return Promise.resolve()
  const identity = requestIdentity(
    requestedTone,
    target,
    templateOnly,
    explicitTrigger,
    options?.maxWords,
  )
  // A repeated click while the same draft is being written joins it
  // instead of racing it: the later answer would otherwise win.
  const joined = assist.joined(identity)
  if (joined) return joined
  const pending = assist.pending(identity)
  const trigger = measurement.request(
    requestedTone,
    pending?.trigger ?? explicitTrigger,
    templateOnly,
  )
  const idempotencyKey = pending?.key ?? crypto.randomUUID()
  const requestSequence = assist.begin(identity, {
    key: idempotencyKey,
    trigger,
    args: [requestedTone, templateOnly, scope, explicitTrigger, options],
  })
  const baseRevision = input.revision.current
  const baseDraft = scope ? scope.draft : input.draft
  onStart(requestedTone)
  const promise = runAssist({
    ...rest,
    input,
    assist,
    generate,
    measurement,
    identity,
    requestSequence,
    idempotencyKey,
    trigger,
    baseRevision,
    baseDraft,
    target,
    requestedTone,
    templateOnly,
    options,
  })
  assist.track(identity, promise)
  return promise
}

type AssistRun = Readonly<{
  input: Input
  assist: AssistRequests
  generate: ReplySuggestionGenerate
  measurement: ReturnType<typeof createDraftMeasurementSession>
  identity: string
  requestSequence: number
  idempotencyKey: string
  trigger: ReturnType<ReturnType<typeof createDraftMeasurementSession>['request']>
  baseRevision: number
  baseDraft: ReplyDraftSnapshot
  target: ReplyLanguageTarget
  requestedTone: ReplyTone
  templateOnly: boolean
  options: Readonly<{ length: 'short'; maxWords: number }> | undefined
  showResult: (
    result: Extract<ReplySuggestionResult, { status: 'ready' | 'fallback' }>,
    baseDraft: ReplyDraftSnapshot,
    target: ReplyLanguageTarget,
  ) => void
  showRefusal: (
    result: Extract<ReplySuggestionResult, { status: 'unavailable' }>,
    templateOnly: boolean,
  ) => void
  showFailure: () => void
  endSpinner: () => void
}>

async function runAssist(deps: AssistRun): Promise<void> {
  const {
    input,
    assist,
    generate,
    measurement,
    identity,
    requestSequence,
    idempotencyKey,
    trigger,
    baseRevision,
    baseDraft,
    target,
    requestedTone,
    templateOnly,
    options,
    showResult,
    showRefusal,
    showFailure,
    endSpinner,
  } = deps
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
      assist.forget(identity)
      return
    }
    if (!assist.isCurrent(requestSequence)) return
    const result = await generate(
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
      assist.forget(identity)
    }
    if (!assist.isCurrent(requestSequence) || baseRevision !== input.revision.current)
      return measurement.discard(result)
    if (result.status === 'unavailable') return showRefusal(result, templateOnly)
    showResult(result, baseDraft, target)
  } catch {
    assist.forget(identity)
    // Typing or dismissal retires thrown failures as well as returned refusals.
    if (assist.isCurrent(requestSequence)) {
      showFailure()
    }
  } finally {
    assist.finish(identity)
    if (assist.ownsSpinner(requestSequence)) endSpinner()
  }
}

type AssistOutcome = Readonly<{
  error: string | null
  errorFixTarget: ReplySuggestionFixTarget | null
  /** Set when our own AI capacity is busy; the retry time the server gave. */
  busyUntil: number | null
  /** The last refusal leaves the governed template as a sound, explicit choice. */
  offersTemplate: boolean
}>

const NO_OUTCOME: AssistOutcome = {
  error: null,
  errorFixTarget: null,
  busyUntil: null,
  offersTemplate: false,
}

/** What the composer says about the last request that did not produce a draft. */
function useAssistOutcome() {
  const [outcome, setOutcome] = useState(NO_OUTCOME)
  const setError = useCallback(
    (error: string) => setOutcome((current) => ({ ...current, error })),
    [],
  )
  const clearError = useCallback(
    () => setOutcome((current) => ({ ...current, error: null, errorFixTarget: null })),
    [],
  )
  const clearOutcome = useCallback(() => setOutcome(NO_OUTCOME), [])
  const showRefusal = useCallback(
    (
      result: Extract<ReplySuggestionResult, { status: 'unavailable' }>,
      templateOnly: boolean,
    ) =>
      setOutcome({
        error: replySuggestionUnavailableMessage(result.code),
        errorFixTarget: replySuggestionFixTarget(result.code),
        offersTemplate: !templateOnly && replySuggestionOffersTemplate(result.code),
        busyUntil: result.code === 'busy' ? (result.retryAfterEpochMillis ?? null) : null,
      }),
    [],
  )
  return { outcome, setError, clearError, clearOutcome, showRefusal }
}

function useDraftMeasurement(input: Input, assist: AssistRequests) {
  const [measurement] = useState(() =>
    createDraftMeasurementSession(
      input.onMeasure,
      input.initialMeasurementGenerationId,
      input.initialMeasurementBaseReplyRevision,
    ),
  )
  useEffect(() => measurement.setEmitter(input.onMeasure), [measurement, input.onMeasure])
  useEffect(() => {
    const detach = measurement.attach()
    return () => {
      assist.reset()
      detach()
    }
  }, [measurement, assist])
  return measurement
}

export function useReplySuggestion(input: Input) {
  const session = useReplyDraftSession()?.session
  const draftState = useDraftSessionSnapshot(session)
  const [localAssist] = useState(createAssistRequests)
  const assist = session?.assist ?? localAssist
  const { onGenerate: legacyGenerate } = input
  const generate = useMemo(
    () => (session ? session.generate(legacyGenerate) : legacyGenerate),
    [session, legacyGenerate],
  )
  const stream = useMemo(() => ({ session, state: draftState }), [session, draftState])
  const [tone, setTone] = useState<ReplyTone>(draftState.options?.tone ?? 'professional')
  const [{ isGenerating, isAdopting }, setActivity] = useState({
    isGenerating: false,
    isAdopting: false,
  })
  const [suggestion, setSuggestion] = useState<PendingReplySuggestion | null>(null)
  const { outcome, setError, clearError, clearOutcome, showRefusal } = useAssistOutcome()
  const measurement = useDraftMeasurement(input, assist)

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
      setSuggestion(pendingSuggestion(result, nextDraft))
    },
    [measurement, setError],
  )

  const request = useCallback(
    (
      requestedTone: ReplyTone = tone,
      templateOnly = false,
      scope?: ReplyAssistScope,
      explicitTrigger?: AssistTrigger,
      options?: AssistLength,
    ): Promise<void> =>
      startAssist(
        {
          input,
          assist,
          generate,
          measurement,
          showResult,
          showRefusal,
          onStart: (startedTone) => {
            setTone(startedTone)
            session?.reveal()
            setActivity((current) => ({ ...current, isGenerating: true }))
            setSuggestion(null)
            clearOutcome()
          },
          showFailure: () =>
            setError('The draft suggestion could not be generated. Try again.'),
          endSpinner: () =>
            setActivity((current) => ({ ...current, isGenerating: false })),
        },
        { requestedTone, templateOnly, scope, explicitTrigger, options },
      ),
    [
      input,
      tone,
      measurement,
      session,
      generate,
      assist,
      showResult,
      showRefusal,
      clearOutcome,
      setError,
    ],
  )

  useRestoreDraftSession({
    session,
    state: draftState,
    isBusy: isGenerating || suggestion !== null,
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
      assist.retire()
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
      session?.dismiss()
      assist.reset()
      setSuggestion(null)
      clearOutcome()
      setActivity((current) => ({ ...current, isGenerating: false }))
    },
    [measurement, session, assist, clearOutcome],
  )

  const adopt = useCallback(async () => {
    if (suggestion === null || isAdopting) return
    setActivity((current) => ({ ...current, isAdopting: true }))
    clearError()
    try {
      await input.onAccept(suggestion.draft, suggestion.provenanceToken)
      input.onAdopt(suggestion.draft, suggestion.kind)
      measurement.adopt()
      session?.dismiss()
      setSuggestion(null)
    } catch {
      setError('The suggested draft could not be saved. Try again.')
    } finally {
      setActivity((current) => ({ ...current, isAdopting: false }))
    }
  }, [input, isAdopting, suggestion, measurement, session, clearError, setError])

  return {
    restoreMeasurement: measurement.restore,
    tone,
    changeTone: (tone: ReplyTone) => setTone(tone),
    stream,
    stop: () => {
      dismiss(false)
      setActivity((current) => ({ ...current, isGenerating: false }))
    },
    isGenerating,
    isWaiting: isDraftWaiting(Boolean(session), isGenerating, draftState),
    isAdopting,
    error: outcome.error,
    errorFixTarget: outcome.errorFixTarget,
    busyUntil: outcome.busyUntil,
    offersTemplate: outcome.offersTemplate,
    suggestion,
    request,
    requestTemplate,
    retry: () => retryPendingReply(assist.latest(), request),
    requestAi: (tone?: ReplyTone, trigger?: Parameters<typeof request>[3]) =>
      request(tone, false, undefined, trigger),
    adopt,
    dismiss,
  }
}
