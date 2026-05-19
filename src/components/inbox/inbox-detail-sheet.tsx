// Inbox detail sheet — slide-over panel showing full inbox item detail
import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import {
  getInboxItemDetailFn,
  getInboxNotesFn,
  updateInboxStatusFn,
} from '#/contexts/inbox/server/inbox'
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
import type {
  InboxItem,
  InboxItemDetail,
  InboxNote,
} from '#/contexts/inbox/application/public-api'
import { getStatusActions } from './inbox-detail-helpers'
import { InboxStatusBadge } from './inbox-status-badge'

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  item: InboxItem | null
}>

export function InboxDetailSheet({ open, onOpenChange, item }: Props) {
  const [detail, setDetail] = useState<InboxItemDetail | null>(null)
  const [notes, setNotes] = useState<ReadonlyArray<InboxNote>>([])
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const abortRef = useRef(false)

  const detailAction = useAction(useServerFn(getInboxItemDetailFn))
  const notesAction = useAction(useServerFn(getInboxNotesFn))

  const loadDetail = useCallback(async () => {
    if (!item) return
    abortRef.current = false
    setIsLoadingDetail(true)
    try {
      const [detailResult, notesResult] = await Promise.all([
        detailAction({ data: { inboxItemId: item.id } }),
        notesAction({ data: { inboxItemId: item.id } }),
      ])
      if (!abortRef.current) {
        if (detailResult) setDetail(detailResult)
        if (notesResult) setNotes(notesResult)
      }
    } catch {
      // Error is on detailAction.error
    } finally {
      if (!abortRef.current) setIsLoadingDetail(false)
    }
  }, [item?.id])

  useEffect(() => {
    if (open && item) {
      loadDetail()
    } else {
      setDetail(null)
      setNotes([])
    }
    return () => {
      abortRef.current = true
    }
  }, [open, item?.id, loadDetail])

  const updateStatus = useMutationAction(updateInboxStatusFn, {
    successMessage: 'Status updated',
    onSuccess: () => {
      void loadDetail()
    },
  })

  const handleNoteAdded = useCallback(() => {
    void loadDetail()
  }, [loadDetail])

  if (!item) return null

  const currentItem = detail?.item ?? item
  const statusActions = getStatusActions(currentItem.status)

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

        {isLoadingDetail ? (
          <div className="space-y-4 p-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <InboxDetailContent
            currentItem={currentItem}
            detail={detail}
            statusActions={statusActions}
            updateStatus={updateStatus}
            notes={notes}
            onNoteAdded={handleNoteAdded}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
