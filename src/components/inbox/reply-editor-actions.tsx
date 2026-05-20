// Inbox detail — interactive reply status views (pending, failed, rejected)

import { useState } from 'react'
import { Textarea } from '#/components/ui/textarea'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'

type ReplyView = Readonly<{
  text: string
  publishedAt: Date | null
  rejectionReason: string | null
}>

type PendingProps = Readonly<{
  reply: ReplyView
  isSaving: boolean
  onApprove: () => Promise<unknown>
  onReject: (reason?: string) => Promise<unknown>
}>

export function ReplyPendingApproval({
  reply,
  isSaving,
  onApprove,
  onReject,
}: PendingProps) {
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Reply</h4>
        <Badge variant="outline">Awaiting Approval</Badge>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isSaving} onClick={() => onApprove()}>
          Approve
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={isSaving}
          onClick={() => setShowRejectInput(true)}
        >
          Reject
        </Button>
      </div>
      {showRejectInput && (
        <div className="space-y-2">
          <Textarea
            placeholder="Reason for rejection (optional)..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={isSaving}
              onClick={() => onReject(rejectReason || undefined)}
            >
              Confirm Reject
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowRejectInput(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

type FailedProps = Readonly<{
  reply: ReplyView
  isSaving: boolean
  onRetry: () => Promise<unknown>
}>

export function ReplyPublishFailed({ reply, isSaving, onRetry }: FailedProps) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Reply</h4>
        <Badge variant="destructive">Publish Failed</Badge>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
      <p className="text-xs text-destructive">
        Failed to publish to Google. You can retry.
      </p>
      <Button size="sm" disabled={isSaving} onClick={() => onRetry()}>
        Retry Publish
      </Button>
    </div>
  )
}

type RejectedProps = Readonly<{
  reply: ReplyView
  isSaving: boolean
  onEditResubmit: () => void
}>

export function ReplyRejected({ reply, isSaving, onEditResubmit }: RejectedProps) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Reply</h4>
        <Badge variant="destructive">Rejected</Badge>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
      {reply.rejectionReason && (
        <p className="text-xs text-muted-foreground">Reason: {reply.rejectionReason}</p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={isSaving}
        onClick={() => onEditResubmit()}
      >
        Edit &amp; Resubmit
      </Button>
    </div>
  )
}
