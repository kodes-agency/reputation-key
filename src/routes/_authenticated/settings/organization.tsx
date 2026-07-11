import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  getActiveOrganization,
  listUserOrganizations,
  updateOrganization,
  requestOrgLogoUpload,
  finalizeOrgLogoUpload,
  setActiveOrganization,
} from '#/contexts/identity/server/organizations'
import {
  getOrgResponseSlaFn,
  updateOrgResponseSlaFn,
} from '#/contexts/identity/server/organizations.response-sla'
import { OrganizationSettingsPage } from '#/components/features/organization'
import { identityKeys } from '#/shared/queries/query-keys'

const activeOrgQuery = queryOptions({
  queryKey: identityKeys.activeOrg(),
  queryFn: () => getActiveOrganization(),
  staleTime: 60_000,
})

const organizationsQuery = queryOptions({
  queryKey: identityKeys.organizations(),
  queryFn: () => listUserOrganizations(),
  staleTime: 60_000,
})

const responseSlaQuery = queryOptions({
  queryKey: identityKeys.responseSla(),
  queryFn: () => getOrgResponseSlaFn(),
  staleTime: 60_000,
})

export const Route = createFileRoute('/_authenticated/settings/organization')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'organization.update')) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  loader: async ({ context }) => {
    const [orgResult, orgsResult, slaResult] = await Promise.all([
      context.queryClient.ensureQueryData(activeOrgQuery),
      context.queryClient.ensureQueryData(organizationsQuery),
      context.queryClient.ensureQueryData(responseSlaQuery),
    ])
    return {
      organization: orgResult.organization,
      organizations: orgsResult.organizations,
      activeOrganizationId: orgResult.organization?.id ?? null,
      responseSlaHours: slaResult.responseSlaHours,
    }
  },
  // Organization settings rarely change — refetch only on explicit invalidation.
  staleTime: 60_000,
  component: OrganizationSettingsRoute,
})

function OrganizationSettingsRoute() {
  const { data: orgResult } = useSuspenseQuery(activeOrgQuery)
  const { data: orgsResult } = useSuspenseQuery(organizationsQuery)
  const { data: slaResult } = useSuspenseQuery(responseSlaQuery)
  const organization = orgResult.organization
  const organizations = orgsResult.organizations
  const activeOrganizationId = organization?.id ?? null
  const responseSlaHours = slaResult.responseSlaHours
  const updateResponseSla = useActionMutation(updateOrgResponseSlaFn, {
    successMessage: 'Response SLA updated',
    invalidateKeys: [identityKeys.responseSla(), identityKeys.activeOrg()],
  })

  return (
    <>
      <PageHeader
        title="Organization"
        description="Manage your organization's identity and billing."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Organization' }]}
      />
      {organization ? (
        <OrganizationSettingsPage
          organization={organization}
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
          responseSlaHours={responseSlaHours}
          updateResponseSla={updateResponseSla}
          updateOrganizationFn={updateOrganization}
          requestOrgLogoUploadFn={requestOrgLogoUpload}
          finalizeOrgLogoUploadFn={finalizeOrgLogoUpload}
          setActiveOrganizationFn={setActiveOrganization}
        />
      ) : (
        <div className="text-center text-sm text-muted-foreground py-12">
          No active organization found.
        </div>
      )}
    </>
  )
}
