import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { MerchantAiPropertyAuthorization } from '#/components/features/settings/merchant-ai-property-authorization'
import {
  MerchantAiReadOnlyCard,
  merchantAiReadOnlyState,
} from '#/components/features/settings/merchant-ai-read-only-card'
import { propertyAiIsOn } from '#/components/features/property/settings/property-setup-steps'
import { ReviewAnalysisProgressCard } from '#/components/features/property/settings/review-analysis-progress-card'
import {
  changeMerchantAiCapabilitiesFn,
  enableMerchantAiFn,
  revokeMerchantAiFn,
} from '#/contexts/identity/server/merchant-ai'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { propertyQuery, propertySetupQuery } from '#/routes/-queries/route-queries'
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
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    // An AccountAdmin changes AI here and a manager who drafts with it reads the
    // state; the nav shows the section to the same two (property-settings-sections.ts).
    // Anyone else followed a stale link.
    if (!can(role, 'ai.manage') && !can(role, 'ai.reply.generate')) {
      throw roleUnavailable('AI settings', 'propertySettings')
    }
  },
  loader: async ({ params: { propertyId }, context }) => {
    const { role } = context as AuthRouteContext
    // Only an AccountAdmin reads the authorization; a manager reads the state from
    // the property's setup, which the settings layout already loads.
    if (can(role, 'ai.manage')) {
      await context.queryClient.ensureQueryData(merchantAiAuthorizationQuery(propertyId))
    }
  },
  component: PropertyAiSettings,
})

/**
 * Whether AI is on is an AccountAdmin's decision, so the consent controls are
 * theirs. A PropertyManager, who drafts with AI but cannot change it, reads the
 * state and who decides instead of being refused.
 */
function PropertyAiSettings() {
  const { role } = Route.useRouteContext() as AuthRouteContext
  return can(role, 'ai.manage') ? <PropertyAiConsent /> : <PropertyAiReadOnly />
}

function PropertyAiReadOnly() {
  const { propertyId } = Route.useParams()
  const { data: propertyData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: setup, isError } = useQuery(propertySetupQuery(propertyId))
  const isOn = propertyAiIsOn(setup)
  const { data: progress } = useQuery({
    ...reviewAnalysisProgressQuery(propertyId),
    enabled: isOn === true,
  })

  return (
    <>
      <MerchantAiReadOnlyCard
        propertyName={propertyData.property.name}
        state={merchantAiReadOnlyState(isOn, isError)}
      />
      {/* Its off copy tells a reader to turn analysis on above, which a manager cannot. */}
      {isOn === true && progress?.status !== 'disabled' ? (
        <ReviewAnalysisProgressCard progress={progress} />
      ) : null}
    </>
  )
}

function PropertyAiConsent() {
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
    successMessage: 'Feature access saved',
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
