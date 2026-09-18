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
import { INBOX_SCROLL_REGION } from './use-inbox-keyboard-shortcuts'

export function DetailThreadRegion({
  currentItem,
  detail,
  notes,
  notesUnavailable,
  currentUserId,
  getInboxItemHistory,
  replyActions,
  reopen,
}: Readonly<{
  currentItem: InboxItem
  detail: InboxItemDetailResult | null
  notes: ReadonlyArray<InboxNoteView>
  notesUnavailable: boolean
  currentUserId: string | undefined
  getInboxItemHistory: InboxDetailFns['getInboxItemHistory']
  replyActions: ThreadReplyActions
  reopen: ReopenState
}>): ReactNode {
  // Region 3, named and reachable by keyboard.
  // `tabIndex={0}` because a scrollport whose content holds nothing focusable
  // cannot be scrolled from the keyboard at all (axe
  // `scrollable-region-focusable`, serious). That is not a hypothetical here: a
  // review with no translation disclosure, no drawn history, no notes and no
  // reply renders only headings, prose and badges — the `ReviewOnly` story is
  // exactly it — and a long review was then unreadable without a pointer.
  // `<section aria-label>` for the same reason region 2 carries one
  // (`inbox-case-toolbar.tsx`): naming the conversation and the composer is what
  // lets a reader move between reading the case and writing into it.
  // `INBOX_SCROLL_REGION` hands the arrow keys to this scroller: without it the
  // page's list shortcut claimed them, and ArrowDown opened the next case
  // instead of scrolling this one.
  // The focus indicator is an INSET outline: the scroller runs edge to edge
  // inside a column that clips, so a ring drawn outside it would be cut off,
  // and an outline (not a box-shadow ring) survives forced colours.
  return (
    <section
      aria-label="Conversation"
      tabIndex={0}
      {...{ [INBOX_SCROLL_REGION]: '' }}
      className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <div className="flex min-w-0 flex-col gap-6 p-5 lg:p-6">
        <InboxThread
          item={currentItem}
          detail={detail}
          notes={notes}
          notesUnavailable={notesUnavailable}
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
    </section>
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
