// Settings → Members: invite users, change roles, remove members, and manage
// pending invitations. Restores the member-directory UI (InviteMemberForm,
// MemberTable, InvitationTable) that was orphaned when the original route was
// dropped during a refactor. All actions are permission-gated; the components
// also check permissions internally (defense in depth).

import { useState } from 'react'
import { toast } from 'sonner'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { PageHeader } from '#/components/layout/page-header'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
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
  getSelfServiceLeaveAvailabilityFn,
  leaveOrganizationFn,
} from '#/contexts/identity/server/organization-leave-fns'
import { outstandingResponsibilitiesQuery } from './-leave-organization-queries'

const authRoute = getRouteApi('/_authenticated')
const membersQuery = queryOptions({
  queryKey: identityKeys.members(),
  queryFn: () => listMembers(),
  staleTime: 30_000,
})

const invitationsQuery = queryOptions({
  queryKey: identityKeys.organizationInvitations(),
  queryFn: () => listInvitations(),
  staleTime: 30_000,
})

export const Route = createFileRoute('/_authenticated/settings/members')({
  staticData: { page: { title: 'Members', under: 'settings' } },
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'member.list')) throw roleUnavailable('Members', 'profile')
  },
  loader: async ({ context }) => {
    const { role } = context as AuthRouteContext
    const [memberResult, invitationsResult, leaveAvailability] = await Promise.all([
      context.queryClient.ensureQueryData(membersQuery),
      context.queryClient.ensureQueryData(invitationsQuery),
      // Whether self-service leave is composed at all. When it is not, the
      // worklist read is never issued and the page says why.
      getSelfServiceLeaveAvailabilityFn(),
    ])
    // An inviter may only assign roles at or below their own privilege level.
    const allowedRoles: ReadonlyArray<BetaInteractiveRole> = hasRole(role, 'AccountAdmin')
      ? ['AccountAdmin', 'PropertyManager']
      : ['PropertyManager']
    return {
      members: memberResult.members,
      invitations: invitationsResult.invitations,
      allowedRoles,
      selfServiceLeaveAvailable: leaveAvailability.available,
    }
  },
  // Members/invitations change only on mutation; refetch on invalidation.
  staleTime: 30_000,
  component: MembersSettingsRoute,
})

const INVITATION_EMAIL_UNSENT =
  'Invitation created, but the email could not be sent. Use Resend.'
const RENEWAL_EMAIL_UNSENT =
  'Invitation renewed, but the email could not be sent. Try Resend again.'

function MembersSettingsRoute() {
  const { allowedRoles, selfServiceLeaveAvailable } = Route.useLoaderData()
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
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
    onSuccess: async ({ emailSent }) => {
      // The invitation exists either way; an unsent email is renewed by Resend.
      if (emailSent) toast.success('Invitation sent')
      else toast.warning(INVITATION_EMAIL_UNSENT)
      setInviteOpen(false)
    },
  })
  // The tables have no inline error surface, so these report a refusal (the
  // resend rate limit, the last Account Admin) by toast. The invite form shows
  // its own banner, so inviteMutation does not: that would report it twice.
  const updateRoleMutation = useActionMutation(updateMemberRole, {
    successMessage: 'Role updated',
    errorMessage: actionErrorMessage,
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
  })
  const removeMemberMutation = useActionMutation(removeMember, {
    successMessage: 'Member removed',
    errorMessage: actionErrorMessage,
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
  })
  const resendMutation = useActionMutation(resendInvitation, {
    errorMessage: actionErrorMessage,
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
    onSuccess: async ({ emailSent }) => {
      if (emailSent) toast.success('Invitation resent')
      else toast.warning(RENEWAL_EMAIL_UNSENT)
    },
  })
  const cancelMutation = useActionMutation(cancelInvitation, {
    successMessage: 'Invitation cancelled',
    errorMessage: actionErrorMessage,
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
  })
  // NOT useSuspenseQuery. The identity container installs a fail-closed
  // offboarding dependency until the responsibility facts are composed, so
  // this read THROWS by design. Suspending the route on it meant one deliberately
  // fenced capability took down the whole members page — the directory,
  // invitations and role management with it — which is what the accessibility
  // and shell suites caught on /settings/members. Where nothing is composed it
  // is not issued at all (`selfServiceLeaveAvailable` is false).
  //
  // `undefined` (still loading) and an error both surface as a null worklist,
  // which the dialog treats as "unknown" and refuses to leave on.
  const { data: outstandingResult, isError: outstandingUnavailable } = useQuery(
    outstandingResponsibilitiesQuery(selfServiceLeaveAvailable),
  )
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
                  <Plus />
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
            selfServiceLeaveAvailable={selfServiceLeaveAvailable}
            leaveOrganization={leaveMutation}
          />
        </section>
      </div>
    </>
  )
}
