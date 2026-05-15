/**
 * MemberTable — extracted from settings/members.tsx route.
 * Displays org members with inline role select and remove action.
 */

import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type { Action } from '#/components/hooks/use-action'
import { EmptyState } from '#/components/ui/empty-state'
import { Contact } from 'lucide-react'
import { RemoveMemberDialog } from './remove-member-dialog'
import { RoleSelect } from './role-select'

export interface MemberRow {
  id: string
  userId: string
  name: string
  email: string
  role: Role
}

type Props = Readonly<{
  members: ReadonlyArray<MemberRow>
  currentUserId: string
  viewerRole: Role
  updateRoleAction: Action<{
    data: {
      memberId: string
      role: 'AccountAdmin' | 'PropertyManager' | 'Staff'
    }
  }>
  removeMemberAction: Action<{ data: { memberId: string } }>
}>

export function MemberTable({
  members,
  currentUserId,
  viewerRole,
  updateRoleAction,
  removeMemberAction,
}: Props) {
  const canChangeRoles = can(viewerRole, 'member.update')
  const canRemove = can(viewerRole, 'member.delete')
  const canManageMembers = canChangeRoles || canRemove

  if (members.length === 0) {
    return (
      <EmptyState icon={Contact} title="No members">
        <p className="text-sm text-muted-foreground">
          Invite members to your organization using the button above.
        </p>
      </EmptyState>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          {canManageMembers && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id}>
            <TableCell className="font-medium">{member.name}</TableCell>
            <TableCell className="text-muted-foreground">{member.email}</TableCell>
            <TableCell>
              {canChangeRoles && member.userId !== currentUserId ? (
                <RoleSelect
                  role={member.role}
                  onRoleChange={(newRole) =>
                    updateRoleAction({
                      data: {
                        memberId: member.id,
                        role: newRole,
                      },
                    })
                  }
                  isPending={updateRoleAction.isPending}
                />
              ) : (
                <RoleBadge role={member.role} />
              )}
            </TableCell>
            <TableCell className="text-right">
              {canRemove && member.userId !== currentUserId && (
                <RemoveMemberDialog
                  memberName={member.name}
                  memberEmail={member.email}
                  onRemove={() => removeMemberAction({ data: { memberId: member.id } })}
                  isPending={removeMemberAction.isPending}
                />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
