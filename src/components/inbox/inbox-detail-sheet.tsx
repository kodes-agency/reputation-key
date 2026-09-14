// Inbox detail sheet — the mobile surface for the four-region detail pane.
//
// `InboxPageV2` mounts this on its mobile branch and nowhere else: below `md`
// the three-panel `Group` is not rendered at all, and the desktop
// `InboxDetailPanel` is `hidden md:flex`. There is no second instance — PR 6
// deleted the permanently-closed one `InboxDetailPane` used to carry.
import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '#/components/ui/sheet'
import { Skeleton } from '#/components/ui/skeleton'
import { InboxDetailContent } from './inbox-detail-content'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { InboxDetailHeader } from './inbox-detail-header'
import type { ComposerFocusBox } from './inbox-detail-content'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { isCaseToolbarShown, type InboxCurrentUser } from './inbox-case-toolbar-props'
import type { InboxDetailState } from './use-inbox-detail'
import type { InboxDetailFns } from './types'
import { Button } from '#/components/ui/button'

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  item: InboxItem | null
  detailState: InboxDetailState
  detailFns: InboxDetailFns
  currentUser?: InboxCurrentUser
  assignmentOptions?: ReadonlyArray<InboxAssignmentOption>
  /**
   * Threaded for symmetry with the desktop panel. The shortcuts that read it
   * are inert on mobile (`handleInboxShortcut` returns early), and this surface
   * and the desktop panel are never mounted at the same time, so whichever one
   * is mounted registers and the other cannot overwrite it.
   */
  composerFocusRef?: ComposerFocusBox
}>

export function InboxDetailSheet({
  open,
  onOpenChange,
  item,
  detailState,
  detailFns,
  currentUser,
  assignmentOptions,
  composerFocusRef,
}: Props) {
  // The sheet is dismissed by dropping `itemId` from the search, so `item` goes
  // null in the SAME commit that turns `open` false. Returning null on `item`
  // alone tore the Radix dialog out of the tree while it was still open: the
  // `data-[state=closed]` slide-out had nothing left to play on, so a sheet
  // covering the whole phone blinked out of existence instead of leaving. Hold
  // the last one — the exit is the only thing it is still needed for, and a
  // reopen overwrites it before anything renders.
  //
  // State, not a ref, and adjusted during render rather than in an effect:
  // React's documented "adjusting state when a prop changes" pattern. A ref
  // cannot do this job — `react-hooks/refs` refuses both the write and the
  // read, and rightly: the exit frame IS a render that has to see the old
  // item, which is the one thing a ref is not allowed to feed. An effect is
  // too late, because the null render has already been committed by then.
  // The `!==` guard is what bounds it: React re-runs this component
  // immediately without committing, the guard is then false, and the second
  // pass is the one that paints.
  const [lastItem, setLastItem] = useState(item)
  if (item !== null && item !== lastItem) setLastItem(item)
  const shownItem = item ?? lastItem
  if (shownItem === null) return null

  const currentItem = detailState.currentItem ?? shownItem
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Region 1 and region 2 are pinned, region 3 scrolls, region 4 is pinned
          and bounded — the same four regions as the desktop panel, and this is
          the first PR to measure them HERE rather than infer them from there.
          The primitive supplies `fixed inset-y-0 h-full flex flex-col`; `w-full`
          and `gap-0` beat its `w-3/4` and `gap-4` through `twMerge`, and
          `overflow-hidden` replaces the scroller this element used to be.

          v1 measured (pre-toolbar, 44 px controls) at 390x844/320x900/320x568:
          header 0→56, strip 56→101 (44 px of content, its own row), thread
          101→region top and the only element with vertical scroll range, region
          pinned flush to the column's bottom edge (gap 0) in all three. The
          column's own `scrollHeight === clientHeight` everywhere, so nothing
          double-scrolls, and `document.scrollWidth` never exceeds the viewport.
          At 768 px every `max-md:` treatment switches back off, which is how
          the desktop density survives a shared header. */}
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-lg"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>
            {currentItem.sourceType === 'review' ? 'Review' : 'Feedback'} detail
          </SheetTitle>
          <SheetDescription className="sr-only">
            Detail view for inbox item {currentItem.id}
          </SheetDescription>
        </SheetHeader>
        {/* `showCloseButton={false}` drops the primitive's own corner X, and
            below `sm` the sheet is `w-full` — there is no overlay left to tap
            and no Escape key on a phone, so this control is the whole exit.
            `back`, not `close`: the row that opened this pushed a history entry
            (`inbox-state-helpers.ts:28`), so leaving is going back to the list,
            and the arrow sits at the leading edge where the list's own drawer
            trigger is. Nothing here is ever named exactly `Close`. */}
        <InboxDetailHeader
          item={currentItem}
          detail={detailState.detail}
          dismiss="back"
          onClose={() => onOpenChange(false)}
        />

        {/* The `e` shortcut's own predicate (`inbox-case-toolbar-props.ts`); the
            null check only narrows the type for the content branch. */}
        {!isCaseToolbarShown(detailState) || !detailState.currentItem ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {detailState.error ? (
              <>
                <p className="text-sm text-destructive">{detailState.error}</p>
                {/* A CONTROL, so row 20's 36 px: `max-md:h-9` over `size="sm"`'s
                    32. v1's row 15 had raised it to 44 (`max-md:h-11`); row 20
                    lowered every pane control to 36 because WCAG 2.5.8 AA asks
                    for 24 and 44 is what inflated the phone pane. This surface
                    only ever renders below `md`, but the breakpoint is kept so
                    the class reads the same as every other control in the pane.
                    Measured in Chromium against Storybook dev at 390
                    (`inbox-detail-sheet--error-state`): 44 px tall before, 36
                    after. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="max-md:h-9"
                  onClick={detailState.refetch}
                >
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
            currentItem={detailState.currentItem}
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
      </SheetContent>
    </Sheet>
  )
}
