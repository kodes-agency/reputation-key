import type { ReplyDraftingStreamEvent } from '#/contexts/ai/server/reply-progress-stream.server'
import type {
  PendingReplyRequest,
  ReplySuggestionGenerate,
  ReplySuggestionResult,
} from './reply-suggestion-contract'
import type { DraftStream, DraftStreamRequest } from './reply-draft-stream'

export type DraftSessionSnapshot = Readonly<{
  reviewTextDigest: string | null
  options: DraftSessionOptions | null
  visible: boolean
  running: boolean
  slow: boolean
  progress: ReplyDraftingStreamEvent | null
  frame: Readonly<{ prefix: string; suffix: string }> | null
  sentences: readonly number[]
  result: ReplySuggestionResult | null
}>
const EMPTY: DraftSessionSnapshot = {
  options: null,
  reviewTextDigest: null,
  visible: false,
  running: false,
  slow: false,
  progress: null,
  frame: null,
  sentences: [],
  result: null,
}
export type DraftSessionOptions = Pick<
  DraftStreamRequest,
  'tone' | 'targetLanguage' | 'trigger' | 'length' | 'maxWords'
>

/**
 * Which assist request may still deliver its answer, and which owns the
 * spinner — two different questions.
 *
 * `sequence` is bumped by a new request, a dismissal and a release, because all
 * three retire a pending answer. The spinner cannot follow it: the textarea
 * stays enabled during generation, so typing dismisses a request that is still
 * running, and clearing the spinner only while `sequence` still matched left it
 * on for the life of the mount. Only a new request takes `generating`, and it
 * raises the flag itself, so its owner may always clear it. A click that joins
 * the request in flight takes nothing.
 */
export function createAssistRequests() {
  let sequence = 0
  let generating = 0
  let inFlight: { identity: string; promise: Promise<void> } | null = null
  const keys = new Map<string, PendingReplyRequest>()
  return {
    joined: (identity: string) =>
      inFlight?.identity === identity ? inFlight.promise : null,
    pending: (identity: string) => keys.get(identity),
    begin(identity: string, entry: PendingReplyRequest): number {
      sequence += 1
      generating = sequence
      keys.set(identity, entry)
      return sequence
    },
    track(identity: string, promise: Promise<void>) {
      inFlight = { identity, promise }
    },
    isCurrent: (token: number) => token === sequence,
    ownsSpinner: (token: number) => token === generating,
    forget: (identity: string) => keys.delete(identity),
    finish(identity: string) {
      if (inFlight?.identity === identity) inFlight = null
    },
    latest: () => Array.from(keys.values()).at(-1),
    /** Retire the pending answer and keep the keys. */
    retire() {
      sequence += 1
    },
    /** Retire the pending answer and forget every request. */
    reset() {
      sequence += 1
      inFlight = null
      keys.clear()
    },
  }
}
export type AssistRequests = ReturnType<typeof createAssistRequests>

