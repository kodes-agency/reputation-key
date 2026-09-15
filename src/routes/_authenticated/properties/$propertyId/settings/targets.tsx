import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { PrivateFeedbackTargetCard } from '#/components/features/property/private-feedback-target-card'
import { setResponseTargetPolicyFn } from '#/contexts/inbox/server/inbox'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { inboxKeys } from '#/shared/queries/query-keys'
import { responseTargetPolicyQuery } from '../-settings-queries'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/targets',
)({
  beforeLoad: ({ context, params }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'organization.update')) {
      throw redirect({ to: '/properties/$propertyId/settings/profile', params })
    }
  },
  loader: ({ params: { propertyId }, context }) =>
    context.queryClient.ensureQueryData(responseTargetPolicyQuery(propertyId)),
  component: PropertyTargetsSettings,
})

function PropertyTargetsSettings() {
  const { propertyId } = Route.useParams()
  const { data: settings } = useSuspenseQuery(responseTargetPolicyQuery(propertyId))
  const updatePolicy = useActionMutation(setResponseTargetPolicyFn, {
    successMessage: 'Property response target updated',
    invalidateKeys: [inboxKeys.responseTargetPolicies(propertyId)],
  })

  return <PrivateFeedbackTargetCard settings={settings} updatePolicy={updatePolicy} />
}
