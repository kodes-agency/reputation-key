// A link that cannot be used as it stands: expired, cancelled, already used,
// not a real invitation, or opened while signed in as someone else. Every state
// says what to do next and keeps a way out.

import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { AuthCard } from '#/components/layout/auth-layout'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import {
  invitationMismatchCopy,
  invitationStateCopy,
  type InvitationUnusableState,
} from './invitation-copy'
import type { UnusableInvitationLink } from './invitation-link'

type UnusableProps = Readonly<{
  state: InvitationUnusableState
  organizationName?: string
  inviterName?: string | null
  signedIn?: boolean
}>

type MismatchProps = Readonly<{
  state: 'mismatch'
  invitedEmail: string
  signedInEmail: string
  onSignOut: () => void
  signingOut: boolean
  error?: unknown
}>

type Props = UnusableProps | MismatchProps

export function InvitationStateCard(props: Props) {
  if (props.state === 'mismatch') return <MismatchCard {...props} />
  const copy = invitationStateCopy({ ...props, signedIn: props.signedIn ?? false })
  return (
    <AuthCard title={copy.title} description={copy.description}>
      <div className="text-center">
        <Link
          to={copy.action.to}
          className="text-sm font-medium text-link underline-offset-4 hover:underline"
        >
          {copy.action.label}
        </Link>
      </div>
    </AuthCard>
  )
}

/**
 * The card for a link the pages cannot act on. Expired, cancelled and used
 * links name their Organization and inviter; the others know nothing of the link.
 */
export function InvitationLinkStateCard({
  link,
  signedIn,
}: Readonly<{ link: UnusableInvitationLink; signedIn?: boolean }>) {
  if (link.state === 'unavailable' || link.state === 'rate_limited') {
    return <InvitationStateCard state={link.state} signedIn={signedIn} />
  }
  return (
    <InvitationStateCard
      state={link.state}
      organizationName={link.organizationName}
      inviterName={link.inviterName}
      signedIn={signedIn}
    />
  )
}

function MismatchCard({
  invitedEmail,
  signedInEmail,
  onSignOut,
  signingOut,
  error,
}: MismatchProps) {
  const copy = invitationMismatchCopy(invitedEmail, signedInEmail)
  return (
    <AuthCard title={copy.title} description={copy.description}>
      <div className="space-y-4">
        <FormErrorBanner error={error} />
        <Button className="w-full" onClick={onSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </AuthCard>
  )
}
