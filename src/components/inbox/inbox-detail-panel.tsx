import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { InboxDetailContent } from '#/components/inbox/inbox-detail-content'
import { InboxDetailHeader } from '#/components/inbox/inbox-detail-header'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import type { ComposerFocusBox } from '#/components/inbox/inbox-detail-content'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { isCaseToolbarShown, type InboxCurrentUser } from './inbox-case-toolbar-props'
import type { InboxDetailFns } from './types'

type DetailState = ReturnType<typeof useInboxDetail>

interface InboxDetailPanelProps {
  selectedItem: InboxItem
  detailState: DetailState
  onClose: () => void
  detailFns: InboxDetailFns
  currentUser?: InboxCurrentUser
  assignmentOptions?: ReadonlyArray<InboxAssignmentOption>
  /** The page's `r` / `n` shortcuts, passed through to the composer. */
  composerFocusRef?: ComposerFocusBox
}

/**
 * The desktop pane: one bounded flex column, four regions, and only the third
 * one scrolls. `overflow-hidden` here and `CLIP_PANEL_CONTENT` on the Panel are
 * what stop the whole pane from scrolling; the header and the case toolbar carry
 * `shrink-0`, and so does the composer at the foot, so the thread's scroller is
 * the only region that gives up space.
 */
export function InboxDetailPanel({
  selectedItem,
  detailState,
  onClose,
  detailFns,
  currentUser,
  assignmentOptions,
  composerFocusRef,
}: InboxDetailPanelProps) {
  const currentItem = detailState.currentItem ?? selectedItem
  return (
    <div className="hidden md:flex h-full min-w-0 flex-col border-l overflow-hidden">
      {currentItem && (
        <InboxDetailHeader
          item={currentItem}
          detail={detailState.detail}
          onClose={onClose}
        />
      )}

      {/* The same predicate the `e` shortcut asks (`inbox-case-toolbar-props.ts`),
          so the key can never reach an Escalate this branch has not rendered.
          `!currentItem` only narrows the type for the content branch. */}
      {!isCaseToolbarShown(detailState) || !currentItem ? (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {detailState.error ? (
            <>
              <p className="text-sm text-destructive">{detailState.error}</p>
              <Button variant="outline" size="sm" onClick={() => detailState.refetch()}>
                Retry
              </Button>
            </>
          ) : (
            <>
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </>
          )}
        </div>
      ) : (
        <InboxDetailContent
          currentItem={currentItem}
          detail={detailState.detail}
          notes={detailState.notes}
          onNoteAdded={detailState.onNoteAdded}
          onReplyMutated={detailState.onReplyMutated}
          detailFns={detailFns}
          currentUser={currentUser}
          assignmentOptions={assignmentOptions}
          composerFocusRef={composerFocusRef}
          updateStatus={detailState.updateStatus}
          escalate={detailState.escalate}
          resolveEscalation={detailState.resolveEscalation}
          assign={detailState.assign}
          markFeedbackHandled={detailState.markFeedbackHandled}
          correctFeedbackHandlingOutcome={detailState.correctFeedbackHandlingOutcome}
        />
      )}
    </div>
  )
}
