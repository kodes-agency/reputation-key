import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { BarChart3 } from 'lucide-react'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { EmptyState } from '#/components/ui/empty-state'

const propertyRoute = getRouteApi('/_authenticated/properties/$propertyId')

export const Route = createFileRoute('/_authenticated/properties/$propertyId/metrics')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'dashboard.read')) throw redirect({ to: '/properties' })
  },
  component: MetricsPage,
})

function MetricsPage() {
  const { propertyId } = Route.useParams()
  const { property } = propertyRoute.useLoaderData()

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Metrics"
        description={property.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: property.name, to: `/properties/${propertyId}` },
          { label: 'Metrics' },
        ]}
      />
      <EmptyState icon={BarChart3} title="Metrics coming soon">
        <p className="text-sm text-muted-foreground">
          Performance metrics and analytics are under development. Track reputation
          scores, response rates, and trends here.
        </p>
      </EmptyState>
    </PageShell>
  )
}
