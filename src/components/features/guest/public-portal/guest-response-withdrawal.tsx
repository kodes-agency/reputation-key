import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { Button } from '#/components/ui/button'
import type { GuestPortalCopy } from './guest-language-pack'

export function GuestResponseWithdrawal({
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
  if (!response.responseWithdrawalAvailable) {
    return <p className="text-sm">{copy.responseWithdrawalWindowEnded}</p>
  }
  return (
    <div className="text-sm">
      {response.responseWithdrawalDeadline && (
        <p>{copy.responseWithdrawalUntil(response.responseWithdrawalDeadline)}</p>
      )}
      <Button
        type="button"
        variant="link"
        disabled={pending}
        onClick={onWithdraw}
        className="-ml-4 mt-1 text-current underline"
      >
        {copy.withdrawEntireResponse}
      </Button>
    </div>
  )
}
