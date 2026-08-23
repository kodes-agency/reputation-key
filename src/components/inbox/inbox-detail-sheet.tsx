// Inbox detail sheet — slide-over panel for mobile detail view
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
import type { InboxDetailState } from './use-inbox-detail'
import type { InboxDetailFns } from './types'
import { Button } from '#/components/ui/button'

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  item: InboxItem | null
  detailState: InboxDetailState
  detailFns: InboxDetailFns
}>

export function InboxDetailSheet({
  open,
  onOpenChange,
  item,
  detailState,
  detailFns,
}: Props) {
  if (!item) return null

  const currentItem = detailState.currentItem ?? item
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>
            {currentItem.sourceType === 'review' ? 'Review' : 'Feedback'} detail
          </SheetTitle>
          <SheetDescription className="sr-only">
            Detail view for inbox item {currentItem.id}
          </SheetDescription>
        </SheetHeader>
        <InboxDetailHeader
          item={currentItem}
          detail={detailState.detail}
          detailState={detailState}
          onClose={() => onOpenChange(false)}
        />

        {detailState.error ? (
          <div className="space-y-4 p-4">
            <p className="text-sm text-destructive">{detailState.error}</p>
            <Button variant="outline" size="sm" onClick={detailState.refetch}>
              Retry
            </Button>
          </div>
        ) : detailState.isLoading || !detailState.currentItem ? (
          <div className="space-y-4 p-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <InboxDetailContent
            currentItem={detailState.currentItem}
            detail={detailState.detail}
            notes={detailState.notes}
            onNoteAdded={detailState.onNoteAdded}
            onReplyMutated={detailState.onReplyMutated}
            detailFns={detailFns}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
