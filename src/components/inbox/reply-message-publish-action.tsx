import { useRef, type ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import type { ReplyDraftCheckDto } from '#/contexts/review/application/dto/reply-library.dto'
import { ReplyDraftCheckAlerts } from './reply-draft-check-alerts'
import type { ReplyOnScreen } from './reply-message-actions'
import { useReplyConfirmationHold } from './use-reply-confirmation-hold'

type PublishActionProps = Readonly<{
  approvable: ReplyOnScreen | null
  isSaving: boolean
  blockedReason: string | null
  blockedReasonId: string
  onApprove: (expectedReply: ReplyOnScreen) => Promise<unknown>
}>

export function ReplyMessagePublishAction({
  approvable,
  isSaving,
  blockedReason,
  blockedReasonId,
  onApprove,
}: PublishActionProps): ReactNode {
  const confirming = useRef<ReplyOnScreen | null>(null)
  const holdReply = useReplyConfirmationHold()
  if (approvable === null) return null

  return (
    <ConfirmationDialog
      density="compact"
      trigger={
        <Button
          size="sm"
          disabled={isSaving}
          aria-disabled={blockedReason !== null}
          aria-describedby={blockedReason !== null ? blockedReasonId : undefined}
          onClick={(event) => {
            if (blockedReason !== null) event.preventDefault()
          }}
        >
          Confirm &amp; publish
        </Button>
      }
      title="Confirm and publish this reply?"
      description="This records your confirmation and starts publishing the exact reply shown here to Google. RepKey keeps it pending until Google confirms that it is live."
      cancelLabel="Keep reviewing"
      confirmLabel="Confirm & publish"
      pendingLabel="Confirming…"
      confirmDisabled={isSaving || blockedReason !== null}
      onOpenChange={(open) => {
        confirming.current = open ? approvable : null
        holdReply(open)
      }}
      onConfirm={() => onApprove(confirming.current ?? approvable)}
    />
  )
}

export function ReplyMessagePublishFeedback({
  approvable,
  blockedReason,
  blockedReasonId,
  draftChecks,
}: Readonly<{
  approvable: ReplyOnScreen | null
  blockedReason: string | null
  blockedReasonId: string
  draftChecks: ReplyDraftCheckDto | null
}>): ReactNode {
  if (approvable === null) return null
  return (
    <>
      {blockedReason !== null && (
        <p id={blockedReasonId} className="mt-2 text-xs text-negative">
          {blockedReason}
        </p>
      )}
      {draftChecks ? (
        <div className="mt-2">
          <ReplyDraftCheckAlerts checks={draftChecks} />
        </div>
      ) : null}
    </>
  )
}
