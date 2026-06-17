import { createFileRoute, redirect } from '@tanstack/react-router'
import { PageHeader } from '#/components/layout/page-header'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  getActiveOrganization,
  listUserOrganizations,
} from '#/contexts/identity/server/organizations'
import { OrganizationSettingsPage } from '#/components/features/organization'

export const Route = createFileRoute('/_authenticated/settings/organization')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'organization.update')) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  loader: async () => {
    const [orgResult, orgsResult] = await Promise.all([
      getActiveOrganization(),
      listUserOrganizations(),
    ])
    return {
      organization: orgResult.organization,
      organizations: orgsResult.organizations,
      activeOrganizationId: orgResult.organization?.id ?? null,
    }
  },
  // Organization settings rarely change — refetch only on explicit invalidation.
  staleTime: 60_000,
  component: OrganizationSettingsRoute,
})

function OrganizationSettingsRoute() {
  const { organization, organizations, activeOrganizationId } = Route.useLoaderData()

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
        />
      ) : (
        <div className="text-center text-sm text-muted-foreground py-12">
          No active organization found.
        </div>
      )}
    </>
  )
}
