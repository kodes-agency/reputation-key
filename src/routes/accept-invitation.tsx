// Accept invitation page
// Users arrive here from invitation emails via /accept-invitation?id=<invitationId>
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { getSession } from '#/shared/auth/auth.functions'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import {
  AuthCard,
  AuthFooterLink,
  ErrorBanner,
} from '#/components/features/identity/AuthLayout'
import {
  listUserInvitations,
  acceptInvitation,
} from '#/contexts/identity/server/organizations'
import { useAction } from '#/components/hooks/use-action'

// ── Types ────────────────────────────────────────────────────────────

type PendingInvitation = Readonly<{
  id: string
  organizationName: string
  role: string
  expiresAt: Date
}>

// ── Sub-components ───────────────────────────────────────────────────

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

function AutoAcceptView({ error, loading }: { error: string | null; loading: boolean }) {
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
}: {
  invitations: PendingInvitation[]
  loading: boolean
  error: string | null
  onAccept: (id: string) => void
  accepting: boolean
}) {
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

// ── Route ────────────────────────────────────────────────────────────

export const Route = createFileRoute('/accept-invitation')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) {
      throw redirect({
        to: '/join',
        search: { redirect: location.href },
      })
    }
  },
  loader: async () => {
    const { invitations } = await listUserInvitations()
    return { invitations: invitations.filter((inv) => inv.status === 'pending') }
  },
  component: AcceptInvitationPage,
})

// ── Page component ───────────────────────────────────────────────────

function AcceptInvitationPage() {
  const search = Route.useSearch() as { id?: string }
  const router = useRouter()
  const [autoAcceptError, setAutoAcceptError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const { invitations } = Route.useLoaderData()

  const accept = useAction(useServerFn(acceptInvitation))

  async function handleAccept(invitationId: string) {
    setAccepting(true)
    setAutoAcceptError(null)
    try {
      await accept({ data: { invitationId } })
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

  // Auto-accept when arriving with ?id= query param
  const [autoAcceptTriggered, setAutoAcceptTriggered] = useState(false)
  if (search.id && !autoAcceptTriggered && !accepted) {
    setAutoAcceptTriggered(true)
    handleAccept(search.id).catch((err) => {
      setAutoAcceptError(
        err instanceof Error ? err.message : 'An unexpected error occurred',
      )
    })
  }

  if (accepted) return <SuccessView />
  if (search.id) return <AutoAcceptView error={autoAcceptError} loading={accepting} />

  const pendingInvitations = invitations as PendingInvitation[]

  return (
    <InvitationListView
      invitations={pendingInvitations}
      loading={false}
      error={accept.error ? 'Failed to accept invitation' : null}
      onAccept={handleAccept}
      accepting={accepting}
    />
  )
}
