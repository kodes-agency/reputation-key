import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { PropertySettingsNav } from '#/components/features/property/settings/property-settings-nav'
import { visiblePropertySettingsSections } from '#/components/features/property/settings/property-settings-sections'
import { PropertySetupStrip } from '#/components/features/property/settings/property-setup-strip'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { propertyQuery, propertySetupQuery } from '#/routes/-queries/route-queries'
import { can } from '#/shared/domain/permissions'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/settings')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'property.read')) throw redirect({ to: '/properties' })
  },
  loader: ({ params: { propertyId }, context }) =>
    context.queryClient.ensureQueryData(propertyQuery(propertyId)),
  component: PropertySettingsLayout,
})

function PropertySettingsLayout() {
  const { propertyId } = Route.useParams()
  const { role } = Route.useRouteContext() as AuthRouteContext
  const { data } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: setup } = useQuery(propertySetupQuery(propertyId))
  const sections = visiblePropertySettingsSections((permission) => can(role, permission))

  return (
    <PageShell>
      <PageHeader
        title="Property settings"
        description={data.property.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: data.property.name, to: `/properties/${propertyId}` },
          { label: 'Settings' },
        ]}
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)] md:items-start">
        <div className="md:sticky md:top-4">
          <PropertySettingsNav propertyId={propertyId} sections={sections} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <PropertySetupStrip propertyId={propertyId} setup={setup} />
          <Outlet />
        </div>
      </div>
    </PageShell>
  )
}
