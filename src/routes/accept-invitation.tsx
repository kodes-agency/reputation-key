// Accept invitation page
// Users arrive here from invitation emails via /accept-invitation?id=<invitationId>
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { getSession } from '#/shared/auth/auth.functions'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

// ── Types ────────────────────────────────────────────────────────────

interface PendingInvitation {
  id: string
  organizationName: string
  role: string
  expiresAt: Date
}

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
  component: AcceptInvitationPage,
})

// ── Page component ───────────────────────────────────────────────────

function AcceptInvitationPage() {
  const search = Route.useSearch() as { id?: string }
  const queryClient = useQueryClient()
  const [autoAcceptError, setAutoAcceptError] = useState<string | null>(null)

  // Query for listing invitations (used when no ?id= in URL)
  const invitationsQuery = useQuery({
    queryKey: ['userInvitations'],
    queryFn: async () => {
      const result = await listUserInvitations()
      return result.invitations.filter((inv) => inv.status === 'pending')
    },
    enabled: !search.id, // only fetch when showing the list view
  })

  // Mutation for accepting an invitation
  const acceptMutation = useMutation({
    mutationFn: (invitationId: string) => acceptInvitation({ data: { invitationId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userInvitations'] })
    },
  })

  // Auto-accept when arriving with ?id= query param
  const [autoAcceptTriggered, setAutoAcceptTriggered] = useState(false)
  if (search.id && !autoAcceptTriggered && !acceptMutation.isSuccess) {
    setAutoAcceptTriggered(true)
    acceptMutation.mutate(search.id, {
      onError: (err) => {
        setAutoAcceptError(
          err instanceof Error ? err.message : 'An unexpected error occurred',
        )
      },
    })
  }

  if (acceptMutation.isSuccess) return <SuccessView />
  if (search.id)
    return <AutoAcceptView error={autoAcceptError} loading={acceptMutation.isPending} />

  const pendingInvitations = (invitationsQuery.data ?? []) as PendingInvitation[]

  return (
    <InvitationListView
      invitations={pendingInvitations}
      loading={invitationsQuery.isLoading}
      error={invitationsQuery.error ? 'Failed to load invitations' : null}
      onAccept={(id) => acceptMutation.mutate(id)}
      accepting={acceptMutation.isPending}
    />
  )
}
