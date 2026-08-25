import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  getActiveOrganization,
  updateOrganization,
  requestOrgLogoUpload,
  finalizeOrgLogoUpload,
} from '#/contexts/identity/server/organizations'
import {
  getOrgResponseSlaFn,
  updateOrgResponseSlaFn,
} from '#/contexts/identity/server/organizations.response-sla'
import { OrganizationSettingsPage } from '#/components/features/organization'
import { organizationCachePolicy } from '#/components/features/organization/organization-cache-policy'
import { identityKeys } from '#/shared/queries/query-keys'

const activeOrgQuery = queryOptions({
  queryKey: identityKeys.activeOrg(),
  queryFn: () => getActiveOrganization(),
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
    const [orgResult, slaResult] = await Promise.all([
      context.queryClient.ensureQueryData(activeOrgQuery),
      context.queryClient.ensureQueryData(responseSlaQuery),
    ])
    return {
      organization: orgResult.organization,
      responseSlaHours: slaResult.responseSlaHours,
    }
  },
  // Organization settings rarely change — refetch only on explicit invalidation.
  staleTime: 60_000,
  component: OrganizationSettingsRoute,
})

function OrganizationSettingsRoute() {
  const queryClient = useQueryClient()
  const { data: orgResult } = useSuspenseQuery(activeOrgQuery)
  const { data: slaResult } = useSuspenseQuery(responseSlaQuery)
  const organization = orgResult.organization
  const responseSlaHours = slaResult.responseSlaHours
  const updateResponseSla = useActionMutation(updateOrgResponseSlaFn, {
    successMessage: 'Response SLA updated',
    invalidateKeys: [identityKeys.responseSla(), identityKeys.activeOrg()],
  })
  const updateOrganizationAction = useActionMutation(updateOrganization, {
    onSuccess: () => organizationCachePolicy.onOrganizationUpdated(queryClient),
  })

  return (
    <>
      <PageHeader
        title="Organization"
        description="Manage your organization's identity and response settings."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Organization' }]}
      />
      {organization ? (
        <OrganizationSettingsPage
          organization={organization}
          responseSlaHours={responseSlaHours}
          updateResponseSla={updateResponseSla}
          updateOrganization={updateOrganizationAction}
          requestOrgLogoUploadFn={requestOrgLogoUpload}
          finalizeOrgLogoUploadFn={finalizeOrgLogoUpload}
        />
      ) : (
        <div className="text-center text-sm text-muted-foreground py-12">
          No active organization found.
        </div>
      )}
    </>
  )
}
