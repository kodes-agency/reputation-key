/**
 * AcceptInvitationPage — extracted from accept-invitation.tsx route.
 * Fixes the side-effect-in-render bug by using useEffect for auto-accept.
 */

import { useState, useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { acceptInvitation } from '#/contexts/identity/server/organizations'
import { useAction } from '#/components/hooks/use-action'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import {
  AuthCard,
  AuthFooterLink,
  ErrorBanner,
} from '#/components/features/identity/AuthLayout'
import { Link } from '@tanstack/react-router'

type PendingInvitation = Readonly<{
  id: string
  organizationName: string
  role: string
  expiresAt: Date
}>

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
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
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

function InvitationListView({
  invitations,
  loading,
  error,
  onAccept,
  accepting,
}: Readonly<{
  invitations: PendingInvitation[]
  loading: boolean
  error: string | null
  onAccept: (id: string) => void
  accepting: boolean
}>) {
  return (
    <AuthCard
      title="Pending invitations"
      description="You have pending invitations to join organizations"
    >
      {error && <ErrorBanner message={error} />}

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : invitations.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          No pending invitations.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {invitations.map((inv) => (
            <Card key={inv.id}>
              <div className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{inv.organizationName}</p>
                  <p className="text-sm text-muted-foreground">Role: {inv.role}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onAccept(inv.id)} disabled={accepting}>
                    Accept
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AuthFooterLink message="" linkText="Back to dashboard" to="/dashboard" />
    </AuthCard>
  )
}

// ── Main page component ────────────────────────────────────────────────

type Props = Readonly<{
  invitationId?: string
  invitations: PendingInvitation[]
}>

export function AcceptInvitationPage({ invitationId, invitations }: Props) {
  const router = useRouter()
  const [accepted, setAccepted] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [autoAcceptError, setAutoAcceptError] = useState<string | null>(null)

  const accept = useAction(useServerFn(acceptInvitation))

  async function handleAccept(invId: string) {
    setAccepting(true)
    setAutoAcceptError(null)
    try {
      await accept({ data: { invitationId: invId } })
      await router.invalidate()
      setAccepted(true)
    } catch (err) {
      setAutoAcceptError(
        err instanceof Error ? err.message : 'An unexpected error occurred',
      )
    } finally {
      setAccepting(false)
    }
  }

  // Auto-accept when arriving with ?id= query param — useEffect, not render-body
  useEffect(() => {
    if (invitationId && !accepted) {
      handleAccept(invitationId)
    }
  }, [invitationId])

  if (accepted) return <SuccessView />
  if (invitationId) return <AutoAcceptView error={autoAcceptError} loading={accepting} />

  return (
    <InvitationListView
      invitations={invitations}
      loading={false}
      error={accept.error ? 'Failed to accept invitation' : null}
      onAccept={handleAccept}
      accepting={accepting}
    />
  )
}
