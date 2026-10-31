import { useEffect, useRef } from 'react'
import type {
  PendingReplySuggestion,
  ReplySuggestionResult,
} from './reply-suggestion-contract'
import {
  useReplyDraftSession,
  useDraftSessionSnapshot,
} from './reply-draft-session-context'
import type { ReplySuggestionGenerate } from './reply-suggestion-contract'

/** Keep the governed template RPC and older standalone callers available. */
export function useStreamedReplyDraft(legacy: ReplySuggestionGenerate | undefined) {
  const context = useReplyDraftSession()
  const session = context?.session
  const state = useDraftSessionSnapshot(session)
  const generate: ReplySuggestionGenerate | undefined = session
    ? async (tone, targetLanguage, templateOnly, key, trigger = 'draft', options) => {
        if (templateOnly) {
          session.stop()
          session.reveal()
          return legacy
            ? legacy(tone, targetLanguage, true, key, trigger)
            : {
                status: 'unavailable',
                code: 'target_language_unavailable',
                retryAfterEpochMillis: null,
              }
        }
        const result = await session.request({
          tone,
          targetLanguage,
          trigger,
          ...options,
        })
        return (
          result ?? {
            status: 'unavailable',
            code: 'source_changed',
            retryAfterEpochMillis: null,
          }
        )
      }
    : legacy
  return { session, state, generate, initialTone: state.options?.tone ?? 'professional' }
}

/** Restore a detail-owned draft when its editor mounts again, without another generation. */
export function useRestoreStreamedReplyDraft({
  stream,
  isGenerating,
  suggestion,
  restore,
  retire,
}: Readonly<{
  stream: ReturnType<typeof useStreamedReplyDraft>
  isGenerating: boolean
  suggestion: PendingReplySuggestion | null
  retire: () => void
  restore: (
    result: Extract<ReplySuggestionResult, { status: 'ready' | 'fallback' }>,
    options: import('./reply-draft-session').DraftSessionOptions,
  ) => void
}>) {
  const restoredResult = useRef<ReplySuggestionResult | null>(null)
  useEffect(() => {
    if (stream.session && !stream.state.visible) {
      if (suggestion || isGenerating) retire()
      return
    }
    const result = stream.state.result
    if (
      !stream.session ||
      !stream.state.visible ||
      !result ||
      isGenerating ||
      suggestion ||
      restoredResult.current === result
    )
      return
    restoredResult.current = result
    if (result.status === 'ready' && result.expiresAtEpochMillis <= Date.now()) {
      stream.session.dismiss()
      return
    }
    if (result.status === 'ready' || result.status === 'fallback') {
      const options = stream.state.options
      if (options) restore(result, options)
    }
  }, [stream, isGenerating, suggestion, restore, retire])
}
