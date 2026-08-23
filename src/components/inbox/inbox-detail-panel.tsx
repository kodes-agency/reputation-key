import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { InboxDetailContent } from '#/components/inbox/inbox-detail-content'
import { InboxDetailHeader } from '#/components/inbox/inbox-detail-header'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { useInboxDetail } from '#/components/inbox/use-inbox-detail'
import type { InboxDetailFns } from './types'

type DetailState = ReturnType<typeof useInboxDetail>

interface InboxDetailPanelProps {
  selectedItem: InboxItem
  detailState: DetailState
  onClose: () => void
  detailFns: InboxDetailFns
}

export function InboxDetailPanel({
  selectedItem,
  detailState,
  onClose,
  detailFns,
}: InboxDetailPanelProps) {
  const currentItem = detailState.currentItem ?? selectedItem
  return (
    <div className="hidden md:flex h-full min-w-0 flex-col border-l overflow-hidden">
      {currentItem && (
        <InboxDetailHeader
          item={currentItem}
          detail={detailState.detail}
          detailState={detailState}
          onClose={onClose}
        />
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {detailState.error ? (
          <div className="space-y-4 p-4">
            <p className="text-sm text-destructive">{detailState.error}</p>
            <Button variant="outline" size="sm" onClick={() => detailState.refetch()}>
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
            notes={detailState.notes}
            onNoteAdded={detailState.onNoteAdded}
            onReplyMutated={detailState.onReplyMutated}
            detailFns={detailFns}
          />
        )}
      </div>
    </div>
  )
}
