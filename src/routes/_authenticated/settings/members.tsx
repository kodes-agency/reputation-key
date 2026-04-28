// Members page — manage organization members, invite, change roles, remove
// P0 gap: This is the primary UI for organization member management.

import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listMembers,
  listInvitations,
  inviteMember,
  updateMemberRole,
  removeMember,
  cancelInvitation,
  resendInvitation,
} from '#/contexts/identity/server/organizations'
import { listProperties } from '#/contexts/property/server/properties'
import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { Skeleton } from '#/components/ui/skeleton'
import { Separator } from '#/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { InviteMemberForm } from '#/components/features/identity/InviteMemberForm'
import { UserPlus, Shield, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useState } from 'react'

export const Route = createFileRoute('/_authenticated/settings/members')({
  component: MembersPage,
})

function MembersPage() {
  const ctx =
    Route.useRouteContext() as import('#/routes/_authenticated').AuthRouteContext
  const currentUserId = ctx.user.id
  const role = ctx.role ?? 'Staff'
  const canChangeRoles = can(role, 'member.update')
  const canInvite = can(role, 'invitation.create')
  const canRemove = can(role, 'member.delete')
  const canManageMembers = canChangeRoles || canInvite || canRemove

  // Properties for the invite form's assignment multi-select
  const propertiesQuery = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const result = await listProperties()
      return result.properties
    },
  })
  const propertyOptions = (propertiesQuery.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
  }))

  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)

  const membersQuery = useQuery({
    queryKey: ['org-members'],
    queryFn: () => listMembers(),
  })

  const invitationsQuery = useQuery({
    queryKey: ['org-invitations'],
    queryFn: () => listInvitations(),
  })

  const updateRoleMutation = useMutation({
    mutationFn: (input: {
      memberId: string
      role: 'AccountAdmin' | 'PropertyManager' | 'Staff'
    }) => updateMemberRole({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org-members'] })
      toast.success(`Role updated to ${roleLabel(variables.role)}`)
    },
    onError: (error) => {
      toast.error('Failed to update role', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => removeMember({ data: { memberId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members'] })
      toast.success('Member removed')
    },
    onError: (error) => {
      toast.error('Failed to remove member', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const inviteMutation = useMutation({
    mutationFn: (input: {
      email: string
      role: 'AccountAdmin' | 'PropertyManager' | 'Staff'
    }) => inviteMember({ data: input }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['org-invitations'] })
      setInviteOpen(false)
      toast.success(`Invitation sent to ${variables.email}`)
    },
  })

  const cancelInviteMutation = useMutation({
    mutationFn: (invitationId: string) => cancelInvitation({ data: { invitationId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-invitations'] })
      toast.success('Invitation cancelled')
    },
    onError: (error) => {
      toast.error('Failed to cancel invitation', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const resendInviteMutation = useMutation({
    mutationFn: (invitationId: string) => resendInvitation({ data: { invitationId } }),
    onSuccess: () => {
      toast.success('Invitation email resent')
    },
    onError: (error) => {
      toast.error('Failed to resend invitation', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const members = membersQuery.data?.members ?? []
  const invitations = invitationsQuery.data?.invitations ?? []

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <Card className="island-shell rise-in rounded-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Users />
                Members
              </CardTitle>
              <CardDescription>
                Manage your organization&apos;s members, roles, and invitations.
              </CardDescription>
            </div>
            {canInvite && (
              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <UserPlus />
                    Invite Member
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invite a new member</DialogTitle>
                    <DialogDescription>
                      Send an invitation by email. They&apos;ll receive a link to join
                      your organization.
                    </DialogDescription>
                  </DialogHeader>
                  <InviteMemberForm
                    mutation={inviteMutation}
                    allowedRoles={
                      role === 'AccountAdmin'
                        ? (['AccountAdmin', 'PropertyManager', 'Staff'] as const)
                        : (['Staff'] as const)
                    }
                    properties={propertyOptions}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {/* Members list */}
          {membersQuery.isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  {canManageMembers && (
                    <TableHead className="text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{member.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.email}
                    </TableCell>
                    <TableCell>
                      {canChangeRoles && member.userId !== currentUserId ? (
                        <Select
                          value={member.role}
                          onValueChange={(newRole) =>
                            updateRoleMutation.mutate({
                              memberId: member.id,
                              role: newRole as
                                | 'AccountAdmin'
                                | 'PropertyManager'
                                | 'Staff',
                            })
                          }
                          disabled={updateRoleMutation.isPending}
                        >
                          <SelectTrigger className="w-[160px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="AccountAdmin">Account Admin</SelectItem>
                              <SelectItem value="PropertyManager">
                                Property Manager
                              </SelectItem>
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
                                organization. They will lose access to all properties and
                                teams.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => removeMemberMutation.mutate(member.id)}
                                disabled={removeMemberMutation.isPending}
                                className="bg-destructive text-white hover:bg-destructive/90"
                              >
                                {removeMemberMutation.isPending
                                  ? 'Removing…'
                                  : 'Remove member'}
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
          )}

          {/* Pending invitations */}
          {canInvite && invitations.length > 0 && (
            <>
              <Separator className="my-6" />
              <div className="flex flex-col gap-4">
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <Shield />
                  Pending Invitations
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      {canManageMembers && (
                        <TableHead className="text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.email}</TableCell>
                        <TableCell>
                          <RoleBadge role={inv.role} />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{inv.status}</Badge>
                        </TableCell>
                        {canManageMembers && inv.status === 'pending' && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={resendInviteMutation.isPending}
                                onClick={() => resendInviteMutation.mutate(inv.id)}
                              >
                                Resend
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                  >
                                    Cancel
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Cancel invitation to {inv.email}?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      The invitation link will no longer work. You can
                                      always send a new invitation later.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Keep invitation</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => cancelInviteMutation.mutate(inv.id)}
                                      disabled={cancelInviteMutation.isPending}
                                      className="bg-destructive text-white hover:bg-destructive/90"
                                    >
                                      {cancelInviteMutation.isPending
                                        ? 'Cancelling…'
                                        : 'Cancel invitation'}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function RoleBadge({ role }: { role: Role }) {
  const variant =
    role === 'AccountAdmin'
      ? 'default'
      : role === 'PropertyManager'
        ? 'secondary'
        : 'outline'
  return <Badge variant={variant}>{roleLabel(role)}</Badge>
}

function roleLabel(role: Role): string {
  switch (role) {
    case 'AccountAdmin':
      return 'Admin'
    case 'PropertyManager':
      return 'Manager'
    case 'Staff':
      return 'Staff'
  }
}
