// Inbox detail content — extracted for max-lines compliance
//
// NOTE: updateInboxStatusFn imported below for type-only use (typeof in props).
// The actual mutation is wrapped by the use-inbox-detail hook, not called here.

import { Button } from '#/components/ui/button'
import { InboxNotesThread } from './inbox-notes-thread'
import { ReplyEditor } from './reply-editor'
import { formatDateTime } from './utils'
import { getStatusActions } from './inbox-detail-helpers'
import { InboxDetailSourceContent } from './inbox-detail-source-content'
import { InboxActivityTimeline } from './inbox-activity-timeline'
import { updateInboxStatusFn } from '#/contexts/inbox/server/inbox'
import { usePermissions } from '#/shared/hooks/usePermissions'
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
  const { can } = usePermissions()
  const canManageReplies = can('reply.manage')
  return (
    <div className="flex flex-col gap-6 p-4">
      <InboxDetailSourceContent currentItem={currentItem} detail={detail} />

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>
          {currentItem.sourceType === 'review' ? 'Reviewed' : 'Submitted'}:{' '}
          {formatDateTime(currentItem.sourceDate)}
        </span>
        {currentItem.readAt && <span>Opened: {formatDateTime(currentItem.readAt)}</span>}
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

      {currentItem.sourceType === 'review' && canManageReplies && (
        <ReplyEditor reviewId={currentItem.sourceId} />
      )}

      <InboxActivityTimeline inboxItemId={currentItem.id} />

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
