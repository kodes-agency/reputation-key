import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { AuthCard } from '#/components/layout/auth-layout'
import { InvitationCard } from './invitation-card'
import type { PendingInvitation } from './shared-types'

type Props = Readonly<{
  invitations: ReadonlyArray<PendingInvitation>
  error: unknown
  onAccept: (id: string) => void
  accepting: boolean
}>

export function InvitationListView({ invitations, error, onAccept, accepting }: Props) {
  return (
    <AuthCard
      title="Pending invitations"
      description="You have pending invitations to join organizations"
    >
      <FormErrorBanner error={error} />

      {invitations.length === 0 ? (
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
