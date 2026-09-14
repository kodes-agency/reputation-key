import { createFileRoute, redirect } from '@tanstack/react-router'
import { firstPropertySetupSection } from '#/components/features/property/settings/property-setup-steps'
import { propertySetupQuery } from '#/routes/-queries/route-queries'

/**
 * The hub opens where setup needs the viewer next; once set up, on Profile.
 * A setup read that fails never blocks settings: it opens on Profile.
 */
export const Route = createFileRoute('/_authenticated/properties/$propertyId/settings/')({
  beforeLoad: async ({ params, context }) => {
    const setup = await context.queryClient
      .ensureQueryData(propertySetupQuery(params.propertyId))
      .catch(() => null)
    const section = setup ? firstPropertySetupSection(setup) : null
    throw redirect({
      to: `/properties/$propertyId/settings/${section ?? 'profile'}`,
      params,
      replace: true,
    })
  },
})
