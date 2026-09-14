import { useCallback, useEffect, useState } from 'react'
import type {
  InboxItem,
  InboxItemDetailResult,
} from '#/contexts/inbox/application/public-api'
import type { ComposerMode } from './reply-composer'
import type { CaretRequest, ReopenState, ReplyEditState } from './composer-policy'
import { liveEditTarget } from './composer-policy'
import type { ReplyEditTarget, resolveReplyView } from './reply-status-view'
import type { ThreadReplyActions } from './inbox-thread'
import type { ReplyActions } from './use-reply-actions'

export type ComposerFocusBox = { current: ((mode: ComposerMode) => void) | null }

type ReplyKind = ReturnType<typeof resolveReplyView>['kind']

function scopedReplyEdit(itemId: InboxItem['id'], edit: ReplyEditState): ReplyEditState {
  return edit.itemId === itemId ? edit : { itemId, target: null, reopen: 'idle' }
}

function useComposerFocusRegistration(
  composerFocusRef: ComposerFocusBox | undefined,
  focusComposer: (mode: ComposerMode) => void,
): void {
  useEffect(() => {
    if (!composerFocusRef) return
    composerFocusRef.current = focusComposer
    return () => {
      if (composerFocusRef.current === focusComposer) composerFocusRef.current = null
    }
  }, [composerFocusRef, focusComposer])
}

export function useInboxComposerController({
  itemId,
  modes,
  reply,
  replyKind,
  replyActions,
  composerFocusRef,
}: Readonly<{
  itemId: InboxItem['id']
  modes: readonly ComposerMode[]
  reply: InboxItemDetailResult['reply'] | null
  replyKind: ReplyKind
  replyActions: ReplyActions
  composerFocusRef: ComposerFocusBox | undefined
}>) {
  const [replyEdit, setReplyEdit] = useState<ReplyEditState>({
    itemId,
    target: null,
    reopen: 'idle',
  })
  const [mode, setMode] = useState<ComposerMode>('reply')
  const [caret, setCaret] = useState<CaretRequest>({ itemId, mode: 'reply', seq: 0 })
  const edit = scopedReplyEdit(itemId, replyEdit)
  const editTarget = liveEditTarget(replyKind, edit.target)
  const setEdit = useCallback(
    (target: ReplyEditTarget, reopen: ReopenState = 'idle') =>
      setReplyEdit({ itemId, target, reopen }),
    [itemId],
  )
  const focusComposer = useCallback(
    (next: ComposerMode) => {
      if (!modes.includes(next)) return
      if (editTarget !== null && next !== 'reply') return
      setMode(next)
      setCaret((previous) => ({ itemId, mode: next, seq: previous.seq + 1 }))
    },
    [editTarget, itemId, modes],
  )
  const caretFor = useCallback(
    (surface: ComposerMode) =>
      caret.itemId === itemId && caret.mode === surface ? caret.seq : 0,
    [caret, itemId],
  )
  useComposerFocusRegistration(composerFocusRef, focusComposer)

  const reopenRejectedReply = useCallback(() => {
    if (!reply || reply.kind === 'google_observation') return
    setEdit(null, 'pending')
    void replyActions
      .saveDraft(reply.text, undefined, reply.replyLanguageTag ?? undefined)
      .then(() => {
        setEdit(null)
        focusComposer('reply')
      })
      .catch(() => setEdit(null, 'failed'))
  }, [focusComposer, reply, replyActions, setEdit])

  const threadReplyActions: ThreadReplyActions = {
    isSaving: replyActions.isSaving || edit.reopen === 'pending',
    isEditing: editTarget !== null,
    onApprove: replyActions.approve,
    onReject: replyActions.reject,
    onCheck: replyActions.check,
    onRetry: replyActions.retry,
    onEditPublished: () => {
      setEdit('published')
      focusComposer('reply')
    },
    onEditRejected: reopenRejectedReply,
  }

  return {
    mode,
    setMode,
    edit,
    editTarget,
    setEdit,
    focusComposer,
    caretFor,
    threadReplyActions,
  }
}
