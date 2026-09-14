import type { ComponentProps, Dispatch, ReactNode, SetStateAction } from 'react'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNoteView,
} from '#/contexts/inbox/application/public-api'
import { hasPendingComposerWork } from './composer-policy'
import type { NoteDraft, ReopenState } from './composer-policy'
import { InboxNotesThread } from './inbox-notes-thread'
import { InboxThread } from './inbox-thread'
import type { ThreadReplyActions } from './inbox-thread'
import { reviewLanguageReadiness } from './reply-language-options'
import { ReplyComposer } from './reply-composer'
import type { ComposerMode } from './reply-composer'
import { ReplyEditor } from './reply-form'
import { resolveReplyView } from './reply-status-view'
import type { ReplyEditTarget } from './reply-status-view'
import type { InboxDetailFns } from './types'
import type { ReplyActions } from './use-reply-actions'

export function DetailThreadRegion({
  currentItem,
  detail,
  notes,
  currentUserId,
  getInboxItemHistory,
  replyActions,
  reopen,
}: Readonly<{
  currentItem: InboxItem
  detail: InboxItemDetailResult | null
  notes: ReadonlyArray<InboxNoteView>
  currentUserId: string | undefined
  getInboxItemHistory: InboxDetailFns['getInboxItemHistory']
  replyActions: ThreadReplyActions
  reopen: ReopenState
}>): ReactNode {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex min-w-0 flex-col gap-6 p-5 lg:p-6">
        <InboxThread
          item={currentItem}
          detail={detail}
          notes={notes}
          currentUserId={currentUserId}
          getInboxItemHistory={getInboxItemHistory}
          replyActions={replyActions}
        />
        {reopen === 'failed' ? (
          <p role="alert" className="text-xs text-destructive">
            The rejected reply could not be reopened.
          </p>
        ) : null}
      </div>
    </div>
  )
}

type DetailComposerSharedProps = Readonly<{
  currentItem: InboxItem
  detail: InboxItemDetailResult | null
  detailFns: InboxDetailFns
  editTarget: ReplyEditTarget
  replyActions: ReplyActions
  noteDraft: NoteDraft
  setNoteDraft: Dispatch<SetStateAction<NoteDraft>>
  onNoteAdded: (resultingCommandRevision: number) => void
  addInboxNote: ComponentProps<typeof InboxNotesThread>['addInboxNote']
  canAddNotes: boolean
  handlingAction: 'mark' | 'correct' | null
  caretFor: (mode: ComposerMode) => number
  onEditDone: () => void
}>

function detailReplySlot(
  props: DetailComposerSharedProps,
  showReplyEditor: boolean,
): ReactNode {
  if (!showReplyEditor) return null
  const { currentItem, detail, detailFns, editTarget, replyActions, caretFor } = props
  return (
    <ReplyEditor
      key={currentItem.id}
      propertyId={currentItem.propertyId}
      reviewId={currentItem.sourceId}
      reply={detail?.reply ?? null}
      loading={!detail}
      propertyDefaultReplyLanguage={detail?.propertyDefaultReplyLanguage ?? null}
      reviewReplyLanguage={detail?.reviewReplyLanguage ?? null}
      reviewLanguageReadiness={reviewLanguageReadiness(detail?.reviewText)}
      editTarget={editTarget}
      caretRequest={caretFor('reply')}
      actions={replyActions}
      onEditDone={props.onEditDone}
      generateReplySuggestion={detailFns.generateReplySuggestion}
    />
  )
}

function detailNoteSlot(props: DetailComposerSharedProps): ReactNode {
  const {
    currentItem,
    onNoteAdded,
    addInboxNote,
    canAddNotes,
    noteDraft,
    setNoteDraft,
    caretFor,
    handlingAction,
  } = props
  return (
    <InboxNotesThread
      key={currentItem.id}
      inboxItemId={currentItem.id}
      expectedCommandRevision={currentItem.commandRevision}
      onNoteAdded={onNoteAdded}
      addInboxNote={addInboxNote}
      canAdd={canAddNotes}
      draftText={noteDraft.itemId === currentItem.id ? noteDraft.text : ''}
      onDraftChange={(text) =>
        setNoteDraft((previous) =>
          text === '' && previous.itemId !== currentItem.id
            ? previous
            : { itemId: currentItem.id, text },
        )
      }
      caretRequest={caretFor('note')}
      submitVariant={handlingAction === 'correct' ? 'outline' : 'default'}
    />
  )
}

export function DetailComposerRegion({
  currentItem,
  detail,
  detailFns,
  modes,
  mode,
  setMode,
  editTarget,
  reopen,
  replyView,
  replyActions,
  noteDraft,
  setNoteDraft,
  onNoteAdded,
  addInboxNote,
  canAddNotes,
  handlingAction,
  feedbackPrimary,
  focusComposer,
  caretFor,
  onEditDone,
}: DetailComposerSharedProps &
  Readonly<{
    modes: readonly ComposerMode[]
    mode: ComposerMode
    setMode: Dispatch<SetStateAction<ComposerMode>>
    reopen: ReopenState
    replyView: ReturnType<typeof resolveReplyView>
    feedbackPrimary: ReactNode
    focusComposer: (mode: ComposerMode) => void
  }>): ReactNode {
  if (modes.length === 0) return null
  const showReplyEditor = replyView.kind === 'compose' || editTarget !== null
  const sharedProps: DetailComposerSharedProps = {
    currentItem,
    detail,
    detailFns,
    editTarget,
    replyActions,
    noteDraft,
    setNoteDraft,
    onNoteAdded,
    addInboxNote,
    canAddNotes,
    handlingAction,
    caretFor,
    onEditDone,
  }

  return (
    <ReplyComposer
      mode={mode}
      onModeChange={setMode}
      modes={modes}
      hideUnavailableModesOnMobile={
        replyView.kind === 'mirror' || replyView.kind === 'published'
      }
      editTarget={editTarget}
      collapse={{
        itemId: currentItem.id,
        hasPendingWork: hasPendingComposerWork({
          itemId: currentItem.id,
          replyView,
          noteDraft,
          reopen,
        }),
        onExpand: focusComposer,
      }}
      replySlot={detailReplySlot(sharedProps, showReplyEditor)}
      noteSlot={detailNoteSlot(sharedProps)}
      singleModePrimarySlot={feedbackPrimary}
    />
  )
}
