// Settings → Members: who can sign in to the Organization, what they can do and
// which properties they work. AccountAdmins invite people, change roles, edit a
// Property Manager's properties and remove members; a Property Manager only
// reads the list. Every action is permission-gated here and again inside the
// components and on the server (defense in depth).

import { SectionTitle } from '#/components/ui/section-title'
import { useState } from 'react'
import { toast } from 'sonner'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { AddAction } from '#/components/ui/add-action'
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
  listMemberPropertyAccess,
  resendInvitation,
  cancelInvitation,
} from '#/contexts/identity/server/organizations'
import {
  ChangeRoleDialog,
  InviteMemberForm,
  MemberTable,
  InvitationTable,
  memberRowsWithProperties,
  propertyIdsByUser,
} from '#/components/features/identity'
import type { MemberRow } from '#/components/features/identity'
import { identityKeys } from '#/shared/queries/query-keys'
import { propertiesQuery } from '#/routes/-queries/route-queries'
import { getSelfServiceLeaveAvailabilityFn } from '#/contexts/identity/server/organization-leave-fns'
import { LeaveOrganizationSection } from './-leave-organization-section'
import { MemberAccessContainer } from './-member-access-container'

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

// Every member's active Property grants. Below identityKeys.members(), so any
// mutation that invalidates the member list refreshes it too.
const memberPropertyAccessQuery = queryOptions({
  queryKey: identityKeys.memberPropertyAccess(),
  queryFn: () => listMemberPropertyAccess(),
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
    // Each read is issued only for a role the server would answer: a Property
    // Manager reads the member list and nothing about invitations or grants.
    const [, leaveAvailability] = await Promise.all([
      context.queryClient.ensureQueryData(membersQuery),
      // Whether self-service leave is composed at all. When it is not, the
      // worklist read is never issued and the section is not drawn.
      getSelfServiceLeaveAvailabilityFn(),
      can(role, 'invitation.list')
        ? context.queryClient.ensureQueryData(invitationsQuery)
        : null,
      can(role, 'member.update')
        ? context.queryClient.ensureQueryData(memberPropertyAccessQuery)
        : null,
    ])
    // An inviter may only assign roles at or below their own privilege level.
    // The safe role comes first: an invitation starts as a Property Manager.
    const allowedRoles: ReadonlyArray<BetaInteractiveRole> = hasRole(role, 'AccountAdmin')
      ? ['PropertyManager', 'AccountAdmin']
      : ['PropertyManager']
    return {
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
  const { user, role, reportUnexpectedFailure } = authRoute.useRouteContext()
  const { can: canDo } = usePermissions()
  // Invitations and grants are read only by the roles the server answers; the
  // loader primed both caches for an AccountAdmin, so these hit without a fetch.
  const { data: invitationsResult } = useQuery({
    ...invitationsQuery,
    enabled: canDo('invitation.list'),
  })
  const { data: accessResult } = useQuery({
    ...memberPropertyAccessQuery,
    enabled: canDo('member.update'),
  })
  const { data: propsData } = useSuspenseQuery(propertiesQuery)
  const members = memberResult.members
  const invitations = invitationsResult?.invitations ?? []
  const propertyOptions = propsData.properties.map((p) => ({
    id: String(p.id),
    name: p.name,
  }))
  const memberRows = memberRowsWithProperties(
    members,
    accessResult?.access,
    propertyOptions,
  )
  const [inviteOpen, setInviteOpen] = useState(false)
  const [roleTarget, setRoleTarget] = useState<MemberRow | null>(null)
  const [accessTarget, setAccessTarget] = useState<MemberRow | null>(null)

  const inviteMutation = useActionMutation(inviteMember, {
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
    onSuccess: async ({ emailSent }) => {
      // The invitation exists either way; an unsent email is renewed by Resend.
      if (emailSent) toast.success('Invitation sent')
      else toast.warning(INVITATION_EMAIL_UNSENT)
      setInviteOpen(false)
    },
  })
  // A resend has no inline error surface, so it reports a refusal (the resend
  // rate limit) by toast. The invite form, and the Change role, Remove and Cancel
  // invitation confirmations, stay open and show their own banner, so those
  // mutations do not: that would report it twice.
  const updateRoleMutation = useActionMutation(updateMemberRole, {
    successMessage: 'Role updated',
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
  })
  const removeMemberMutation = useActionMutation(removeMember, {
    successMessage: 'Member removed',
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
  })
  const resendMutation = useActionMutation(resendInvitation, {
    errorMessage: actionErrorMessage,
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
    onSuccess: async ({ emailSent }) => {
      if (emailSent) toast.success('Invitation renewed and sent')
      else toast.warning(RENEWAL_EMAIL_UNSENT)
    },
  })
  const cancelMutation = useActionMutation(cancelInvitation, {
    successMessage: 'Invitation cancelled',
    invalidateKeys: [identityKeys.members(), identityKeys.invitations()],
  })
  return (
    <>
      <PageHeader
        title="Members"
        description="Invite people, manage their roles and the properties they can work."
        breadcrumbs={trailCrumbs('settings', {}, 'Members')}
        actions={
          canDo('invitation.create') && hasRole(role, 'AccountAdmin') ? (
            <Dialog
              open={inviteOpen}
              busy={inviteMutation.isPending}
              onOpenChange={setInviteOpen}
            >
              <DialogTrigger asChild>
                <AddAction>Invite member</AddAction>
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
          <SectionTitle className="mb-3">Members</SectionTitle>
          <MemberTable
            members={memberRows}
            currentUserId={user.id}
            showProperties={accessResult !== undefined}
            onChangeRole={setRoleTarget}
            onEditAccess={setAccessTarget}
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

        {selfServiceLeaveAvailable && (
          <LeaveOrganizationSection
            members={members}
            currentUserId={user.id}
            role={role}
          />
        )}
      </div>

      <ChangeRoleDialog
        member={roleTarget}
        onClose={() => setRoleTarget(null)}
        allowedRoles={allowedRoles}
        updateRoleAction={updateRoleMutation}
      />
      <MemberAccessContainer
        member={accessTarget}
        onClose={() => setAccessTarget(null)}
        properties={propertyOptions}
        propertyIdsByUser={propertyIdsByUser(accessResult?.access)}
        canRemove={canDo('member.delete')}
        removeMemberAction={removeMemberMutation}
        reportFailure={reportUnexpectedFailure}
      />
    </>
  )
}
