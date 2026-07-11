/**
 * AcceptInvitationPage — extracted from accept-invitation.tsx route.
 * Fixes the side-effect-in-render bug by using useEffect for auto-accept.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAction } from '#/components/hooks/use-action'
import { Skeleton } from '#/components/ui/skeleton'
import { AuthCard, AuthFooterLink, ErrorBanner } from '#/components/layout/auth-layout'
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
}: Readonly<{ error: string | null; loading: boolean }>) {
  return (
    <AuthCard title="Accepting invitation…" description="">
      {error && <ErrorBanner message={error} />}
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
  const [accepting, setAccepting] = useState(false)
  const [autoAcceptError, setAutoAcceptError] = useState<string | null>(null)
  // Dedupes React StrictMode's double-invocation of the auto-accept effect in
  // dev — without it, acceptInvitation fires twice concurrently and creates a
  // duplicate membership (and races the active-org activation).
  const acceptingRef = useRef(false)

  const accept = useAction(acceptInvitation)

  const handleAccept = useCallback(
    async (invId: string) => {
      setAccepting(true)
      setAutoAcceptError(null)
      try {
        await accept({ data: { invitationId: invId } })
        setAccepted(true)
      } catch (err) {
        setAutoAcceptError(
          err instanceof Error ? err.message : 'An unexpected error occurred',
        )
      } finally {
        setAccepting(false)
      }
    },
    [accept],
  )

  // Auto-accept when arriving with ?id= query param — useEffect, not render-body.
  // acceptingRef ensures only the first invocation proceeds (StrictMode-safe).
  useEffect(() => {
    if (invitationId && !accepted && !acceptingRef.current) {
      acceptingRef.current = true
      handleAccept(invitationId)
    }
  }, [invitationId, accepted, handleAccept])

  if (accepted) return <SuccessView />
  if (invitationId) return <AutoAcceptView error={autoAcceptError} loading={accepting} />

  return (
    <>
      <InvitationListView
        invitations={invitations}
        loading={false}
        error={accept.error ? 'Failed to accept invitation' : null}
        onAccept={handleAccept}
        accepting={accepting}
      />
      <AuthFooterLink message="" linkText="Back to dashboard" to="/dashboard" />
    </>
  )
}
