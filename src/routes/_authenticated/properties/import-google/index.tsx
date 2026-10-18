import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { googleConnectionsQuery } from '#/routes/-queries/route-queries'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { importFns, importSetupFns } from './-import-fns'
import { GoogleImportManager } from '#/components/features/integration/google-import-manager'
import { CONNECTION_CALLBACK_ERRORS } from '#/components/features/integration/google-import-manager/google-import-callback-errors'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { requireGoogleImportRole } from './-route-access'
import { ImportRatingGoalStep } from './-import-rating-goal-step'

const importSearchSchema = z.object({
  connectionId: z.uuid().optional().catch(undefined),
  requestId: z.uuid().optional().catch(undefined),
  error: z.enum(CONNECTION_CALLBACK_ERRORS).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/properties/import-google/')({
  staticData: {
    page: {
      title: 'Import Google properties',
      under: 'properties',
    },
  },
  validateSearch: importSearchSchema,
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
  staleTime: 60_000,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(googleConnectionsQuery)
  },
  component: ImportPage,
})

function ImportPage() {
  const search = Route.useSearch()
  const { data } = useSuspenseQuery(googleConnectionsQuery)
  const { activeOrganization, user } = Route.useRouteContext()

  return (
    <PageShell>
      <PageHeader
        title="Import Google properties"
        description="Discover, review, and import locations from Google Business Profile."
        breadcrumbs={trailCrumbs('properties', {}, 'Import Google properties')}
      />

      <GoogleImportManager
        organizationId={activeOrganization?.id ?? 'no-active-organization'}
        connections={data.connections}
        initialConnectionId={search.connectionId}
        initialRequestId={search.requestId}
        initialError={search.error}
        importFns={importFns}
        setupFns={importSetupFns}
        viewerUserId={user.id}
        ratingGoalStep={(propertyId) => <ImportRatingGoalStep propertyId={propertyId} />}
      />
    </PageShell>
  )
}
