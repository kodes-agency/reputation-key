// Inbox detail — reply editor component
//
// NOTE: This component imports server functions from review/server/reply.
// This exceeds the 5-mutation threshold in src/components/CONTEXT.md,
// making it a deliberate exception to the "no server imports in components" rule.
// Refactoring to prop-drill 7 action hooks through the inbox component tree
// would create excessive prop drilling with minimal benefit.

import { useState, useEffect } from 'react'
import { getReplyFn } from '#/contexts/review/server/reply'
import { ReplyEditorInner } from './reply-form'
import type { ReplyData } from './reply-form'

export type ReplyEditorProps = Readonly<{ reviewId: string }>

export function ReplyEditor({ reviewId }: ReplyEditorProps) {
  const [reply, setReply] = useState<ReplyData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getReplyFn({ data: { reviewId } })
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
  }, [reviewId])

  return (
    <ReplyEditorInner
      reviewId={reviewId}
      reply={reply}
      loading={loading}
      onReplyChanged={(r) => setReply(r)}
    />
  )
}
