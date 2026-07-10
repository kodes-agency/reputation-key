// Inbox detail — reply editor component.
// Receives the reply as a prop (folded into getInboxItemDetail) — the client no
// longer calls review.getReply. Per src/components/CONTEXT.md:55, server fns are
// passed as props; the reply mutations still come from server/ (5+ mutations).
import { useState, useCallback } from 'react'
import { ReplyEditorInner } from './reply-form'
import type { ReplyData } from './reply-form'

export type ReplyEditorProps = Readonly<{
  reviewId: string
  /** Reply from the detail payload (getInboxItemDetail); null if none / Staff. */
  initialReply: ReplyData | null
  loading: boolean
  /** Propagates reply mutations up so the owner can sync its cache. */
  onReplyChanged?: (reply: ReplyData | null) => void
}>

export function ReplyEditor({
  reviewId,
  initialReply,
  loading,
  onReplyChanged,
}: ReplyEditorProps) {
  const [reply, setReply] = useState<ReplyData | null>(initialReply)
  const handleChange = useCallback(
    (r: ReplyData | null) => {
      setReply(r)
      onReplyChanged?.(r)
    },
    [onReplyChanged],
  )
  return (
    <ReplyEditorInner
      reviewId={reviewId}
      reply={reply}
      loading={loading}
      onReplyChanged={handleChange}
    />
  )
}
