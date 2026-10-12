// Sign-in refused an address that has not been verified. The way forward is a
// new link, so the notice carries it. The server answers the same whatever
// happened (it reveals nothing about accounts), so the copy does not promise
// a message either.
//
// The notice owns the state of its resend, and the form gives each sign-in
// attempt its own notice (by key), so what a resend did (sent, or refused by
// the rate limit) is never carried over to the next attempt: a new refusal
// mounts a fresh notice with the button back.

import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { useAction } from '#/components/hooks/use-action'

type Props = Readonly<{
  /** The address that was just tried; empty before anything was submitted. */
  email: string
  /** Mails a fresh verification link to the address. */
  resendVerification: (input: { data: { email: string } }) => Promise<unknown>
}>

export function UnverifiedEmailNotice({ email, resendVerification }: Props) {
  const resend = useAction(resendVerification)
  const address = email || 'the address you entered'
  return (
    <div className="space-y-3">
      <Alert variant="warning">
        <AlertTitle>Verify your email first</AlertTitle>
        <AlertDescription>
          {resend.isSuccess ? (
            <p role="status">
              If {address} still needs verifying, a new link is on its way. Open it, then
              sign in here.
            </p>
          ) : (
            <>
              <p>
                We cannot sign you in until {address} is verified. We can send a new
                verification link.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resend.isPending || email === ''}
                onClick={() => void resend({ data: { email } }).catch(() => undefined)}
              >
                {resend.isPending ? 'Sending…' : 'Send a new link'}
              </Button>
            </>
          )}
        </AlertDescription>
      </Alert>
      <FormErrorBanner error={resend.error} />
    </div>
  )
}
