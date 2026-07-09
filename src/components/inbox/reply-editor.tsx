// Inbox detail — reply editor component.
// Receives the reply as a prop (folded into getInboxItemDetail) — the client no
// longer calls review.getReply. Per src/components/CONTEXT.md:55, server fns are
// passed as props; the reply mutations still come from server/ (5+ mutations).
import { useState } from 'react'
import { ReplyEditorInner } from './reply-form'
import type { ReplyData } from './reply-form'

export type ReplyEditorProps = Readonly<{
  reviewId: string
  /** Reply from the detail payload (getInboxItemDetail); null if none / Staff. */
  initialReply: ReplyData | null
  loading: boolean
}>

export function ReplyEditor({ reviewId, initialReply, loading }: ReplyEditorProps) {
  const [reply, setReply] = useState<ReplyData | null>(initialReply)

  return (
    <ReplyEditorInner
      reviewId={reviewId}
      reply={reply}
      loading={loading}
      onReplyChanged={setReply}
    />
  )
}
