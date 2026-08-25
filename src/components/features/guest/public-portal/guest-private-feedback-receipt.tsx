import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'

export function GuestPrivateFeedbackReceipt({
  response,
  pending,
  onWithdraw,
}: Readonly<{
  response: GuestResponseView
  pending: boolean
  onWithdraw: () => void
}>) {
  if (response.feedbackWithdrawnAt) {
    return (
      <p role="status" className="rounded-lg border p-4 text-sm">
        Your private feedback was withdrawn. Your private rating remains saved.
      </p>
    )
  }
  if (!response.hasPrivateFeedback) return null
  return (
    <div role="status" className="rounded-lg border p-4 text-sm">
      <p>
        Your private feedback was sent to the property team. Its text is not shown again
        on this device.
      </p>
      {response.feedbackWithdrawalDeadline && (
        <p className="mt-2">
          Private-feedback withdrawal is available until{' '}
          {new Date(response.feedbackWithdrawalDeadline).toLocaleString()}.
        </p>
      )}
      {response.feedbackWithdrawalAvailable ? (
        <button
          type="button"
          disabled={pending}
          onClick={onWithdraw}
          className="mt-3 underline disabled:opacity-50"
        >
          Withdraw only my private feedback
        </button>
      ) : (
        <p className="mt-2">The private-feedback withdrawal window has ended.</p>
      )}
    </div>
  )
}
