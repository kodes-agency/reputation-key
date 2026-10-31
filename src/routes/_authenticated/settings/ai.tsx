import { MerchantAiDataHandling } from '#/components/features/settings/merchant-ai-data-handling'
import { MERCHANT_AI_NOTICE } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import {
  useActionMutation,
  actionFailureMessage,
} from '#/components/hooks/use-action-mutation'
import { identityKeys } from '#/shared/queries/query-keys'
import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { useQueries, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { OrganizationAiOverviewPage } from '#/components/features/settings/organization-ai-overview-page'
import { can } from '#/shared/domain/permissions'
import type { AuthRouteContext } from '#/routes/_authenticated'
import {
  merchantAiOverviewQuery,
  organizationAiSpendQuery,
  reviewAnalysisProgressQuery,
} from '#/routes/-queries/route-queries'

// Old links carried `?propertyId=`; the editing now lives on the property. One
// that is not a property id is dropped, and the overview opens.
const aiOverviewSearch = z.object({ propertyId: z.uuid().optional().catch(undefined) })

export const Route = createFileRoute('/_authenticated/settings/ai')({
  staticData: { page: { title: 'AI overview', tier: 'narrow', under: 'settings' } },
  validateSearch: aiOverviewSearch,
  beforeLoad: ({ context, search }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'ai.manage')) throw roleUnavailable('AI overview', 'profile')
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
  const markUpdateSeen = useActionMutation(
    async (update: MerchantAiNoticeUpdate) => {
      const { markMerchantAiNoticeUpdateSeenFn } =
        await import('#/contexts/identity/server/merchant-ai-notice-updates')
      await markMerchantAiNoticeUpdateSeenFn({
        data: { noticeVersion: update.noticeVersion, noticeDigest: update.noticeDigest },
      })
    },
    {
      invalidateKeys: [
        [...identityKeys.merchantAiNotice(), 'updates'],
        identityKeys.merchantAiOverview(),
      ],
      errorMessage: actionFailureMessage("Couldn't mark this AI update as seen."),
    },
  )
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
        breadcrumbs={trailCrumbs('settings', {}, 'AI overview')}
      />
      <div className="mt-6">
        <OrganizationAiOverviewPage
          overview={overview}
          onUpdateSeen={markUpdateSeen}
          spend={spend}
          progressByProperty={progressByProperty}
        />
      </div>
      <div className="mt-8">
        <MerchantAiDataHandling
          notice={MERCHANT_AI_NOTICE}
          title="AI notice"
          showReference={false}
        />
      </div>
    </>
  )
}
