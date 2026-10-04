import { createFileRoute, Outlet } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { SectionNavLayout } from '#/components/ui/section-nav-layout'
import { PropertySettingsNav } from '#/components/features/property/settings/property-settings-nav'
import { visiblePropertySettingsSections } from '#/components/features/property/settings/property-settings-sections'
import { PropertySetupStrip } from '#/components/features/property/settings/property-setup-strip'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { propertyQuery, propertySetupQuery } from '#/routes/-queries/route-queries'
import { can } from '#/shared/domain/permissions'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/settings')({
  staticData: {
    page: { title: 'Property settings', crumb: 'Settings', under: 'property' },
  },
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'property.read'))
      throw roleUnavailable('Property settings', 'properties')
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
      <SectionNavLayout frame="inline">
        <PropertySettingsNav propertyId={propertyId} sections={sections} />
        <div className="flex min-w-0 flex-col gap-6">
          <PropertySetupStrip propertyId={propertyId} setup={setup} />
          <Outlet />
        </div>
      </SectionNavLayout>
    </PageShell>
  )
}
