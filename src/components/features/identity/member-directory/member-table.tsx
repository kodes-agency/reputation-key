/**
 * MemberTable — extracted from settings/members.tsx route.
 * Displays org members with inline role select and remove action.
 */

import { usePermissions } from '#/shared/hooks/usePermissions'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import type { Action } from '#/components/hooks/use-action'
import { EmptyState } from '#/components/ui/empty-state'
import { Contact } from 'lucide-react'
import { RemoveMemberDialog } from './remove-member-dialog'
import { RoleSelect } from './role-select'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'

export interface MemberRow {
  id: string
  userId: string
  name: string
  email: string
  role: import('#/shared/domain/roles').Role | null
  rawRole: string
}

/**
 * A role change reports its own outcome (toasts); a refusal still rejects the
 * call, so it settles the promise rather than leaking it. Removing a member is
 * confirmed in a dialog, which stays open and says the refusal in place, so that
 * Action's rejection goes to the dialog.
 */
type Props = Readonly<{
  members: ReadonlyArray<MemberRow>
  currentUserId: string
  updateRoleAction: Action<{
    data: {
      memberId: string
      role: BetaInteractiveRole
    }
  }>
  removeMemberAction: Action<{ data: { memberId: string } }>
}>

export function MemberTable({
  members,
  currentUserId,
  updateRoleAction,
  removeMemberAction,
}: Props) {
  const { can } = usePermissions()
  const canChangeRoles = can('member.update')
  const canRemove = can('member.delete')
  const canManageMembers = canChangeRoles || canRemove

  if (members.length === 0) {
    return (
      <EmptyState
        icon={Contact}
        title="No members"
        description="Invite members to your organization using the button above."
      />
    )
  }

  return (
    <DataTable label="Members" from="3xl">
      <DataTableHeader>
        <DataTableHead>Name</DataTableHead>
        <DataTableHead>Email</DataTableHead>
        <DataTableHead>Role</DataTableHead>
        {canManageMembers ? <DataTableHead actions /> : null}
      </DataTableHeader>
      <DataTableBody>
        {members.map((member) => (
          <DataTableRow key={member.id}>
            <DataTableCell className="col-start-1 row-start-1 min-w-0 font-medium whitespace-normal">
              {member.name}
            </DataTableCell>
            <DataTableCell className="col-start-1 row-start-2 min-w-0 text-muted-foreground whitespace-normal">
              {member.email}
            </DataTableCell>
            <DataTableCell className="col-start-2 row-start-1 justify-self-end">
              {canChangeRoles && member.userId !== currentUserId ? (
                <RoleSelect
                  role={member.role}
                  memberName={member.name}
                  onRoleChange={(newRole) =>
                    void updateRoleAction({
                      data: {
                        memberId: member.id,
                        role: newRole,
                      },
                    }).catch(() => undefined)
                  }
                  isPending={updateRoleAction.isPending}
                />
              ) : (
                <RoleBadge role={member.role} rawRole={member.rawRole} />
              )}
            </DataTableCell>
            {canManageMembers ? (
              <DataTableCell className="col-start-2 row-start-2 justify-self-end @3xl:text-right">
                {canRemove && member.userId !== currentUserId ? (
                  <RemoveMemberDialog
                    memberName={member.name}
                    memberEmail={member.email}
                    onRemove={() => removeMemberAction({ data: { memberId: member.id } })}
                  />
                ) : null}
              </DataTableCell>
            ) : null}
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  )
}
