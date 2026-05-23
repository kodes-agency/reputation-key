import { MessageSquare, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { InboxDetailContent } from '#/components/inbox/inbox-detail-content'
import { InboxStatusBadge } from '#/components/inbox/inbox-status-badge'
import { getStatusActions } from '#/components/inbox/inbox-detail-helpers'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { useInboxDetail } from '#/components/inbox/use-inbox-detail'

type DetailState = ReturnType<typeof useInboxDetail>

interface InboxDetailPanelProps {
  selectedItem: InboxItem
  detailState: DetailState
  onClose: () => void
}

export function InboxDetailPanel({
  selectedItem,
  detailState,
  onClose,
}: InboxDetailPanelProps) {
  const currentItem = detailState.currentItem ?? selectedItem
  const statusActions = currentItem ? getStatusActions(currentItem.status) : []

  return (
    <div className="hidden md:flex w-[480px] shrink-0 flex-col border-l">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          <span className="text-base font-medium">
            {currentItem?.sourceType === 'review' ? 'Review' : 'Feedback'} Detail
          </span>
          {currentItem && <InboxStatusBadge status={currentItem.status} />}
        </div>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {detailState.error ? (
          <div className="space-y-4 p-4">
            <p className="text-sm text-destructive">{detailState.error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void detailState.refresh()}
            >
              Retry
            </Button>
          </div>
        ) : detailState.isLoading || !currentItem ? (
          <div className="space-y-4 p-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <InboxDetailContent
            currentItem={currentItem}
            detail={detailState.detail}
            statusActions={statusActions}
            updateStatus={detailState.updateStatus}
            notes={detailState.notes}
            onNoteAdded={() => void detailState.refresh()}
          />
        )}
      </div>
    </div>
  )
}
