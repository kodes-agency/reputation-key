// Inbox detail — reply editor component.
// Receives the getReply server fn as a prop per src/components/CONTEXT.md:55.
import { useState, useEffect } from 'react'
import { useServerFn } from '@tanstack/react-start'
import type { getReplyFn } from '#/contexts/review/server/reply'
import { ReplyEditorInner } from './reply-form'
import type { ReplyData } from './reply-form'

export type ReplyEditorProps = Readonly<{
  reviewId: string
  /** Raw server fn — wrapped with useServerFn per src/components/CONTEXT.md:55. */
  getReply: typeof getReplyFn
}>

export function ReplyEditor({ reviewId, getReply }: ReplyEditorProps) {
  const fetchReply = useServerFn(getReply)
  const [reply, setReply] = useState<ReplyData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchReply({ data: { reviewId } })
      .then((r) => {
        if (!cancelled) setReply(r ?? null)
      })
      .catch(() => {
        if (!cancelled) setReply(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reviewId, fetchReply])

  return (
    <ReplyEditorInner
      reviewId={reviewId}
      reply={reply}
      loading={loading}
      onReplyChanged={(r) => setReply(r)}
    />
  )
}
