import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'

export function GuestResponseWithdrawal({
  response,
  pending,
  onWithdraw,
}: Readonly<{
  response: GuestResponseView
  pending: boolean
  onWithdraw: () => void
}>) {
  if (!response.responseWithdrawalAvailable) {
    return <p className="text-sm">The response withdrawal window has ended.</p>
  }
  return (
    <div className="text-sm">
      {response.responseWithdrawalDeadline && (
        <p>
          Complete response withdrawal is available until{' '}
          {new Date(response.responseWithdrawalDeadline).toLocaleString()}.
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={onWithdraw}
        className="mt-2 underline disabled:opacity-50"
      >
        Withdraw my entire response
      </button>
    </div>
  )
}
