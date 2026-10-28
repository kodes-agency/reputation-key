import { createFileRoute, Outlet, useMatches } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { PageShell } from '#/components/layout/page-shell'
import { SectionNavLayout } from '#/components/ui/section-nav-layout'
import { PropertySettingsNav } from '#/components/features/property/settings/property-settings-nav'
import {
  activePropertySettingsSection,
  propertySettingsHeader,
  visiblePropertySettingsSections,
} from '#/components/features/property/settings/property-settings-sections'
import { PropertySetupStrip } from '#/components/features/property/settings/property-setup-strip'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { propertyQuery, propertySetupQuery } from '#/routes/-queries/route-queries'
import { can } from '#/shared/domain/permissions'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useRatingGoalNotNow } from './goals/-rating-goal-not-now'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/settings')({
  staticData: {
    page: { title: NAV_LABEL.propertySettings, under: 'property' },
  },
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'property.read'))
      throw roleUnavailable(NAV_LABEL.propertySettings, 'properties')
  },
  // The setup strip above the section draws nothing until its read arrives, so
  // the card below it jumped down (200 to 362 px). It is read with the property,
  // as a side read (no retry, so a failure does not hold the page): the strip is
  // then in the first paint, and a failure leaves it to its own read.
  loader: async ({ params: { propertyId }, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(propertyQuery(propertyId)),
      context.queryClient.prefetchQuery({
        ...propertySetupQuery(propertyId),
        retry: false,
      }),
    ])
  },
  component: PropertySettingsLayout,
})

function PropertySettingsLayout() {
  const { propertyId } = Route.useParams()
  const { can: canDo } = usePermissions()
  const { data } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: setup } = useQuery(propertySetupQuery(propertyId))
  const notNow = useRatingGoalNotNow(propertyId)
  const sections = visiblePropertySettingsSections(canDo)
  // The section that is on screen, from the rendered leaf: while the next
  // section loads, the location is already the new one, and the header and the
  // nav would name a section whose page has not arrived.
  const active = useMatches({
    select: (matches) =>
      activePropertySettingsSection(matches[matches.length - 1]?.pathname ?? ''),
  })
  // The header names the section that is open, as every account settings page does.
  const header = propertySettingsHeader({
    propertyId,
    propertyName: data.property.name,
    active,
  })

  return (
    <PageShell>
      <PageHeader
        title={header.title}
        meta={[data.property.name]}
        breadcrumbs={header.breadcrumbs}
      />
      <SectionNavLayout frame="inline">
        <PropertySettingsNav propertyId={propertyId} sections={sections} />
        <div className="flex min-w-0 flex-col gap-6">
          <PropertySetupStrip
            propertyId={propertyId}
            setup={setup}
            ratingGoalNotNow={notNow}
          />
          <Outlet />
        </div>
      </SectionNavLayout>
    </PageShell>
  )
}
