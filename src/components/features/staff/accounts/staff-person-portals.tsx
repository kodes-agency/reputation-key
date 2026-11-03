import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { QrCode } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { DescriptionList, DescriptionItem } from '#/components/ui/description-list'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { identityKeys, portalKeys } from '#/shared/queries/query-keys'
import type { Action } from '#/components/hooks/use-action'
import { useStaffAccounts } from './staff-accounts-context'
import { useStaffFunctions } from './staff-account-functions'
import {
  StaffPersonGroup,
  StaffPersonTarget,
  StaffPersonValue,
} from './staff-person-group'
import type { StaffMember } from './staff-account-view'

export function StaffPersonPortals({
  member,
  move,
}: Readonly<{ member: StaffMember; move: Action<string> }>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const accounts = useStaffAccounts()!
  if (!member.portalId || !can('portal.read') || !has('portal.read')) return null
  const params = { propertyId: accounts.propertyId, portalId: member.portalId }
  return (
    <div className="space-y-4">
      <DescriptionList>
        <StaffPersonGroup member={member} move={move} />
        <StaffPersonTarget member={member} />
        {can('member.list') ? <StaffPersonManagers member={member} /> : null}
        <DescriptionItem term="Code">
          <StaffPersonValue>
            <QrCode aria-hidden className="size-5" />
            <Button asChild variant="link" size="inline" touch>
              <Link
                to="/properties/$propertyId/portals/$portalId"
                params={params}
                search={{ tab: 'share' }}
              >
                View and print
              </Link>
            </Button>
          </StaffPersonValue>
        </DescriptionItem>
        <StaffPersonGuestPage member={member} />
      </DescriptionList>
    </div>
  )
}

function StaffPersonManagers({ member }: Readonly<{ member: StaffMember }>) {
  const functions = useStaffFunctions()
  const managers = useQuery({
    queryKey: portalKeys.responsibleManagers(member.portalId!),
    queryFn: () =>
      functions.listPortalResponsibleManagers({ data: { portalId: member.portalId! } }),
  })
  const members = useQuery({
    queryKey: identityKeys.members(),
    queryFn: () => functions.listMembers(),
  })
  let text = 'Loading…'
  if (managers.isError || members.isError) text = 'Manager names unavailable'
  if (managers.isSuccess && members.isSuccess) {
    const names = managers.data.assignments.map(
      (assignment) =>
        members.data.members.find((manager) => manager.userId === assignment.userId)
          ?.name,
    )
    text = names.length
      ? names.every(Boolean)
        ? names.join(', ')
        : 'Manager names unavailable'
      : 'No responsible manager'
  }
  return (
    <DescriptionItem term="Guest notes go to">
      <StaffPersonValue>
        <span>{text}</span>
        <PortalPageLink portalId={member.portalId!}>Change</PortalPageLink>
      </StaffPersonValue>
      <FormErrorBanner error={managers.error ?? members.error} />
    </DescriptionItem>
  )
}
/** A way to the person's guest page, for a manager who may change it. */
function PortalPageLink({
  portalId,
  children,
}: Readonly<{ portalId: string; children: string }>) {
  const accounts = useStaffAccounts()!
  const { can } = usePermissions()
  const { has } = useCapabilities()
  if (!can('portal.update') || !has('portal.write')) return null
  return (
    <Button asChild variant="link" size="inline" touch>
      <Link
        to="/properties/$propertyId/portals/$portalId"
        params={{ propertyId: accounts.propertyId, portalId }}
        search={{ tab: 'page' }}
      >
        {children}
      </Link>
    </Button>
  )
}

function StaffPersonGuestPage({ member }: Readonly<{ member: StaffMember }>) {
  const functions = useStaffFunctions()
  const accounts = useStaffAccounts()!
  const portals = useQuery({
    queryKey: portalKeys.list(accounts.propertyId),
    queryFn: () => functions.listPortals({ data: { propertyId: accounts.propertyId } }),
  })
  const portal = portals.data?.portals.find((row) => row.id === member.portalId)
  let text = 'Loading…'
  if (portals.isError) text = 'Unavailable'
  if (portals.isSuccess) text = pageState(portal?.publicationState)
  return (
    <DescriptionItem term="Guest page">
      <StaffPersonValue>
        <span>{text}</span>
        <PortalPageLink portalId={member.portalId!}>Edit</PortalPageLink>
      </StaffPersonValue>
      <FormErrorBanner error={portals.error} />
    </DescriptionItem>
  )
}
function pageState(state: string | undefined): string {
  if (!state) return 'Unavailable'
  if (state === 'published') return 'Live'
  return state === 'draft' ? 'Draft' : 'Paused'
}
