import { useQueryClient } from '@tanstack/react-query'
import { Lock, MessageSquare } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { InboxActivityTimeline } from './inbox-activity-timeline'
import { InboxDetailSourceContent } from './inbox-detail-source-content'
import { InboxNotesThread } from './inbox-notes-thread'
import { InboxReviewAnalysisPanel } from './inbox-review-analysis'
import { ReplyEditor } from './reply-editor'
import { ReplyToolbarProvider, ReplyToolbarSlot } from './reply-toolbar-slot'
import { FeedbackHandlingCard } from './feedback-handling-card'
import { ResponseTargetCard } from './response-target-card'
import type { InboxDetailState } from './use-inbox-detail'
import { withFreshCommandRevision } from './use-inbox-detail-queries'
import type { InboxReplyCacheChange } from './inbox-cache-policy'
import type { InboxDetailFns } from './types'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNoteView,
} from '#/contexts/inbox/application/public-api'

export type DetailContentProps = Readonly<{
  currentItem: InboxItem
  detail: InboxItemDetailResult | null
  notes: ReadonlyArray<InboxNoteView>
  onNoteAdded: (resultingCommandRevision: number) => void
  onReplyMutated: (change: InboxReplyCacheChange) => void
  detailFns: InboxDetailFns
  currentUserId?: string
  markFeedbackHandled: InboxDetailState['markFeedbackHandled']
  correctFeedbackHandlingOutcome: InboxDetailState['correctFeedbackHandlingOutcome']
}>

export function InboxDetailContent({
  currentItem,
  detail,
  notes,
  onNoteAdded,
  onReplyMutated,
  detailFns,
  currentUserId,
  markFeedbackHandled,
  correctFeedbackHandlingOutcome,
}: DetailContentProps) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const canManageReplies = can('reply.manage')
  const canAddNotes = can('inbox.write')
  const notesThread = (
    <InboxNotesThread
      notes={notes}
      inboxItemId={currentItem.id}
      expectedCommandRevision={currentItem.commandRevision}
      recoverConflict={withFreshCommandRevision(
        queryClient,
        currentItem.id,
        detailFns.getInboxItemDetail,
      )}
      onNoteAdded={onNoteAdded}
      addInboxNote={detailFns.addInboxNote}
      canAdd={canAddNotes}
      currentUserId={currentUserId}
    />
  )

  return (
    <div className="flex min-w-0 flex-col gap-6 p-5 lg:p-6">
      <InboxDetailSourceContent
        currentItem={currentItem}
        detail={detail}
        reviewReplyLanguage={detail?.reviewReplyLanguage}
      />
      {currentItem.sourceType === 'review' && (
        <InboxReviewAnalysisPanel analysis={detail?.analysis ?? null} />
      )}
      {detail?.responseTarget ? (
        <ResponseTargetCard target={detail.responseTarget} />
      ) : null}
      {currentItem.sourceType === 'feedback' && detail?.feedbackHandling ? (
        <FeedbackHandlingCard
          item={currentItem}
          state={detail.feedbackHandling}
          markFeedbackHandled={markFeedbackHandled}
          correctFeedbackHandlingOutcome={correctFeedbackHandlingOutcome}
        />
      ) : null}

      {currentItem.sourceType === 'review' && canManageReplies ? (
        <Tabs
          defaultValue="reply"
          className="@container/reply-workspace gap-0 border-t pt-5"
        >
          <ReplyToolbarProvider>
            <div className="grid min-w-0 grid-cols-1 items-center gap-3 @min-[38rem]/reply-workspace:grid-cols-[minmax(0,1fr)_auto] @min-[38rem]/reply-workspace:gap-x-6">
              <TabsList
                variant="line"
                className="gap-5 p-0 group-data-[orientation=horizontal]/tabs:h-10"
              >
                <TabsTrigger
                  value="reply"
                  className="h-10 flex-none gap-2 rounded-none px-1 after:bottom-0 after:bg-primary data-[state=active]:font-semibold [&_svg:not([class*='size-'])]:size-[18px]"
                >
                  <MessageSquare /> Public reply
                </TabsTrigger>
                <TabsTrigger
                  value="note"
                  className="h-10 flex-none gap-2 rounded-none px-1 after:bottom-0 after:bg-primary data-[state=active]:font-semibold [&_svg:not([class*='size-'])]:size-[18px]"
                >
                  <Lock /> Internal note
                </TabsTrigger>
              </TabsList>
              <ReplyToolbarSlot className="min-w-0 @min-[38rem]/reply-workspace:justify-self-end" />
            </div>
            <TabsContent value="reply" className="mt-5">
              <ReplyEditor
                key={currentItem.id}
                propertyId={currentItem.propertyId}
                reviewId={currentItem.sourceId}
                initialReply={detail?.reply ?? null}
                loading={!detail}
                propertyDefaultReplyLanguage={
                  detail?.propertyDefaultReplyLanguage ?? null
                }
                reviewReplyLanguage={detail?.reviewReplyLanguage ?? null}
                canDetectReviewLanguage={Boolean(detail?.reviewText?.trim())}
                onReplyChanged={onReplyMutated}
                generateReplySuggestion={detailFns.generateReplySuggestion}
              />
            </TabsContent>
            <TabsContent value="note" className="mt-5">
              {notesThread}
            </TabsContent>
          </ReplyToolbarProvider>
        </Tabs>
      ) : (
        <div className="border-t pt-4">{notesThread}</div>
      )}

      <InboxActivityTimeline
        inboxItemId={currentItem.id}
        getActivityTimeline={detailFns.getActivityTimeline}
      />
    </div>
  )
}
