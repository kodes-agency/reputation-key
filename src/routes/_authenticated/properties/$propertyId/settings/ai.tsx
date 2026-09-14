import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
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
import { can } from '#/shared/domain/permissions'
import { aiKeys, identityKeys, inboxKeys } from '#/shared/queries/query-keys'
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
      throw redirect({ to: '/properties/$propertyId/settings/profile', params })
    }
  },
  loader: ({ params: { propertyId }, context }) =>
    context.queryClient.ensureQueryData(merchantAiAuthorizationQuery(propertyId)),
  component: PropertyAiSettings,
})

function PropertyAiSettings() {
  const { propertyId } = Route.useParams()
  const queryClient = useQueryClient()
  const { data: propertyData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: authorization } = useSuspenseQuery(
    merchantAiAuthorizationQuery(propertyId),
  )
  const { data: progress } = useQuery(reviewAnalysisProgressQuery(propertyId))
  const afterChange = [
    identityKeys.merchantAiAuthorization(propertyId),
    aiKeys.reviewAnalysisProgress(propertyId),
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
          onChanged={() =>
            void queryClient.invalidateQueries({
              queryKey: aiKeys.reviewAnalysisProgress(propertyId),
            })
          }
        />
      ) : null}
      <ReviewAnalysisProgressCard progress={progress} />
    </>
  )
}
