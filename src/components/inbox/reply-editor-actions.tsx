// Inbox detail — interactive reply status views (pending, failed, rejected)

import { useState } from 'react'
import { Textarea } from '#/components/ui/textarea'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'

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
        <h2 className="text-sm font-medium">Reply</h2>
        <Badge variant="outline">Awaiting Approval</Badge>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" disabled={isSaving}>
              Confirm &amp; Publish
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm and publish this reply?</AlertDialogTitle>
              <AlertDialogDescription>
                This records your confirmation and starts publishing the exact reply shown
                here to Google. RepKey keeps it pending until Google confirms that it is
                live.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
              <AlertDialogAction
                disabled={isSaving}
                onClick={() => void onApprove().catch(() => undefined)}
              >
                {isSaving ? 'Confirming…' : 'Confirm & Publish'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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

type FailedReplyView = ReplyView &
  Readonly<{
    publicationAttempts: number
    publicationLastErrorClass: 'terminal_rejection' | 'retryable' | 'ambiguous' | null
  }>

type CheckProps = Readonly<{
  reply: FailedReplyView
  isSaving: boolean
  onCheck: () => Promise<unknown>
}>

/** Unknown provider outcome: the only safe operator action is another read. */
export function ReplyPublicationNeedsCheck({ reply, isSaving, onCheck }: CheckProps) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Reply</h2>
        <Badge variant="outline">Google status unconfirmed</Badge>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Google may have accepted this reply, but RepKey could not verify it. To avoid
        posting twice, RepKey will only check Google—it will not send this reply again.
      </p>
      <Button size="sm" disabled={isSaving} onClick={() => onCheck()}>
        {isSaving ? 'Checking Google…' : 'Check Google again'}
      </Button>
    </div>
  )
}

type RetryProps = Readonly<{
  reply: FailedReplyView
  isSaving: boolean
  onRetry: () => Promise<unknown>
}>

/** A confirmed pre-request/retry exhaustion failure that is safe to send again. */
export function ReplyPublicationRetryable({ reply, isSaving, onRetry }: RetryProps) {
  const wasRejected = reply.publicationLastErrorClass === 'terminal_rejection'
  const retryDescription =
    reply.publicationAttempts === 0
      ? 'RepKey could not start publishing before the recovery deadline. No Google update was attempted, so it is safe to try again.'
      : `RepKey stopped after ${reply.publicationAttempts} ${
          reply.publicationAttempts === 1 ? 'attempt' : 'attempts'
        }. Google did not accept the update, so it is safe to try again when the connection is stable.`

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Reply</h2>
        <Badge variant="outline">
          {wasRejected ? 'Google rejected update' : 'Publishing stopped'}
        </Badge>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply.text}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        {wasRejected
          ? 'Google rejected this update before it could be published. Check the Google Business Profile connection and permissions, then try again.'
          : retryDescription}
      </p>
      <Button size="sm" disabled={isSaving} onClick={() => onRetry()}>
        {isSaving ? 'Starting…' : 'Try publishing again'}
      </Button>
    </div>
  )
}

type RejectedProps = Readonly<{
  reply: ReplyView
  isSaving: boolean
  /** Reopens the rejected reply as a draft before mounting the editor. */
  onEditResubmit: () => void
}>

export function ReviewReplyRejected({ reply, isSaving, onEditResubmit }: RejectedProps) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Reply</h2>
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
