// The explicit "join this Organization" step for a signed-in visitor. Opening
// a link never accepts on its own: the person sees what they join, as whom,
// and chooses.

import { Button } from '#/components/ui/button'
import { AuthCard } from '#/components/layout/auth-layout'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { InvitationSummary } from './invitation-summary'
import type { InvitationDetails } from './shared-types'

type Props = Readonly<{
  details: InvitationDetails
  signedInEmail: string
  onAccept: () => void
  accepting: boolean
  error: unknown
  onSignOut: () => void
  signingOut: boolean
  joiningNotice: React.ReactNode
}>

export function ConfirmInvitationView({
  details,
  signedInEmail,
  onAccept,
  accepting,
  error,
  onSignOut,
  signingOut,
  joiningNotice,
}: Props) {
  const invitedBy = details.inviterName
    ? `${details.inviterName} invited you to join ${details.organizationName}.`
    : `You have been invited to join ${details.organizationName}.`
  return (
    <AuthCard title={`Join ${details.organizationName}`} description={invitedBy}>
      <div className="space-y-4">
        <FormErrorBanner error={error} />
        <InvitationSummary invitation={details} />
        <p className="text-sm text-muted-foreground">
          Signed in as{' '}
          <span className="font-medium text-foreground">{signedInEmail}</span>. Not you?{' '}
          <Button
            variant="link"
            className="h-auto p-0 align-baseline"
            onClick={onSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </p>
        <Button className="w-full" onClick={onAccept} disabled={accepting}>
          {accepting ? 'Joining…' : 'Accept and join'}
        </Button>
      </div>
      {joiningNotice}
    </AuthCard>
  )
}
