// Inbox detail sheet — slide-over panel showing full inbox item detail
import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import {
  getInboxItemDetailFn,
  updateInboxStatusFn,
} from '#/contexts/inbox/server/inbox'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '#/components/ui/sheet'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { InboxStatusBadge } from './inbox-status-badge'
import { InboxNotesThread } from './inbox-notes-thread'
import {
  Star,
  MessageSquare,
  AlertTriangle,
  Archive,
  CheckCircle,
  Eye,
} from 'lucide-react'
import type { InboxItem, InboxItemDetail, InboxNote, InboxStatus } from '#/contexts/inbox/application/public-api'

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  item: InboxItem | null
  organizationId: string
  userId: string
}>

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(typeof date === 'string' ? new Date(date) : date)
}

// Status transition buttons — which actions are available per status
function getStatusActions(status: InboxStatus): Array<{
  label: string
  targetStatus: InboxStatus
  icon: React.ReactNode
  variant: 'default' | 'outline' | 'secondary' | 'destructive'
}> {
  switch (status) {
    case 'new':
      return [
        { label: 'Mark Read', targetStatus: 'read', icon: <Eye className="size-3.5" />, variant: 'outline' },
        { label: 'Escalate', targetStatus: 'escalated', icon: <AlertTriangle className="size-3.5" />, variant: 'destructive' },
      ]
    case 'read':
      return [
        { label: 'Mark Addressed', targetStatus: 'addressed', icon: <CheckCircle className="size-3.5" />, variant: 'default' },
        { label: 'Escalate', targetStatus: 'escalated', icon: <AlertTriangle className="size-3.5" />, variant: 'destructive' },
      ]
    case 'addressed':
      return [
        { label: 'Archive', targetStatus: 'archived', icon: <Archive className="size-3.5" />, variant: 'secondary' },
      ]
    case 'escalated':
      return [
        { label: 'Mark Addressed', targetStatus: 'addressed', icon: <CheckCircle className="size-3.5" />, variant: 'default' },
        { label: 'Archive', targetStatus: 'archived', icon: <Archive className="size-3.5" />, variant: 'secondary' },
      ]
    case 'archived':
      return [
        { label: 'Reopen', targetStatus: 'read', icon: <Eye className="size-3.5" />, variant: 'outline' },
      ]
  }
}

function RatingStars({ rating }: Readonly<{ rating: number | null }>) {
  if (rating === null) return null
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`size-4 ${
            i < rating
              ? 'fill-yellow-400 text-yellow-400'
              : 'text-muted-foreground/30'
          }`}
        />
      ))}
      <span className="ml-1 text-sm font-medium">{rating}/5</span>
    </div>
  )
}

export function InboxDetailSheet({
  open,
  onOpenChange,
  item,
  organizationId,
  userId,
}: Props) {
  const [detail, setDetail] = useState<InboxItemDetail | null>(null)
  const [notes, setNotes] = useState<ReadonlyArray<InboxNote>>([])
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const abortRef = useRef(false)

  // Load detail when item changes
  const detailAction = useAction(useServerFn(getInboxItemDetailFn))

  const loadDetail = useCallback(async () => {
    if (!item) return
    abortRef.current = false
    setIsLoadingDetail(true)
    try {
      const result = await detailAction({
        data: {
          inboxItemId: item.id,
          organizationId,
        },
      })
      if (!abortRef.current && result) {
        setDetail(result as InboxItemDetail)
        // If the result includes notes, extract them
        if ('notes' in result && Array.isArray((result as Record<string, unknown>).notes)) {
          setNotes((result as Record<string, unknown>).notes as InboxNote[])
        }
      }
    } catch {
      // Error is on detailAction.error
    } finally {
      if (!abortRef.current) {
        setIsLoadingDetail(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, organizationId])

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
  }, [open, item?.id, organizationId, loadDetail])

  // Status update mutation
  const updateStatus = useMutationAction(updateInboxStatusFn, {
    successMessage: 'Status updated',
    onSuccess: () => {
      void loadDetail()
    },
  })

  // Reload detail after a note is added (to pick up any server-side changes)
  const handleNoteAdded = useCallback(() => {
    void loadDetail()
  }, [loadDetail])

  if (!item) return null

  // Use the detail's item if available (more up-to-date), else the passed item
  const currentItem = detail?.item ?? item
  const statusActions = getStatusActions(currentItem.status)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg"
      >
        {/* Header */}
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
          <div className="flex flex-col gap-6 p-4">
            {/* Source info */}
            {currentItem.sourceType === 'review' && detail && (
              <div className="space-y-3">
                {/* Reviewer info */}
                {detail.reviewerName && (
                  <div className="flex items-center gap-3">
                    {detail.reviewerProfilePhotoUrl ? (
                      <img
                        src={detail.reviewerProfilePhotoUrl}
                        alt={detail.reviewerName}
                        className="size-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                        <span className="text-sm font-medium">
                          {detail.reviewerName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium">{detail.reviewerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(currentItem.sourceDate)}
                      </p>
                    </div>
                  </div>
                )}

                {/* Rating */}
                <RatingStars rating={currentItem.rating} />

                {/* Review text */}
                {detail.reviewText && (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {detail.reviewText}
                    </p>
                  </div>
                )}
              </div>
            )}

            {currentItem.sourceType === 'feedback' && detail && (
              <div className="space-y-3">
                {/* Feedback rating */}
                {detail.feedbackRatingValue !== null && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Rating:</span>
                    <span className="text-sm font-medium">{detail.feedbackRatingValue}</span>
                  </div>
                )}

                {/* Feedback comment */}
                {detail.feedbackComment && (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {detail.feedbackComment}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Snippet fallback (when no detail loaded) */}
            {!detail && currentItem.snippet && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-sm">{currentItem.snippet}</p>
              </div>
            )}

            {/* Platform badge */}
            {currentItem.platform && (
              <div>
                <Badge variant="outline" className="capitalize">
                  {currentItem.platform}
                </Badge>
              </div>
            )}

            {/* Metadata */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Source date: {formatDate(currentItem.sourceDate)}</span>
              {currentItem.readAt && <span>Read: {formatDate(currentItem.readAt)}</span>}
              {currentItem.escalatedAt && <span>Escalated: {formatDate(currentItem.escalatedAt)}</span>}
              {currentItem.addressedAt && <span>Addressed: {formatDate(currentItem.addressedAt)}</span>}
            </div>

            {/* Status actions */}
            {statusActions.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                {statusActions.map((action) => (
                  <Button
                    key={action.targetStatus}
                    variant={action.variant}
                    size="sm"
                    disabled={updateStatus.isPending}
                    onClick={() => {
                      updateStatus({
                        data: {
                          inboxItemId: currentItem.id,
                          status: action.targetStatus,
                          organizationId,
                          userId,
                        },
                      })
                    }}
                  >
                    {action.icon}
                    {action.label}
                  </Button>
                ))}
              </div>
            )}

            {/* Notes thread */}
            <div className="border-t pt-4">
              <InboxNotesThread
                notes={notes}
                inboxItemId={currentItem.id}
                organizationId={organizationId}
                userId={userId}
                onNoteAdded={handleNoteAdded}
              />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
