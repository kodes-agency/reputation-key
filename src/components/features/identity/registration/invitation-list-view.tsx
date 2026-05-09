import { Skeleton } from '#/components/ui/skeleton'
import { AuthCard, ErrorBanner } from '#/components/layout/auth-layout'
import { InvitationCard } from './invitation-card'

type PendingInvitation = Readonly<{
  id: string
  organizationName: string
  role: string
  expiresAt: Date
}>

type Props = Readonly<{
  invitations: PendingInvitation[]
  loading: boolean
  error: string | null
  onAccept: (id: string) => void
  accepting: boolean
}>

export function InvitationListView({
  invitations,
  loading,
  error,
  onAccept,
  accepting,
}: Props) {
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
            <InvitationCard
              key={inv.id}
              organizationName={inv.organizationName}
              role={inv.role}
              onAccept={() => onAccept(inv.id)}
              disabled={accepting}
            />
          ))}
        </div>
      )}
    </AuthCard>
  )
}
