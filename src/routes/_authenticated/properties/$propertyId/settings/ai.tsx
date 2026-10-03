import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { MerchantAiPropertyAuthorization } from '#/components/features/settings/merchant-ai-property-authorization'
import { ReviewAnalysisProgressCard } from '#/components/features/property/settings/review-analysis-progress-card'
import {
  changeMerchantAiCapabilitiesFn,
  enableMerchantAiFn,
  revokeMerchantAiFn,
} from '#/contexts/identity/server/merchant-ai'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { can } from '#/shared/domain/permissions'
import {
  aiKeys,
  identityKeys,
  inboxKeys,
  propertyKeys,
} from '#/shared/queries/query-keys'
import {
  merchantAiAuthorizationQuery,
  reviewAnalysisProgressQuery,
} from '../-settings-queries'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/ai',
)({
  beforeLoad: ({ context, params }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'ai.manage')) {
      // The section is hidden from a role without it, so this is a stale link.
      throw roleUnavailable('AI settings', {
        to: `/properties/${params.propertyId}/settings/profile`,
        label: 'Back to Property settings',
      })
    }
  },
  loader: ({ params: { propertyId }, context }) =>
    context.queryClient.ensureQueryData(merchantAiAuthorizationQuery(propertyId)),
  component: PropertyAiSettings,
})

function PropertyAiSettings() {
  const { propertyId } = Route.useParams()
  const { data: propertyData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: authorization } = useSuspenseQuery(
    merchantAiAuthorizationQuery(propertyId),
  )
  const { data: progress } = useQuery(reviewAnalysisProgressQuery(propertyId))
  const afterChange = [
    identityKeys.merchantAiAuthorization(propertyId),
    identityKeys.merchantAiOverview(),
    aiKeys.reviewAnalysisProgress(propertyId),
    propertyKeys.setup(propertyId),
    propertyKeys.setupSummaries(),
    inboxKeys.details(),
  ]
  const enable = useActionMutation(enableMerchantAiFn, {
    successMessage: 'AI features enabled for this property',
    invalidateKeys: afterChange,
  })
  const change = useActionMutation(changeMerchantAiCapabilitiesFn, {
    successMessage: 'AI feature access updated',
    invalidateKeys: afterChange,
  })
  const revoke = useActionMutation(revokeMerchantAiFn, {
    successMessage: 'AI features turned off for this property',
    invalidateKeys: afterChange,
  })

  return (
    <>
      {authorization.authorization ? (
        <MerchantAiPropertyAuthorization
          key={`${propertyId}:${authorization.authorization.stateVersion}`}
          property={propertyData.property}
          snapshot={authorization.authorization}
          notice={authorization.notice}
          enable={enable}
          change={change}
          revoke={revoke}
        />
      ) : null}
      <ReviewAnalysisProgressCard progress={progress} />
    </>
  )
}
