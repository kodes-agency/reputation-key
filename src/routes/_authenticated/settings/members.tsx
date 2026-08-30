// Settings → Members: invite users, change roles, remove members, and manage
// pending invitations. Restores the member-directory UI (InviteMemberForm,
// MemberTable, InvitationTable) that was orphaned when the original route was
// dropped during a refactor. All actions are permission-gated; the components
// also check permissions internally (defense in depth).

import { useState } from 'react'
import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
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
import { propertiesQuery } from '#/routes/-queries/route-queries'
import { LeaveOrganizationDialog } from '#/components/features/people/leave-organization-dialog'
import {
  leaveOrganizationFn,
  listOutstandingResponsibilitiesFn,
} from '#/contexts/identity/server/organization-leave-fns'

const authRoute = getRouteApi('/_authenticated')
const membersQuery = queryOptions({
  queryKey: identityKeys.members(),
  queryFn: () => listMembers(),
  staleTime: 30_000,
})

// LIF-01-T21: the transfer worklist a departing member must clear. Read
// separately from the member list because it is about the CALLER, not about
// the directory, and it must be fresh at the moment they open the dialog.
const outstandingResponsibilitiesQuery = queryOptions({
  queryKey: identityKeys.outstandingResponsibilities(),
  queryFn: () => listOutstandingResponsibilitiesFn(),
  staleTime: 0,
})

const invitationsQuery = queryOptions({
  queryKey: identityKeys.organizationInvitations(),
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
    const allowedRoles: ReadonlyArray<BetaInteractiveRole> = hasRole(role, 'AccountAdmin')
      ? ['AccountAdmin', 'PropertyManager']
      : ['PropertyManager']
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
  const { user, role } = authRoute.useRouteContext()
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
  // NOT useSuspenseQuery. The identity container installs a fail-closed
  // MemberOffboardingPort until the responsibility facts are composed, so this
  // read THROWS by design. Suspending the route on it meant one deliberately
  // fenced capability took down the whole members page — the directory,
  // invitations and role management with it — which is what the accessibility
  // and shell suites caught on /settings/members.
  //
  // `undefined` (still loading) and an error both surface as a null worklist,
  // which the dialog treats as "unknown" and refuses to leave on.
  const { data: outstandingResult, isError: outstandingUnavailable } = useQuery({
    ...outstandingResponsibilitiesQuery,
    retry: false,
  })
  const leaveMutation = useActionMutation(leaveOrganizationFn, {
    successMessage: 'You have left this organization',
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
    // Their session is already gone server-side; send them to sign-in rather
    // than letting the app render a workspace they no longer belong to.
    navigateTo: { to: '/login' },
  })
  // The caller cannot receive their own responsibilities, and the sole
  // AccountAdmin guard is re-enforced under lock by the command store.
  const successorCandidates = members
    .filter((member) => member.userId !== user.id)
    .map((member) => ({ userId: member.userId, name: member.name }))
  // `hasRole` rather than a raw role comparison: the governed helper is the
  // single place that knows how a role token maps to authority.
  const isSoleAccountAdmin =
    hasRole(role, 'AccountAdmin') &&
    members.filter(
      (member) => member.role !== null && hasRole(member.role, 'AccountAdmin'),
    ).length <= 1

  const propertyOptions = properties.map((p) => ({ id: String(p.id), name: p.name }))

  return (
    <>
      <PageHeader
        title="Members"
        description="Invite people to your organization and manage their roles."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Members' }]}
        actions={
          canDo('invitation.create') && hasRole(role, 'AccountAdmin') ? (
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

        <section aria-labelledby="leave-organization-heading">
          <h2 id="leave-organization-heading" className="mb-3 text-base font-semibold">
            Leave this organization
          </h2>
          <LeaveOrganizationDialog
            outstanding={
              outstandingUnavailable ? null : (outstandingResult?.outstanding ?? null)
            }
            candidates={successorCandidates}
            isSoleAccountAdmin={isSoleAccountAdmin}
            leaveOrganization={leaveMutation}
          />
        </section>
      </div>
    </>
  )
}
