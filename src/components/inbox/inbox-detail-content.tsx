// Inbox detail content — extracted for max-lines compliance
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { InboxNotesThread } from './inbox-notes-thread'
import { formatDateTime } from './utils'
import { getStatusActions, RatingStars } from './inbox-detail-helpers'
import { updateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import type {
  InboxItem,
  InboxItemDetail,
  InboxNote,
} from '#/contexts/inbox/application/public-api'
import type { useMutationAction } from '#/components/hooks/use-mutation-action'

export type DetailContentProps = Readonly<{
  currentItem: InboxItem
  detail: InboxItemDetail | null
  statusActions: ReturnType<typeof getStatusActions>
  updateStatus: ReturnType<typeof useMutationAction<typeof updateInboxStatusFn>>
  notes: ReadonlyArray<InboxNote>
  onNoteAdded: () => void
}>

export function InboxDetailContent({
  currentItem,
  detail,
  statusActions,
  updateStatus,
  notes,
  onNoteAdded,
}: DetailContentProps) {
  return (
    <div className="flex flex-col gap-6 p-4">
      {currentItem.sourceType === 'review' && detail && (
        <div className="space-y-3">
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
                  {formatDateTime(currentItem.sourceDate)}
                </p>
              </div>
            </div>
          )}
          <RatingStars rating={currentItem.rating} />
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
          {detail.feedbackRatingValue !== null && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rating:</span>
              <span className="text-sm font-medium">{detail.feedbackRatingValue}</span>
            </div>
          )}
          {detail.feedbackComment && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {detail.feedbackComment}
              </p>
            </div>
          )}
        </div>
      )}

      {!detail && currentItem.snippet && (
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-sm">{currentItem.snippet}</p>
        </div>
      )}

      {currentItem.platform && (
        <div>
          <Badge variant="outline" className="capitalize">
            {currentItem.platform}
          </Badge>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>Source date: {formatDateTime(currentItem.sourceDate)}</span>
        {currentItem.readAt && <span>Read: {formatDateTime(currentItem.readAt)}</span>}
        {currentItem.escalatedAt && (
          <span>Escalated: {formatDateTime(currentItem.escalatedAt)}</span>
        )}
        {currentItem.addressedAt && (
          <span>Addressed: {formatDateTime(currentItem.addressedAt)}</span>
        )}
      </div>

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
                    status: action.targetStatus as
                      | 'read'
                      | 'addressed'
                      | 'escalated'
                      | 'archived',
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

      <div className="border-t pt-4">
        <InboxNotesThread
          notes={notes}
          inboxItemId={currentItem.id}
          onNoteAdded={onNoteAdded}
        />
      </div>
    </div>
  )
}
