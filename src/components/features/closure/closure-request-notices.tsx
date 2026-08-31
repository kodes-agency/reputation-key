// Two things the Closure Center has to be able to SAY rather than imply.
//
// A deployment with no reactivation command refuses every closure request, so
// the request control is not armed at all — and silence there reads as a bug.
// And when a request is refused anyway, the rejection belongs on screen: it was
// previously dropped with `void`, which turned a deliberate server refusal into
// an uncaught error with nothing to explain it.

import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'

export function ClosureUnavailableNotice() {
  return (
    <Alert data-testid="closure-unavailable-notice">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>Closure is unavailable in this deployment</AlertTitle>
      <AlertDescription>
        A closure can only be requested where it can also be cancelled. This deployment
        has no reactivation command composed, so requesting one would suspend the
        Organization with no way back. Contact support to close this workspace.
      </AlertDescription>
    </Alert>
  )
}

export function ClosureRequestError({ error }: Readonly<{ error: unknown }>) {
  if (!error) return null
  return (
    <Alert variant="destructive" data-testid="closure-request-error">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>Closure could not be requested</AlertTitle>
      <AlertDescription>
        {error instanceof Error
          ? error.message
          : 'The request was refused. Please try again or contact support.'}
      </AlertDescription>
    </Alert>
  )
}

export function ClosureReadOnlyNotice() {
  return (
    <Alert data-testid="closure-read-only-notice">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>This workspace is read only</AlertTitle>
      <AlertDescription>
        While a closure is in progress you can view your data and download an export.
        Publishing, inviting people, replying and every other change is refused.
      </AlertDescription>
    </Alert>
  )
}
