import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { Button } from '#/components/ui/button'
import type { GuestPortalCopy } from './guest-language-pack'

export function GuestPrivateFeedbackReceipt({
  response,
  pending,
  onWithdraw,
  copy,
}: Readonly<{
  response: GuestResponseView
  pending: boolean
  onWithdraw: () => void
  copy: GuestPortalCopy
}>) {
  if (response.feedbackWithdrawnAt) {
    return (
      <p role="status" className="rounded-lg border p-4 text-sm">
        {copy.feedbackWithdrawnRatingSaved}
      </p>
    )
  }
  if (!response.hasPrivateFeedback) return null
  return (
    <div role="status" className="rounded-lg border p-4 text-sm">
      <p>{copy.privateFeedbackReceipt}</p>
      {response.feedbackWithdrawalDeadline && (
        <p className="mt-2">
          {copy.privateFeedbackWithdrawalUntil(response.feedbackWithdrawalDeadline)}
        </p>
      )}
      {response.feedbackWithdrawalAvailable ? (
        <Button
          type="button"
          variant="link"
          disabled={pending}
          onClick={onWithdraw}
          className="-ml-4 mt-2 text-current underline"
        >
          {copy.withdrawPrivateFeedback}
        </Button>
      ) : (
        <p className="mt-2">{copy.privateFeedbackWindowEnded}</p>
      )}
    </div>
  )
}
