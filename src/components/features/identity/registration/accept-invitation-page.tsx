/**
 * AcceptInvitationPage — the signed-in list of pending invitations, for a
 * visitor who opened /accept-invitation without a link (the workspace-access
 * screen sends people here). Each row accepts on its own button; nothing
 * accepts on load.
 */

import { useState, useCallback, useRef } from 'react'
import { useAction } from '#/components/hooks/use-action'
import { AcceptedView } from './accepted-view'
import { InvitationListView } from './invitation-list-view'
import type { PendingInvitation } from './shared-types'

type Props = Readonly<{
  invitations: ReadonlyArray<PendingInvitation>
  acceptInvitation: (input: { data: { invitationId: string } }) => Promise<void>
  joiningNotice: React.ReactNode
}>

export function AcceptInvitationPage({
  invitations,
  acceptInvitation,
  joiningNotice,
}: Props) {
  const [accepted, setAccepted] = useState(false)
  // A double click must not send two acceptances: they race the membership
  // insert (and the active-org activation) and create a duplicate membership.
  const acceptingRef = useRef(false)

  const accept = useAction(acceptInvitation)

  const handleAccept = useCallback(
    async (invitationId: string) => {
      if (acceptingRef.current) return
      acceptingRef.current = true
      try {
        await accept({ data: { invitationId } })
        setAccepted(true)
      } catch {
        // useAction retains the rejection for the shared error banner. Catching
        // here prevents click callers from leaking an unhandled promise.
        acceptingRef.current = false
      }
    },
    [accept],
  )

  if (accepted) return <AcceptedView />

  return (
    <InvitationListView
      invitations={invitations}
      error={accept.error}
      onAccept={handleAccept}
      accepting={accept.isPending}
      joiningNotice={joiningNotice}
    />
  )
}
