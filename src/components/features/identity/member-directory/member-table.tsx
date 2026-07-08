/**
 * MemberTable — extracted from settings/members.tsx route.
 * Displays org members with inline role select and remove action.
 */

import { usePermissions } from '#/shared/hooks/usePermissions'
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
  role: import('#/shared/domain/roles').Role | null
  rawRole: string
}

type Props = Readonly<{
  members: ReadonlyArray<MemberRow>
  currentUserId: string
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
  updateRoleAction,
  removeMemberAction,
}: Props) {
  const { can } = usePermissions()
  const canChangeRoles = can('member.update')
  const canRemove = can('member.delete')
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
                <RoleBadge role={member.role} rawRole={member.rawRole} />
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
