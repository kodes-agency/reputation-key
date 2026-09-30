// The card a new member sees between "account created, signed in" and the app.
// The session cookie is already set here. If opening the workspace fails
// (setting the active Organization, or the navigation), the person must not be
// stranded on a card with no form: retry, or follow the link in by hand.

import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { AuthCard } from '#/components/layout/auth-layout'

type Props = Readonly<{
  status: 'entering' | 'failed'
  onRetry: () => void
}>

export function JoinEntryCard({ status, onRetry }: Props) {
  return (
    <AuthCard title="Account created!" description="Your email is verified.">
      <div className="space-y-4 text-center">
        {status === 'failed' ? (
          <>
            <Alert variant="destructive" className="text-left">
              <AlertTitle>We could not open your workspace</AlertTitle>
              <AlertDescription>
                Your account is ready and you are signed in. Try again to continue.
              </AlertDescription>
            </Alert>
            <Button className="w-full" onClick={onRetry}>
              Try again
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            Signing you in…
          </p>
        )}
        <Link
          to="/properties"
          className="block text-sm font-medium text-link underline-offset-4 hover:underline"
        >
          Continue to your workspace
        </Link>
      </div>
    </AuthCard>
  )
}
