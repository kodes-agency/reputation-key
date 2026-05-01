// Members — manage organization members, invite, change roles, remove
// Adapted from settings/members.tsx to fit the new sidebar layout.

import { createFileRoute } from '@tanstack/react-router'
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
import { hasRole } from '#/shared/domain/roles'
import { MemberTable } from '#/components/features/identity/MemberTable'
import { InvitationTable } from '#/components/features/identity/InvitationTable'
import { InviteMemberForm } from '#/components/features/identity/InviteMemberForm'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Separator } from '#/components/ui/separator'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/members')({
  loader: async () => {
    const [{ properties }, { members }, { invitations }] = await Promise.all([
      listProperties(),
      listMembers(),
      listInvitations(),
    ])
    return { properties, members, invitations }
  },
  component: MembersPage,
})

function MembersPage() {
  const ctx = Route.useRouteContext()
  const currentUserId = ctx.user.id
  const role = ctx.role ?? 'Staff'
  const canInvite = hasRole(role, 'PropertyManager')
  const { properties, members, invitations } = Route.useLoaderData()

  const [inviteOpen, setInviteOpen] = useState(false)

  const updateRole = useMutationAction(updateMemberRole, {
    successMessage: 'Role updated',
  })
  const removeMemberFn = useMutationAction(removeMember, {
    successMessage: 'Member removed',
  })
  const inviteMemberFn = useMutationAction(inviteMember, {
    successMessage: 'Invitation sent',
    onSuccess: async () => {
      setInviteOpen(false)
    },
  })
  const cancelInvite = useMutationAction(cancelInvitation, {
    successMessage: 'Invitation cancelled',
  })
  const resendInvite = useMutationAction(resendInvitation, {
    successMessage: 'Invitation email resent',
    invalidate: false,
  })

  const propertyOptions = properties.map((p) => ({
    id: p.id,
    name: p.name,
  }))
  const pendingInvitations = invitations.filter(
    (inv: { status: string }) => inv.status === 'pending',
  )

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your organization's members, roles, and invitations.
          </p>
        </div>
        {canInvite && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus /> Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite a new member</DialogTitle>
                <DialogDescription>
                  Send an invitation by email. They'll receive a link to join your
                  organization.
                </DialogDescription>
              </DialogHeader>
              <InviteMemberForm
                mutation={inviteMemberFn}
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

      <MemberTable
        members={members}
        currentUserId={currentUserId}
        viewerRole={role}
        updateRoleAction={updateRole}
        removeMemberAction={removeMemberFn}
      />

      {canInvite && pendingInvitations.length > 0 && (
        <>
          <Separator />
          <InvitationTable
            invitations={pendingInvitations}
            viewerRole={role}
            resendAction={resendInvite}
            cancelAction={cancelInvite}
          />
        </>
      )}
    </div>
  )
}
