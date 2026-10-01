// What an invitation link offers: who sent it, to what, as which role. Shown
// before the invitee creates an account or accepts, so nobody joins blind.

import { roleLabel } from '#/components/features/identity/shared/role-utils'
import { formatInvitationExpiry, invitationPropertyLines } from './invitation-copy'
import type { InvitationDetails } from './shared-types'

type Props = Readonly<{ invitation: InvitationDetails }>

export function InvitationSummary({ invitation }: Props) {
  const { organizationName, inviterName, role, propertyNames, expiresAt } = invitation
  return (
    <dl
      aria-label="Invitation details"
      className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-2 rounded-lg border bg-muted/30 p-4 text-sm"
    >
      <dt className="text-muted-foreground">Organization</dt>
      <dd className="font-medium">{organizationName}</dd>
      {inviterName ? (
        <>
          <dt className="text-muted-foreground">Invited by</dt>
          <dd>{inviterName}</dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">Role</dt>
      <dd>{roleLabel(role, 'full')}</dd>
      <dt className="text-muted-foreground">Properties</dt>
      <dd>
        <ul className="space-y-0.5">
          {invitationPropertyLines(role, propertyNames).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </dd>
      <dt className="text-muted-foreground">Expires</dt>
      <dd>
        <time dateTime={expiresAt.toISOString()}>
          {formatInvitationExpiry(expiresAt)}
        </time>
      </dd>
    </dl>
  )
}
