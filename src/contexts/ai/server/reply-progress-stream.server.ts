import type { GenerateReplySuggestionResult } from '../application/public-api'
import { getLogger } from '#/shared/observability/logger'
import type {
  ReplyDraftingProgress,
  ReplyDraftingProgressSink,
} from '#/shared/reply-drafting-progress'

type Delivered = Extract<GenerateReplySuggestionResult, { status: 'ready' | 'fallback' }>
type Event =
  | ReplyDraftingProgress
  | Readonly<{ step: 'done'; result: Delivered }>
  | Readonly<{ step: 'refused'; reason: string; retryAfterEpochMillis: number | null }>
  | Readonly<{ step: 'deferred'; retryAfterEpochMillis: number | null }>
export type ReplyDraftingStreamEvent = Readonly<{ sequence: number }> & Event

/** A browser owns delivery only. Cancellation never aborts/restarts provider work. */
export function replyProgressResponse(
  run: (sink: ReplyDraftingProgressSink) => Promise<GenerateReplySuggestionResult>,
  intent: 'explicit' | 'background',
  browserSignal?: AbortSignal,
): Response {
  let connected = !browserSignal?.aborted
  let sequence = 0
  let lastStep = -1
  let rewritten = false
  const startedAt = performance.now()
  let outcome: 'done' | 'refused' | 'deferred' | 'cancelled' = 'cancelled'
  const encoder = new TextEncoder()
  let responseController: ReadableStreamDefaultController<Uint8Array> | undefined
  const detach = () => {
    connected = false
    try {
      responseController?.close()
    } catch {
      /* Already cancelled/closed. */
    }
  }
  browserSignal?.addEventListener('abort', detach, { once: true })
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      responseController = controller
      if (!connected) detach()
      const send = (event: Event) => {
        if (!connected) return
        try {
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ ...event, sequence: ++sequence })}\n`),
          )
        } catch {
          detach()
        }
      }
      const progress: ReplyDraftingProgressSink = (event) => {
        if (event.step === 'rewording') {
          if (rewritten || lastStep < 0) return
          rewritten = true
          lastStep = 0
          send({ step: 'rewording', ordinal: 1 })
          return
        }
        const step = ['reading', 'thinking', 'answering', 'writing', 'checking'].indexOf(
          event.step,
        )
        if (step <= lastStep) return
        lastStep = step
        send(progressEvent(event))
      }
      void Promise.resolve()
        .then(() => run(progress))
        .then(
          (result) => {
            const event = terminalEvent(result, intent)
            send(event)
            if (connected) outcome = event.step
          },
          (error: unknown) => {
            const event = failedEvent(error, intent)
            send(event)
            if (connected) outcome = event.step
          },
        )
        .finally(() => {
          browserSignal?.removeEventListener('abort', detach)
          detach()
          getLogger().info(
            {
              event: outcome,
              contract: 'reply-suggestion-v2',
              intent,
              durationMs: Math.round(performance.now() - startedAt),
              rewrite: rewritten,
            },
            'Reply drafting stream outcome',
          )
        })
    },
    cancel: detach,
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Accel-Buffering': 'no',
    },
  })
}

type TerminalEvent = Exclude<Event, ReplyDraftingProgress>

function failedEvent(error: unknown, intent: 'explicit' | 'background'): TerminalEvent {
  getLogger().error(
    {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode:
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : null,
    },
    'Reply drafting stream failed',
  )
  return intent === 'background'
    ? { step: 'deferred', retryAfterEpochMillis: null }
    : { step: 'refused', reason: 'provider_unavailable', retryAfterEpochMillis: null }
}

function terminalEvent(
  result: GenerateReplySuggestionResult,
  intent: 'explicit' | 'background',
): TerminalEvent {
  if (result.status === 'ready' || result.status === 'fallback')
    return { step: 'done', result }
  const retryAfterEpochMillis =
    'retryAfterEpochMillis' in result ? result.retryAfterEpochMillis : null
  if (intent === 'background') return { step: 'deferred', retryAfterEpochMillis }
  return {
    step: 'refused',
    reason: result.status === 'unavailable' ? result.code : 'policy_unavailable',
    retryAfterEpochMillis,
  }
}

function progressEvent(event: ReplyDraftingProgress): ReplyDraftingProgress {
  if (event.step === 'reading')
    return {
      step: 'reading',
      ...(event.reviewTextDigest ? { reviewTextDigest: event.reviewTextDigest } : {}),
      ...(event.frame
        ? { frame: { prefix: event.frame.prefix, suffix: event.frame.suffix } }
        : {}),
    }
  if (event.step === 'answering')
    return { step: 'answering', sentenceNumbers: [...event.sentenceNumbers] }
  if (event.step === 'rewording') return { step: 'rewording', ordinal: 1 }
  return { step: event.step }
}
