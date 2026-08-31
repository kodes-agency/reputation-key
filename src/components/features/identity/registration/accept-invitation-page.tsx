/**
 * AcceptInvitationPage — extracted from accept-invitation.tsx route.
 * Fixes the side-effect-in-render bug by using useEffect for auto-accept.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAction } from '#/components/hooks/use-action'
import { Skeleton } from '#/components/ui/skeleton'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { AuthCard, AuthFooterLink } from '#/components/layout/auth-layout'
import { Link } from '@tanstack/react-router'
import { InvitationListView } from './invitation-list-view'
import type { PendingInvitation } from './shared-types'

// ── Sub-views ──────────────────────────────────────────────────────────

function SuccessView() {
  return (
    <AuthCard
      title="Welcome to the team!"
      description="You've successfully joined the organization."
    >
      <div className="text-center">
        <Link
          to="/dashboard"
          className="text-sm font-medium text-link underline-offset-4 hover:underline"
        >
          Go to dashboard
        </Link>
      </div>
    </AuthCard>
  )
}

function AutoAcceptView({
  error,
  loading,
}: Readonly<{ error: unknown; loading: boolean }>) {
  return (
    <AuthCard title="Accepting invitation…" description="">
      <FormErrorBanner error={error} />
      {loading && (
        <div className="flex justify-center py-4">
          <Skeleton className="h-4 w-48" />
        </div>
      )}
    </AuthCard>
  )
}

// ── Main page component ────────────────────────────────────────────────

type Props = Readonly<{
  invitationId?: string
  invitations: ReadonlyArray<PendingInvitation>
  acceptInvitation: (input: { data: { invitationId: string } }) => Promise<void>
}>

export function AcceptInvitationPage({
  invitationId,
  invitations,
  acceptInvitation,
}: Props) {
  const [accepted, setAccepted] = useState(false)
  // Dedupes React StrictMode's double-invocation of the auto-accept effect in
  // dev — without it, acceptInvitation fires twice concurrently and creates a
  // duplicate membership (and races the active-org activation).
  const acceptingRef = useRef(false)

  const accept = useAction(acceptInvitation)

  const handleAccept = useCallback(
    async (invId: string) => {
      try {
        await accept({ data: { invitationId: invId } })
        setAccepted(true)
      } catch {
        // useAction retains the rejection for the shared error banner. Catching
        // here prevents click/effect callers from leaking an unhandled promise.
      }
    },
    [accept],
  )

  // Auto-accept when arriving with ?id= query param — useEffect, not render-body.
  // acceptingRef ensures only the first invocation proceeds (StrictMode-safe).
  useEffect(() => {
    if (invitationId && !accepted && !acceptingRef.current) {
      acceptingRef.current = true
      void handleAccept(invitationId)
    }
  }, [invitationId, accepted, handleAccept])

  if (accepted) return <SuccessView />
  if (invitationId) {
    return <AutoAcceptView error={accept.error} loading={accept.isPending} />
  }

  return (
    <>
      <InvitationListView
        invitations={invitations}
        error={accept.error}
        onAccept={handleAccept}
        accepting={accept.isPending}
      />
      <AuthFooterLink message="" linkText="Back to dashboard" to="/dashboard" />
    </>
  )
}
