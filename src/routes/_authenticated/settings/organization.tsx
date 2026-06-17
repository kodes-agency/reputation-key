import { createFileRoute, redirect } from '@tanstack/react-router'
import { PageHeader } from '#/components/layout/page-header'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  getActiveOrganization,
  listUserOrganizations,
} from '#/contexts/identity/server/organizations'
import {
  getOrgResponseSlaFn,
  updateOrgResponseSlaFn,
} from '#/contexts/identity/server/organizations.response-sla'
import { OrganizationSettingsPage } from '#/components/features/organization'

export const Route = createFileRoute('/_authenticated/settings/organization')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'organization.update')) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  loader: async () => {
    const [orgResult, orgsResult, slaResult] = await Promise.all([
      getActiveOrganization(),
      listUserOrganizations(),
      getOrgResponseSlaFn(),
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
  const { organization, organizations, activeOrganizationId, responseSlaHours } =
    Route.useLoaderData()
  const updateResponseSla = useMutationAction(updateOrgResponseSlaFn, {
    successMessage: 'Response SLA updated',
    invalidateRoutes: ['/_authenticated/settings/organization'],
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
        />
      ) : (
        <div className="text-center text-sm text-muted-foreground py-12">
          No active organization found.
        </div>
      )}
    </>
  )
}
