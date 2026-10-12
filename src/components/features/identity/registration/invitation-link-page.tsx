/**
 * InvitationLinkPage — a signed-in visitor opened an invitation link. It never
 * accepts on load: a matching address gets the confirm step, a different one
 * gets the mismatch card, and a link that cannot be used says why.
 */

import { useCallback, useRef, useState } from 'react'
import { useAction } from '#/components/hooks/use-action'
import { AcceptedView } from './accepted-view'
import { ConfirmInvitationView } from './confirm-invitation-view'
import { InvitationLinkStateCard, InvitationStateCard } from './invitation-state-card'
import { emailsMatch, type InvitationLink } from './invitation-link'

type Props = Readonly<{
  link: InvitationLink
  signedInEmail: string
  acceptInvitation: (input: { data: { invitationId: string } }) => Promise<void>
  /** Ends the session and re-reads the link, which then sends a signed-out visitor on. */
  signOut: () => Promise<void>
  joiningNotice: React.ReactNode
}>

export function InvitationLinkPage({
  link,
  signedInEmail,
  acceptInvitation,
  signOut,
  joiningNotice,
}: Props) {
  const [accepted, setAccepted] = useState(false)
  // A double click must not send two acceptances: they race the membership
  // insert. Released on failure so the person can try again.
  const acceptingRef = useRef(false)
  const accept = useAction(acceptInvitation)
  const leave = useAction(signOut)

  const handleSignOut = useCallback(() => {
    void leave(undefined).catch(() => undefined) // the error is kept in `leave.error`
  }, [leave])

  const handleAccept = useCallback(async () => {
    if (link.state !== 'pending' || acceptingRef.current) return
    acceptingRef.current = true
    try {
      await accept({ data: { invitationId: link.invitationId } })
      setAccepted(true)
    } catch {
      // useAction retains the rejection for the banner; allow another attempt.
      acceptingRef.current = false
    }
  }, [accept, link])

  if (accepted) {
    return (
      <AcceptedView
        organizationName={
          link.state === 'pending' ? link.details.organizationName : undefined
        }
      />
    )
  }
  if (link.state !== 'pending') return <InvitationLinkStateCard link={link} signedIn />
  if (!emailsMatch(link.invitedEmail, signedInEmail)) {
    return (
      <InvitationStateCard
        state="mismatch"
        invitedEmail={link.invitedEmail}
        signedInEmail={signedInEmail}
        onSignOut={handleSignOut}
        signingOut={leave.isPending}
        error={leave.error}
      />
    )
  }
  return (
    <ConfirmInvitationView
      details={link.details}
      signedInEmail={signedInEmail}
      onAccept={() => void handleAccept()}
      accepting={accept.isPending}
      error={accept.error}
      onSignOut={handleSignOut}
      signingOut={leave.isPending}
      joiningNotice={joiningNotice}
    />
  )
}
