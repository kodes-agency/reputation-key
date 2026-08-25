import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { Button } from '#/components/ui/button'

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
      <Button
        type="button"
        variant="link"
        disabled={pending}
        onClick={onWithdraw}
        className="-ml-4 mt-1 text-current underline"
      >
        Withdraw my entire response
      </Button>
    </div>
  )
}
