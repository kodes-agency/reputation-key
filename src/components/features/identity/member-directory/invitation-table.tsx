/**
 * InvitationTable — the Organization's open invitations: who was invited as
 * what, for which properties, when it was sent and when it lapses. Resend
 * renews the same invitation's expiry and emails it again; an expired one is
 * renewed the same way, so there is one row per person.
 *
 * Seven columns are wide by nature, so the table scrolls sideways in a narrow
 * column rather than stacking (`DataTable layout="scroll"`).
 */

import { Shield } from 'lucide-react'
import { SectionTitle } from '#/components/ui/section-title'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import { StatusBadge } from '#/components/ui/status-badge'
import { TONE_ICON } from '#/components/ui/tone'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import type { Action } from '#/components/hooks/use-action'
import type { OrganizationInvitation } from '#/contexts/identity/application/dto/invitation.dto'
import { INVITATION_STATUS } from './invitation-status'
import { InvitationRowActions } from './invitation-row-actions'
import { formatInvitationDay } from './invitation-day'
import { PropertyNames } from './property-names'

export type InvitationRow = OrganizationInvitation

/**
 * What the two Actions do when they refuse is `InvitationRowActions`' to say: the
 * resend is settled there, and the cancellation's rejection goes to its dialog.
 */
type Props = Readonly<{
  invitations: ReadonlyArray<InvitationRow>
  resendAction: Action<{ data: { invitationId: string } }>
  cancelAction: Action<{ data: { invitationId: string } }>
}>

const WarnIcon = TONE_ICON.warn

function InvitedProperties({ invitation }: Readonly<{ invitation: InvitationRow }>) {
  if (invitation.role === 'AccountAdmin') return <span>All properties</span>
  if (invitation.properties.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-warn">
        <WarnIcon className="size-3.5" aria-hidden="true" />
        None chosen
      </span>
    )
  }
  return <PropertyNames properties={invitation.properties} />
}

function ExpiryCell({ invitation }: Readonly<{ invitation: InvitationRow }>) {
  if (invitation.status === 'expired') {
    return (
      <div className="flex flex-col items-start gap-1">
        <StatusBadge status={invitation.status} map={INVITATION_STATUS} />
        <span className="text-xs text-muted-foreground">
          {formatInvitationDay(invitation.expiresAt)}
        </span>
      </div>
    )
  }
  return <span>{formatInvitationDay(invitation.expiresAt)}</span>
}

export function InvitationTable({ invitations, resendAction, cancelAction }: Props) {
  const { can } = usePermissions()
  const canResend = can('invitation.resend')
  const canCancel = can('invitation.cancel')
  const canManage = canResend || canCancel

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle className="flex items-center gap-2">
        <Shield aria-hidden="true" />
        Invitations
      </SectionTitle>
      <DataTable label="Invitations" layout="scroll">
        <DataTableHeader>
          <DataTableHead>Email</DataTableHead>
          <DataTableHead>Role</DataTableHead>
          <DataTableHead>Properties</DataTableHead>
          <DataTableHead>Invited by</DataTableHead>
          <DataTableHead>Sent</DataTableHead>
          <DataTableHead>Expires</DataTableHead>
          {canManage ? <DataTableHead actions /> : null}
        </DataTableHeader>
        <DataTableBody>
          {invitations.map((inv) => (
            <DataTableRow key={inv.id}>
              <DataTableCell className="font-medium">{inv.email}</DataTableCell>
              <DataTableCell>
                <RoleBadge role={inv.role} rawRole={inv.rawRole} />
              </DataTableCell>
              <DataTableCell>
                <InvitedProperties invitation={inv} />
              </DataTableCell>
              <DataTableCell
                className={inv.inviterName ? undefined : 'text-muted-foreground'}
              >
                {inv.inviterName ?? 'Unknown'}
              </DataTableCell>
              <DataTableCell>{formatInvitationDay(inv.createdAt)}</DataTableCell>
              <DataTableCell>
                <ExpiryCell invitation={inv} />
              </DataTableCell>
              {canManage ? (
                <DataTableCell actions>
                  <InvitationRowActions
                    invitationId={inv.id}
                    email={inv.email}
                    expired={inv.status === 'expired'}
                    resendAction={canResend ? resendAction : null}
                    cancelAction={canCancel ? cancelAction : null}
                  />
                </DataTableCell>
              ) : null}
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    </div>
  )
}
