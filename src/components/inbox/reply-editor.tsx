// Inbox detail — reply editor component.
// Receives the reply as a prop (folded into getInboxItemDetail) — the client no
// longer calls review.getReply. Per src/components/CONTEXT.md:55, server fns are
// passed as props; the reply mutations still come from server/ (5+ mutations).
import { ReplyEditorInner } from './reply-form'
import type { ReplyData } from './reply-form'
import type { generateReplySuggestionFn } from '#/contexts/ai/server/reply-suggestion'

export type ReplyEditorProps = Readonly<{
  propertyId: string
  reviewId: string
  /** Reply from the detail payload (getInboxItemDetail); null if none / Staff. */
  initialReply: ReplyData | null
  loading: boolean
  propertyDefaultReplyLanguage: string | null
  reviewReplyLanguage: string | null
  canDetectReviewLanguage: boolean
  /** Propagates reply mutations up so the owner can sync its cache. */
  onReplyChanged?: (reply: ReplyData | null) => void
  generateReplySuggestion?: typeof generateReplySuggestionFn
}>

export function ReplyEditor({
  propertyId,
  reviewId,
  initialReply,
  loading,
  propertyDefaultReplyLanguage,
  reviewReplyLanguage,
  canDetectReviewLanguage,
  onReplyChanged,
  generateReplySuggestion,
}: ReplyEditorProps) {
  return (
    <ReplyEditorInner
      propertyId={propertyId}
      reviewId={reviewId}
      reply={initialReply}
      loading={loading}
      propertyDefaultReplyLanguage={propertyDefaultReplyLanguage}
      reviewReplyLanguage={reviewReplyLanguage}
      canDetectReviewLanguage={canDetectReviewLanguage}
      onReplyChanged={(reply) => onReplyChanged?.(reply)}
      generateReplySuggestion={generateReplySuggestion}
    />
  )
}
