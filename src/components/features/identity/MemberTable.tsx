/**
 * MemberTable — extracted from settings/members.tsx route.
 * Displays org members with inline role select and remove action.
 */

import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { RoleBadge } from '#/components/features/identity/RoleBadge'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
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

// fallow-ignore-next-line unused-type
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
                <Select
                  value={member.role}
                  onValueChange={(newRole) =>
                    updateRoleAction({
                      data: {
                        memberId: member.id,
                        role: newRole as 'AccountAdmin' | 'PropertyManager' | 'Staff',
                      },
                    })
                  }
                  disabled={updateRoleAction.isPending}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="AccountAdmin">Account Admin</SelectItem>
                      <SelectItem value="PropertyManager">Property Manager</SelectItem>
                      <SelectItem value="Staff">Staff</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <RoleBadge role={member.role} />
              )}
            </TableCell>
            <TableCell className="text-right">
              {canRemove && member.userId !== currentUserId && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                    >
                      Remove
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove {member.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove {member.name} ({member.email}) from your
                        organization. They will lose access to all properties and teams.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          removeMemberAction({
                            data: { memberId: member.id },
                          })
                        }
                        disabled={removeMemberAction.isPending}
                        className="bg-destructive text-white hover:bg-destructive/90"
                      >
                        {removeMemberAction.isPending ? 'Removing…' : 'Remove member'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
