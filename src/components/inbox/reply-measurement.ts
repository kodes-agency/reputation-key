/** Unicode scalar characters after NFC and whitespace normalization. Never persisted. */
export function normalizedDraftEditDistance(baseline: string, submitted: string): number {
  const characters = (text: string) =>
    Array.from(text.normalize('NFC').replace(/\s+/gu, ' ').trim())
  const a = characters(baseline)
  const b = characters(submitted)
  const denominator = Math.max(a.length, b.length)
  if (denominator === 0) return 0
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + Number(a[i - 1] !== b[j - 1]),
      )
    }
    previous = current
  }
  return previous[b.length]! / denominator
}
export type BrowserDraftEditMetric = Readonly<{
  generationId: string | null
  distance: number | null
}>

import type { DraftMeasurementEvent } from '#/shared/domain/draft-measurement'
import type { ReplyDraftSnapshot } from './reply-autosave-coordinator'
import type { ReplySuggestionResult } from './reply-suggestion-contract'

type Identity = Omit<DraftMeasurementEvent, 'event'>
type Emit = ((event: DraftMeasurementEvent) => void) | undefined

/** A compose session owns preview and adopted identities independently of visible copy. */
export function createDraftMeasurementSession(
  initialEmit?: Emit,
  generationId?: string | null,
  baseReplyRevision?: number | null,
) {
  let emit = initialEmit
  let preview: Identity | null = null
  const adopted = new Set(generationId && baseReplyRevision != null ? [generationId] : [])
  let previousTone = 'professional'
  let requested = Boolean(generationId)
  let mountVersion = 0
  let pressed: 'draft' | 'try_again' | 'tone' = 'draft'
  const record = (identity: Identity | null, event: DraftMeasurementEvent['event']) => {
    if (identity && !(event === 'superseded' && adopted.has(identity.generationId)))
      emit?.({ ...identity, event })
  }
  const leave = () => {
    record(preview, 'superseded')
  }
  return {
    attach() {
      const version = ++mountVersion
      return () =>
        queueMicrotask(() => {
          if (version === mountVersion) leave()
        })
    },
    setEmitter(next: Emit) {
      emit = next
    },
    request(
      tone: string,
      explicitTrigger?: 'draft' | 'try_again' | 'tone',
      templateOnly = false,
    ) {
      if (templateOnly) return 'draft'

      const trigger =
        explicitTrigger ??
        (requested ? (tone !== previousTone ? 'tone' : 'try_again') : 'draft')
      pressed = trigger
      previousTone = tone
      requested = true
      return trigger
    },
    discard(result: ReplySuggestionResult) {
      if (result.status === 'ready' && result.measurementGenerationId)
        record(
          {
            generationId: result.measurementGenerationId,
            baseReplyRevision: result.baseReplyStateRevision,
          },
          'superseded',
        )
    },
    show(result: ReplySuggestionResult) {
      record(preview, 'superseded')
      preview =
        result.status === 'ready' && result.measurementGenerationId
          ? {
              generationId: result.measurementGenerationId,
              baseReplyRevision: result.baseReplyStateRevision,
            }
          : null
      record(preview, 'shown')
      record(preview, pressed)
    },
    adopt() {
      if (preview) adopted.add(preview.generationId)
      preview = null
    },
    dismiss(explicit: boolean) {
      record(preview, explicit ? 'dismissed' : 'superseded')
      preview = null
    },
    restore(snapshot: ReplyDraftSnapshot) {
      if (snapshot.measurementGenerationId) adopted.add(snapshot.measurementGenerationId)
    },
    leave,
  }
}

export function measuredDraftSnapshot(
  result: ReplySuggestionResult,
  draft: ReplyDraftSnapshot,
): ReplyDraftSnapshot {
  if (result.status === 'ready' && result.measurementGenerationId)
    return {
      ...draft,
      measurementBaseReplyRevision: result.baseReplyStateRevision,
      measurementGenerationId: result.measurementGenerationId,
      measurementBaseline: result.replyText,
    }
  return { ...draft, measurementGenerationId: null }
}

export function draftEditMetric(
  draft: ReplyDraftSnapshot,
): BrowserDraftEditMetric | undefined {
  if (draft.measurementGenerationId === undefined) return undefined
  if (draft.measurementGenerationId === null)
    return { generationId: null, distance: null }
  return {
    generationId: draft.measurementGenerationId,
    distance:
      draft.measurementBaseline === undefined
        ? null
        : normalizedDraftEditDistance(draft.measurementBaseline, draft.text),
  }
}

export function restoredMeasurementSnapshot(
  draft: ReplyDraftSnapshot,
): ReplyDraftSnapshot {
  return { ...draft, measurementGenerationId: draft.measurementGenerationId ?? null }
}
