import { MessageSquare, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { InboxDetailContent } from '#/components/inbox/inbox-detail-content'
import { InboxStatusBadge } from '#/components/inbox/inbox-status-badge'
import { getStatusActions } from '#/components/inbox/inbox-detail-helpers'
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
  const statusActions = currentItem
    ? getStatusActions(currentItem.status, currentItem.sourceType)
    : []

  return (
    <div className="hidden md:flex h-full min-w-0 flex-col border-l overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold truncate">
              {currentItem?.propertyName ?? '<PropertyName>'}
            </span>
            {currentItem?.platform && (
              <span className="text-xs text-muted-foreground shrink-0">
                · {currentItem.platform}
              </span>
            )}
          </div>
          {currentItem && <InboxStatusBadge status={currentItem.status} />}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close detail"
          className="size-8 shrink-0"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
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
            statusVersion={detailState.statusVersion}
            detailFns={detailFns}
          />
        )}
      </div>
    </div>
  )
}
