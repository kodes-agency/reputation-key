// What an invitation link offers: who sent it, to what, as which role. Shown
// before the invitee creates an account or accepts, so nobody joins blind.

import { roleLabel } from '#/components/features/identity/shared/role-utils'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { formatInvitationExpiry, invitationPropertyLines } from './invitation-copy'
import type { InvitationDetails } from './shared-types'

type Props = Readonly<{ invitation: InvitationDetails }>

export function InvitationSummary({ invitation }: Props) {
  const { organizationName, inviterName, role, propertyNames, expiresAt } = invitation
  return (
    <DescriptionList
      aria-label="Invitation details"
      className="rounded-lg border bg-muted/30 p-4"
    >
      <DescriptionItem term="Organization">
        <span className="font-medium">{organizationName}</span>
      </DescriptionItem>
      {inviterName ? (
        <DescriptionItem term="Invited by">{inviterName}</DescriptionItem>
      ) : null}
      <DescriptionItem term="Role">{roleLabel(role, 'full')}</DescriptionItem>
      <DescriptionItem term="Properties">
        <ul className="space-y-0.5">
          {invitationPropertyLines(role, propertyNames).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </DescriptionItem>
      <DescriptionItem term="Expires">
        <time dateTime={expiresAt.toISOString()}>
          {formatInvitationExpiry(expiresAt)}
        </time>
      </DescriptionItem>
    </DescriptionList>
  )
}
