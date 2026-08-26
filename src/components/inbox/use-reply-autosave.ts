import { useEffect, useState } from 'react'
import {
  createReplyAutosaveCoordinator,
  type ReplyAutosaveStatus,
  type ReplyDraftSnapshot,
} from './reply-autosave-coordinator'

export type { ReplyAutosaveStatus, ReplyDraftSnapshot }

type SaveDraft = (
  snapshot: ReplyDraftSnapshot,
  provenanceToken?: string,
) => Promise<unknown>

export function useReplyAutosave(initial: ReplyDraftSnapshot, saveDraft: SaveDraft) {
  const [state, setState] = useState<{
    status: ReplyAutosaveStatus
    error: string | null
  }>({ status: 'idle', error: null })
  const [coordinator] = useState(() =>
    createReplyAutosaveCoordinator({
      initial,
      save: saveDraft,
      onState: setState,
    }),
  )

  useEffect(() => coordinator.setSave(saveDraft), [coordinator, saveDraft])
  useEffect(() => () => coordinator.dispose(), [coordinator])

  return {
    status: state.status,
    error: state.error,
    schedule: coordinator.schedule,
    flush: coordinator.flush,
    acceptAiDraft: coordinator.acceptAiDraft,
    retry: coordinator.retry,
  }
}
