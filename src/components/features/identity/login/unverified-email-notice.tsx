// Sign-in refused an address that has not been verified. The way forward is a
// new link, so the notice carries it. The server answers the same whatever
// happened (it reveals nothing about accounts), so the copy does not promise
// a message either.

import { MailWarning } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { Action } from '#/components/hooks/use-action'

type Props = Readonly<{
  /** The address that was just tried; empty before anything was submitted. */
  email: string
  resend: Action<{ data: { email: string } }>
}>

export function UnverifiedEmailNotice({ email, resend }: Props) {
  const address = email || 'the address you entered'
  return (
    <div className="space-y-3">
      <Alert>
        <MailWarning />
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
