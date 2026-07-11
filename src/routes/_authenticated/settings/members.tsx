// Settings → Members: invite users, change roles, remove members, and manage
// pending invitations. Restores the member-directory UI (InviteMemberForm,
// MemberTable, InvitationTable) that was orphaned when the original route was
// dropped during a refactor. All actions are permission-gated; the components
// also check permissions internally (defense in depth).

import { useState } from 'react'
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import type { Role } from '#/shared/domain/roles'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import {
  listMembers,
  inviteMember,
  updateMemberRole,
  removeMember,
  listInvitations,
  resendInvitation,
  cancelInvitation,
} from '#/contexts/identity/server/organizations'
import {
  InviteMemberForm,
  MemberTable,
  InvitationTable,
} from '#/components/features/identity'
import { identityKeys } from '#/shared/queries/query-keys'
import { propertiesQuery } from '#/shared/queries/route-queries'

const authRoute = getRouteApi('/_authenticated')
const membersQuery = queryOptions({
  queryKey: identityKeys.members(),
  queryFn: () => listMembers(),
  staleTime: 30_000,
})

const invitationsQuery = queryOptions({
  queryKey: identityKeys.invitations(),
  queryFn: () => listInvitations(),
  staleTime: 30_000,
})

export const Route = createFileRoute('/_authenticated/settings/members')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'member.list')) throw redirect({ to: '/settings/profile' })
  },
  loader: async ({ context }) => {
    const { role } = context as AuthRouteContext
    const [memberResult, invitationsResult] = await Promise.all([
      context.queryClient.ensureQueryData(membersQuery),
      context.queryClient.ensureQueryData(invitationsQuery),
    ])
    // An inviter may only assign roles at or below their own privilege level.
    const allowedRoles: ReadonlyArray<Role> = hasRole(role, 'AccountAdmin')
      ? ['AccountAdmin', 'PropertyManager', 'Staff']
      : ['PropertyManager', 'Staff']
    return {
      members: memberResult.members,
      invitations: invitationsResult.invitations,
      allowedRoles,
    }
  },
  // Members/invitations change only on mutation; refetch on invalidation.
  staleTime: 30_000,
  component: MembersSettingsRoute,
})

function MembersSettingsRoute() {
  const { allowedRoles } = Route.useLoaderData()
  const { data: memberResult } = useSuspenseQuery(membersQuery)
  const { data: invitationsResult } = useSuspenseQuery(invitationsQuery)
  const members = memberResult.members
  const invitations = invitationsResult.invitations
  const { user } = authRoute.useRouteContext()
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const properties = propsData.properties
  const { can: canDo } = usePermissions()
  const [inviteOpen, setInviteOpen] = useState(false)

  const inviteMutation = useActionMutation(inviteMember, {
    successMessage: 'Invitation sent',
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
    onSuccess: async () => setInviteOpen(false),
  })
  const updateRoleMutation = useActionMutation(updateMemberRole, {
    successMessage: 'Role updated',
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
  })
  const removeMemberMutation = useActionMutation(removeMember, {
    successMessage: 'Member removed',
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
  })
  const resendMutation = useActionMutation(resendInvitation, {
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
  })
  const cancelMutation = useActionMutation(cancelInvitation, {
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
  })

  const propertyOptions = properties.map((p) => ({ id: String(p.id), name: p.name }))

  return (
    <>
      <PageHeader
        title="Members"
        description="Invite people to your organization and manage their roles."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Members' }]}
        actions={
          canDo('invitation.create') ? (
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" />
                  Invite member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite a new member</DialogTitle>
                  <DialogDescription>
                    They'll receive an email with a link to join your organization.
                  </DialogDescription>
                </DialogHeader>
                <InviteMemberForm
                  mutation={inviteMutation}
                  allowedRoles={allowedRoles}
                  properties={propertyOptions}
                />
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <div className="mt-6 flex flex-col gap-8">
        <section>
          <h2 className="mb-3 text-base font-semibold">Members</h2>
          <MemberTable
            members={members}
            currentUserId={user.id}
            updateRoleAction={updateRoleMutation}
            removeMemberAction={removeMemberMutation}
          />
        </section>

        {invitations.length > 0 && (
          <section>
            <InvitationTable
              invitations={invitations}
              resendAction={resendMutation}
              cancelAction={cancelMutation}
            />
          </section>
        )}
      </div>
    </>
  )
}