/** One detail owns work and delivery across editor collapse and mode changes. */
export function createReplyDraftSession(
  reviewId: string,
  stream: DraftStream,
  sourceIdentity = reviewId,
) {
  let state = EMPTY
  let preparedAt: number | null = null
  let explicitRequested = false
  let variation = 0
  let replyRevision = 0
  const pendingKeys = new Map<string, string>()
  let controller: AbortController | null = null
  let active: {
    identity: string
    replyRevision: number
    promise: Promise<ReplySuggestionResult | null>
  } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<DraftSessionSnapshot>) => {
    state = { ...state, ...patch }
    for (const notify of listeners) notify()
  }
  const close = () => {
    controller?.abort()
    controller = null
    clearTimeout(timer)
    active = null
    pendingKeys.clear()
    preparedAt = null
  }
  const receive = (event: ReplyDraftingStreamEvent) => {
    if (event.step === 'done')
      publish({
        result: event.result,
        running: false,
        ...acceptedDraftFrame(event.result),
      })
    else if (event.step === 'refused')
      publish({
        result: {
          status: 'unavailable',
          code: event.reason as Extract<
            ReplySuggestionResult,
            { status: 'unavailable' }
          >['code'],
          retryAfterEpochMillis: event.retryAfterEpochMillis,
        },
        running: false,
        sentences: [],
      })
    else if (event.step === 'deferred') publish({ running: false })
    publish({
      progress: event,
      ...(event.step === 'reading'
        ? { reviewTextDigest: event.reviewTextDigest ?? null }
        : {}),
      ...(event.step === 'reading' && event.frame ? { frame: event.frame } : {}),
      ...(event.step === 'answering' ? { sentences: event.sentenceNumbers } : {}),
    })
  }
  const request = (
    options: DraftSessionOptions,
    background = false,
  ): Promise<ReplySuggestionResult | null> => {
    if (background && explicitRequested) return Promise.resolve(null)
    if (!background) explicitRequested = true
    if (options.trigger === 'try_again' && !isBusyRetry(state, options)) variation += 1
    const identity = JSON.stringify([
      sourceIdentity,
      options.tone,
      options.targetLanguage.kind,
      variation,
      options.maxWords,
      options.length,
      options.trigger,
    ])
    if (
      active &&
      active.replyRevision === replyRevision &&
      canJoinDraft(active.identity, identity, state, options)
    ) {
      if (!background) publish({ visible: true })
      return active.promise
    }
    const idempotencyKey = pendingKeys.get(identity) ?? crypto.randomUUID()
    const startedAt = preparedAt ?? Date.now()
    close()
    const owner = new AbortController()
    controller = owner
    publish({
      ...EMPTY,
      frame: state.frame,
      options,
      visible: !background,
      running: true,
      slow: Date.now() - startedAt >= 10_000,
    })
    timer = setTimeout(
      () => {
        if (!owner.signal.aborted) publish({ slow: true })
      },
      Math.max(0, 10_000 - (Date.now() - startedAt)),
    )
    pendingKeys.set(identity, idempotencyKey)
    const promise = stream(
      {
        ...options,
        reviewId,
        variation,
        idempotencyKey,
        intent: background ? 'background' : 'explicit',
      },
      owner.signal,
      (event) => {
        if (!owner.signal.aborted) receive(event)
      },
    )
      .then(() => {
        if (owner.signal.aborted) return null
        if (!state.result && state.progress?.step !== 'deferred')
          throw new Error('Draft stream ended without a result')
        return state.result
      })
      .catch(() => {
        if (owner.signal.aborted) return null
        const result: ReplySuggestionResult = {
          status: 'unavailable',
          code: 'provider_unavailable',
          retryAfterEpochMillis: null,
        }
        publish({ result, sentences: [] })
        return result
      })
      .finally(() => {
        if (!owner.signal.aborted) {
          clearTimeout(timer)
          publish({ running: false })
          const result = state.result
          if (result?.status !== 'unavailable' || result.code !== 'busy')
            pendingKeys.delete(identity)
          if (result?.status !== 'ready' && result?.status !== 'fallback') active = null
        }
      })
      .then((result) => {
        if (background && state.visible && !owner.signal.aborted && result === null)
          return request(options)
        return result
      })
    active = { identity, replyRevision, promise }
    return promise
  }
  const dismiss = () => {
    close()
    publish({ ...EMPTY, frame: state.frame })
  }
  const reveal = () => {
    explicitRequested = true
    preparedAt = Date.now()
    publish({ visible: true })
    if (!state.running) {
      clearTimeout(timer)
      timer = setTimeout(() => publish({ slow: true }), 10_000)
    }
  }
  return {
    assist: createAssistRequests(),
    /**
     * The generator the composer calls. The governed template is a separate
     * RPC and stays injected; every other request is this session's stream.
     */
    generate(legacy: ReplySuggestionGenerate | undefined): ReplySuggestionGenerate {
      return async (
        tone,
        targetLanguage,
        templateOnly,
        key,
        trigger = 'draft',
        options,
      ) => {
        if (templateOnly) {
          dismiss()
          reveal()
          return legacy
            ? legacy(tone, targetLanguage, true, key, trigger)
            : {
                status: 'unavailable',
                code: 'target_language_unavailable',
                retryAfterEpochMillis: null,
              }
        }
        const result = await request({ tone, targetLanguage, trigger, ...options })
        return (
          result ?? {
            status: 'unavailable',
            code: 'source_changed',
            retryAfterEpochMillis: null,
          }
        )
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    request,
    reveal,
    seedFrame(frame: DraftSessionSnapshot['frame']) {
      if (!state.frame && frame) publish({ frame })
    },
    dismiss,
    stop: dismiss,
    replyEdited() {
      replyRevision += 1
      explicitRequested = true
      dismiss()
    },
    dispose: close,
  }
}
export type ReplyDraftSession = ReturnType<typeof createReplyDraftSession>

/** Match sentence numbers to exactly the original text the server read. */
export async function draftReviewTextDigest(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function expiredDraft(result: ReplySuggestionResult | null): boolean {
  return result?.status === 'ready' && result.expiresAtEpochMillis <= Date.now()
}
function acceptedDraftFrame(
  result: ReplySuggestionResult,
): Partial<DraftSessionSnapshot> {
  return result.status === 'ready' && result.localFrame
    ? { frame: result.localFrame }
    : {}
}

export const BACKGROUND_DRAFT_DWELL_MILLIS = 2_000
export function scheduleBackgroundDraft(
  session: ReplyDraftSession,
  targetLanguage: DraftSessionOptions['targetLanguage'],
) {
  const timer = setTimeout(() => {
    void session.request({ tone: 'professional', targetLanguage, trigger: 'draft' }, true)
  }, BACKGROUND_DRAFT_DWELL_MILLIS)
  return () => clearTimeout(timer)
}

export function isDraftWaiting(
  hasSession: boolean,
  generating: boolean,
  state: DraftSessionSnapshot,
): boolean {
  return hasSession && (generating || (state.visible && state.running))
}

function isBusyRetry(
  state: DraftSessionSnapshot,
  requested: DraftSessionOptions,
): boolean {
  const previous = state.options
  return (
    state.result?.status === 'unavailable' &&
    state.result.code === 'busy' &&
    previous !== null &&
    previous.tone === requested.tone &&
    previous.targetLanguage.kind === requested.targetLanguage.kind &&
    previous.trigger === requested.trigger &&
    previous.maxWords === requested.maxWords
  )
}

function sameDraftScope(
  previous: DraftSessionOptions | null,
  next: DraftSessionOptions,
): boolean {
  return (
    previous !== null &&
    previous.tone === next.tone &&
    previous.targetLanguage.kind === next.targetLanguage.kind &&
    previous.length === next.length &&
    previous.maxWords === next.maxWords
  )
}

function canJoinDraft(
  activeIdentity: string,
  identity: string,
  state: DraftSessionSnapshot,
  options: DraftSessionOptions,
): boolean {
  const same =
    activeIdentity === identity ||
    (options.trigger === 'draft' && sameDraftScope(state.options, options))
  return (
    same && !expiredDraft(state.result) && (options.trigger === 'draft' || state.running)
  )
}
