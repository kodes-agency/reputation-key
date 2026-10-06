// The Members page's "Leave this organization" section: the transfer worklist
// read, the leave command and the dialog that gates it. It is drawn only where
// Identity says self-service leave is composed, so a page that cannot offer it
// shows no section at all.

import { useQuery } from '@tanstack/react-query'
import { SectionTitle } from '#/components/ui/section-title'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { LeaveOrganizationDialog } from '#/components/features/people/leave-organization-dialog'
import { leaveOrganizationFn } from '#/contexts/identity/server/organization-leave-fns'
import { hasRole, type Role } from '#/shared/domain/roles'
import { identityKeys } from '#/shared/queries/query-keys'
import { outstandingResponsibilitiesQuery } from './-leave-organization-queries'

type Props = Readonly<{
  members: ReadonlyArray<{
    userId: string
    name: string
    role: Role | null
  }>
  currentUserId: string
  /** The caller's own role. */
  role: Role
}>

export function LeaveOrganizationSection({ members, currentUserId, role }: Props) {
  // NOT useSuspenseQuery. The identity container installs a fail-closed
  // offboarding dependency until the responsibility facts are composed, so
  // this read THROWS by design. Suspending the route on it meant one deliberately
  // fenced capability took down the whole members page — the directory,
  // invitations and role management with it — which is what the accessibility
  // and shell suites caught on /settings/members. Where nothing is composed the
  // section is not mounted at all, so the read is never issued.
  //
  // `undefined` (still loading) and an error both surface as a null worklist,
  // which the dialog treats as "unknown" and refuses to leave on.
  const { data: outstandingResult, isError: outstandingUnavailable } = useQuery(
    outstandingResponsibilitiesQuery(true),
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
    .filter((member) => member.userId !== currentUserId)
    .map((member) => ({ userId: member.userId, name: member.name }))
  // `hasRole` rather than a raw role comparison: the governed helper is the
  // single place that knows how a role token maps to authority.
  const isSoleAccountAdmin =
    hasRole(role, 'AccountAdmin') &&
    members.filter(
      (member) => member.role !== null && hasRole(member.role, 'AccountAdmin'),
    ).length <= 1

  return (
    <section aria-labelledby="leave-organization-heading">
      <SectionTitle id="leave-organization-heading" className="mb-3">
        Leave this organization
      </SectionTitle>
      <LeaveOrganizationDialog
        outstanding={
          outstandingUnavailable ? null : (outstandingResult?.outstanding ?? null)
        }
        candidates={successorCandidates}
        isSoleAccountAdmin={isSoleAccountAdmin}
        selfServiceLeaveAvailable
        leaveOrganization={leaveMutation}
      />
    </section>
  )
}
