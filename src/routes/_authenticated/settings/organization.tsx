import { createFileRoute, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  getActiveOrganization,
  listUserOrganizations,
} from '#/contexts/identity/server/organizations'
import { OrganizationSettingsPage } from '#/components/features/organization/organization-settings-page'

export const Route = createFileRoute('/_authenticated/settings/organization')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'organization.update')) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  loader: async () => {
    const [orgResult, orgsResult] = await Promise.all([
      useServerFn(getActiveOrganization)(),
      useServerFn(listUserOrganizations)(),
    ])
    return {
      organization: orgResult.organization,
      organizations: orgsResult.organizations,
      activeOrganizationId: orgResult.organization?.id ?? null,
    }
  },
  component: OrganizationSettingsRoute,
})

function OrganizationSettingsRoute() {
  const { organization, organizations, activeOrganizationId } = Route.useLoaderData()

  if (!organization) {
    return (
      <div className="text-center text-sm text-muted-foreground py-12">
        No active organization found.
      </div>
    )
  }

  return (
    <OrganizationSettingsPage
      organization={organization}
      organizations={organizations}
      activeOrganizationId={activeOrganizationId}
    />
  )
}
