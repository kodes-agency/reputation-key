import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQueries, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { PageHeader } from '#/components/layout/page-header'
import { OrganizationAiOverviewPage } from '#/components/features/settings/organization-ai-overview-page'
import { can } from '#/shared/domain/permissions'
import type { AuthRouteContext } from '#/routes/_authenticated'
import {
  merchantAiOverviewQuery,
  organizationAiSpendQuery,
  reviewAnalysisProgressQuery,
} from '#/routes/-queries/route-queries'

// Old links carried `?propertyId=`; the editing now lives on the property.
const aiOverviewSearch = z.object({ propertyId: z.uuid().optional() })

export const Route = createFileRoute('/_authenticated/settings/ai')({
  validateSearch: aiOverviewSearch,
  beforeLoad: ({ context, search }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'ai.manage')) throw redirect({ to: '/settings/profile' })
    if (search.propertyId) {
      throw redirect({
        to: '/properties/$propertyId/settings/ai',
        params: { propertyId: search.propertyId },
        replace: true,
      })
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(merchantAiOverviewQuery),
  component: AiOverviewRoute,
})

function AiOverviewRoute() {
  const { data: overview } = useSuspenseQuery(merchantAiOverviewQuery)
  const { data: spend } = useQuery(organizationAiSpendQuery)
  const analysed = overview.properties.filter(
    (entry) =>
      entry.state === 'enabled' && entry.capabilities.includes('review_analysis'),
  )
  const progress = useQueries({
    queries: analysed.map((entry) => reviewAnalysisProgressQuery(entry.propertyId)),
  })
  const progressByProperty = new Map(
    analysed.map((entry, index) => [entry.propertyId, progress[index]?.data]),
  )

  return (
    <>
      <PageHeader
        title="AI overview"
        description="Where AI is on, what it may use, and what it has cost this month. Open a property to change its AI settings."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'AI overview' }]}
      />
      <div className="mt-6">
        <OrganizationAiOverviewPage
          overview={overview}
          spend={spend}
          progressByProperty={progressByProperty}
        />
      </div>
    </>
  )
}
