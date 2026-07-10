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
import { MessageSquare } from 'lucide-react'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { getStatusActions } from './inbox-detail-helpers'
import { InboxStatusBadge } from './inbox-status-badge'
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
  const statusActions = getStatusActions(currentItem.status, currentItem.sourceType)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader className="border-b pb-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-muted-foreground" />
            <SheetTitle className="text-base">
              {currentItem.sourceType === 'review' ? 'Review' : 'Feedback'} Detail
            </SheetTitle>
            <InboxStatusBadge status={currentItem.status} />
          </div>
          <SheetDescription className="sr-only">
            Detail view for inbox item {currentItem.id}
          </SheetDescription>
        </SheetHeader>

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
            statusActions={statusActions}
            updateStatus={detailState.updateStatus}
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
