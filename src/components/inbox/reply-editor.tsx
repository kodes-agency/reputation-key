// Inbox detail — reply editor component

import { useState, useEffect } from 'react'
import {
  draftReplyFn,
  submitReplyFn,
  approveReplyFn,
  rejectReplyFn,
  deleteReplyFn,
  retryPublishFn,
  getReplyFn,
} from '#/contexts/review/server/reply'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { ReplyCompose } from './reply-editor-compose'
import { ReplyApproved, ReplyPublished } from './reply-editor-views'
import {
  ReplyPendingApproval,
  ReplyPublishFailed,
  ReplyRejected,
} from './reply-editor-actions'

export type ReplyEditorProps = Readonly<{ reviewId: string }>
type ReplyData = Awaited<ReturnType<typeof getReplyFn>>

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

type InnerProps = Readonly<{
  reviewId: string
  reply: ReplyData | null
  loading: boolean
  onReplyChanged: (reply: ReplyData | null) => void
}>

function ReplyEditorInner({ reviewId, reply, loading, onReplyChanged }: InnerProps) {
  const draft = useMutationAction(draftReplyFn, {
    successMessage: 'Draft saved',
    invalidate: false,
    onSuccess: onReplyChanged,
  })
  const submit = useMutationAction(submitReplyFn, {
    successMessage: 'Submitted for approval',
    invalidate: false,
    onSuccess: onReplyChanged,
  })
  const approve = useMutationAction(approveReplyFn, {
    successMessage: 'Approved and publishing',
    invalidate: false,
    onSuccess: onReplyChanged,
  })
  const reject = useMutationAction(rejectReplyFn, {
    successMessage: 'Reply rejected',
    invalidate: false,
    onSuccess: onReplyChanged,
  })
  const del = useMutationAction(deleteReplyFn, {
    successMessage: 'Reply deleted',
    invalidate: false,
    onSuccess: () => onReplyChanged(null),
  })
  const retry = useMutationAction(retryPublishFn, {
    successMessage: 'Retrying publish...',
    invalidate: false,
    onSuccess: onReplyChanged,
  })
  const isSaving = [draft, submit, approve, reject, del, retry].some((m) => m.isPending)

  if (loading) {
    return (
      <div className="border-t pt-4">
        <p className="text-sm text-muted-foreground">Loading reply...</p>
      </div>
    )
  }

  if (!reply || reply.status === 'draft') {
    return (
      <ReplyCompose
        initialText={reply?.text ?? ''}
        isSaving={isSaving}
        onSaveDraft={(text) => draft({ data: { reviewId, text } })}
        onSubmit={(text) =>
          draft({ data: { reviewId, text } }).then(() => submit({ data: { reviewId } }))
        }
        onDelete={reply ? () => del({ data: { reviewId } }) : undefined}
      />
    )
  }

  if (reply.status === 'pending_approval') {
    return (
      <ReplyPendingApproval
        reply={reply}
        isSaving={isSaving}
        onApprove={() => approve({ data: { reviewId } })}
        onReject={(reason) => reject({ data: { reviewId, reason } })}
      />
    )
  }

  if (reply.status === 'approved') return <ReplyApproved reply={reply} />
  if (reply.status === 'published') return <ReplyPublished reply={reply} />

  if (reply.status === 'publish_failed') {
    return (
      <ReplyPublishFailed
        reply={reply}
        isSaving={isSaving}
        onRetry={() => retry({ data: { reviewId } })}
      />
    )
  }

  if (reply.status === 'rejected') {
    return <ReplyRejected reply={reply} isSaving={isSaving} onEditResubmit={() => {}} />
  }

  return null
}
