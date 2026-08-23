import { Lock, MessageSquare } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { InboxActivityTimeline } from './inbox-activity-timeline'
import { InboxDetailSourceContent } from './inbox-detail-source-content'
import { InboxNotesThread } from './inbox-notes-thread'
import { InboxReviewAnalysisPanel } from './inbox-review-analysis'
import { ReplyEditor } from './reply-editor'
import type { InboxDetailFns } from './types'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNote,
} from '#/contexts/inbox/application/public-api'

export type DetailContentProps = Readonly<{
  currentItem: InboxItem
  detail: InboxItemDetailResult | null
  notes: ReadonlyArray<InboxNote>
  onNoteAdded: () => void
  onReplyMutated: (reply: InboxItemDetailResult['reply']) => void
  detailFns: InboxDetailFns
}>

export function InboxDetailContent({
  currentItem,
  detail,
  notes,
  onNoteAdded,
  onReplyMutated,
  detailFns,
}: DetailContentProps) {
  const { can } = usePermissions()
  const canManageReplies = can('reply.manage')
  const canAddNotes = can('inbox.write')
  const notesThread = (
    <InboxNotesThread
      notes={notes}
      inboxItemId={currentItem.id}
      onNoteAdded={onNoteAdded}
      addInboxNote={detailFns.addInboxNote}
      canAdd={canAddNotes}
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

      {currentItem.sourceType === 'review' && canManageReplies ? (
        <Tabs
          defaultValue="reply"
          className="relative border-t pt-5 lg:[&_[data-slot=reply-language]]:absolute lg:[&_[data-slot=reply-language]]:right-0 lg:[&_[data-slot=reply-language]]:top-5 lg:[&_[data-slot=reply-language]]:max-w-[55%]"
        >
          <TabsList variant="line" className="mb-4 lg:mr-[22rem] lg:mb-10">
            <TabsTrigger value="reply">
              <MessageSquare /> Public reply
            </TabsTrigger>
            <TabsTrigger value="note">
              <Lock /> Internal note
            </TabsTrigger>
          </TabsList>
          <TabsContent value="reply">
            <ReplyEditor
              key={currentItem.id}
              reviewId={currentItem.sourceId}
              initialReply={detail?.reply ?? null}
              loading={!detail}
              propertyDefaultReplyLanguage={detail?.propertyDefaultReplyLanguage ?? null}
              reviewReplyLanguage={detail?.reviewReplyLanguage ?? null}
              onReplyChanged={onReplyMutated}
              generateReplySuggestion={detailFns.generateReplySuggestion}
            />
          </TabsContent>
          <TabsContent value="note">{notesThread}</TabsContent>
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
