import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { importFns, importSetupFns } from './-import-fns'
import { GoogleImportManager } from '#/components/features/integration/google-import-manager'
import { googleImportStatusQuery } from '#/components/features/integration/google-import-manager/google-import-queries'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { googleConnectionsQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { requireGoogleImportRole } from './-route-access'
import { ImportRatingGoalStep } from './-import-rating-goal-step'

export const Route = createFileRoute(
  '/_authenticated/properties/import-google/$importId',
)({
  staticData: {
    page: {
      title: 'Import Google properties',
      under: 'properties',
    },
  },
  beforeLoad: async ({ context }) => {
    const { role } = context as AuthRouteContext
    requireGoogleImportRole(role)
    await gateControlledRoute({
      data: {
        capability: 'property.import_gbp_v2',
        featureLabel: 'Google property import',
      },
    })
  },
  staleTime: 0,
  loader: async ({ context, params: { importId } }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        googleImportStatusQuery(importId, importFns.getPropertyImportV2Status),
      ),
      context.queryClient.ensureQueryData(googleConnectionsQuery),
    ])
  },
  component: ImportProgressPage,
})

function ImportProgressPage() {
  const { importId } = Route.useParams()
  const { activeOrganization, user } = Route.useRouteContext()
  const { data: progress } = useSuspenseQuery(
    googleImportStatusQuery(importId, importFns.getPropertyImportV2Status),
  )
  const { data: connectionData } = useSuspenseQuery(googleConnectionsQuery)

  return (
    <PageShell>
      <PageHeader
        title="Import Google properties"
        description="Track the import, then set up the properties it created."
        breadcrumbs={trailCrumbs('properties', {}, 'Import Google properties')}
      />

      <GoogleImportManager
        key={importId}
        organizationId={activeOrganization?.id ?? 'no-active-organization'}
        connections={connectionData.connections}
        initialProgress={progress}
        importFns={importFns}
        setupFns={importSetupFns}
        viewerUserId={user.id}
        ratingGoalStep={(propertyId) => <ImportRatingGoalStep propertyId={propertyId} />}
      />
    </PageShell>
  )
}
