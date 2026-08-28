import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { propertyKeys, identityKeys, inboxKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { listMembers } from '#/contexts/identity/server/organizations'
import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from '#/contexts/property/server/property-responsible-managers'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { PropertyResponsibleManagersCard } from '#/components/features/property/property-responsible-managers-card'
import { PropertyLifecycleCard } from '#/components/features/property/property-lifecycle-card'
import {
  archiveProperty,
  disconnectPropertyGoogleBinding,
  restoreProperty,
} from '#/contexts/property/server/properties'
import { toast } from 'sonner'
import {
  getResponseTargetPolicySettingsFn,
  setResponseTargetPolicyFn,
} from '#/contexts/inbox/server/inbox'
import { PrivateFeedbackTargetCard } from '#/components/features/property/private-feedback-target-card'

const responsibleManagersQuery = (propertyId: string) =>
  queryOptions({
    queryKey: propertyKeys.responsibleManagers(propertyId),
    queryFn: () => listPropertyResponsibleManagers({ data: { propertyId } }),
    staleTime: 30_000,
  })

const membersQuery = queryOptions({
  queryKey: identityKeys.members(),
  queryFn: () => listMembers(),
  staleTime: 30_000,
})

const responseTargetPolicyQuery = (propertyId: string) =>
  queryOptions({
    queryKey: inboxKeys.responseTargetPolicies(propertyId),
    queryFn: () => getResponseTargetPolicySettingsFn({ data: { propertyId } }),
    staleTime: 60_000,
  })

export const Route = createFileRoute('/_authenticated/properties/$propertyId/settings')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'property.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params: { propertyId }, context }) => {
    const { role } = context as AuthRouteContext
    await Promise.all([
      context.queryClient.ensureQueryData(propertyQuery(propertyId)),
      context.queryClient.ensureQueryData(responsibleManagersQuery(propertyId)),
      context.queryClient.ensureQueryData(membersQuery),
      ...(can(role, 'organization.update')
        ? [context.queryClient.ensureQueryData(responseTargetPolicyQuery(propertyId))]
        : []),
    ])
  },
  component: PropertySettingsRoute,
})

function PropertySettingsRoute() {
  const { propertyId } = Route.useParams()
  const { role } = Route.useRouteContext() as AuthRouteContext
  const { data: propertyData } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: responsibleManagers } = useSuspenseQuery(
    responsibleManagersQuery(propertyId),
  )
  const { data: membersData } = useSuspenseQuery(membersQuery)
  const canManageResponseTargets = can(role, 'organization.update')
  const { data: responseTargetSettings } = useQuery({
    ...responseTargetPolicyQuery(propertyId),
    enabled: canManageResponseTargets,
  })
  const updateAction = useActionMutation(updatePropertyResponsibleManagers, {
    successMessage: 'Responsible managers updated',
    invalidateKeys: [
      propertyKeys.detail(propertyId),
      propertyKeys.responsibleManagers(propertyId),
    ],
  })
  const lifecycleInvalidateKeys = [propertyKeys.detail(propertyId), propertyKeys.list()]
  const archiveAction = useActionMutation(archiveProperty, {
    successMessage: 'Property archived. Its settings and history are retained.',
    invalidateKeys: lifecycleInvalidateKeys,
  })
  const restoreAction = useActionMutation(restoreProperty, {
    invalidateKeys: lifecycleInvalidateKeys,
    onSuccess: (result) => {
      if (result.googleBindingReadiness === 'reconnect_required') {
        toast.success(
          'Property restored. Reconnect Google before restarting provider work.',
        )
      } else {
        toast.success('Property restored. Google is ready for this Property.')
      }
    },
  })
  const disconnectAction = useActionMutation(disconnectPropertyGoogleBinding, {
    successMessage:
      'This Property is disconnected. The Organization Google connection is unchanged.',
    invalidateKeys: lifecycleInvalidateKeys,
  })
  const updateResponseTargetPolicy = useActionMutation(setResponseTargetPolicyFn, {
    successMessage: 'Property response target updated',
    invalidateKeys: [inboxKeys.responseTargetPolicies(propertyId)],
  })

  return (
    <PageShell>
      <PageHeader
        title="Property settings"
        description={propertyData.property.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyData.property.name, to: `/properties/${propertyId}` },
          { label: 'Settings' },
        ]}
      />
      <div className="space-y-6">
        <PropertyResponsibleManagersCard
          propertyId={propertyId}
          state={responsibleManagers}
          members={membersData.members}
          updateAction={updateAction}
          disabled={!can(role, 'property.update')}
        />
        {canManageResponseTargets && responseTargetSettings ? (
          <PrivateFeedbackTargetCard
            settings={responseTargetSettings}
            updatePolicy={updateResponseTargetPolicy}
          />
        ) : null}
        <PropertyLifecycleCard
          property={propertyData.property}
          responsibilityNeeded={responsibleManagers.responsibilityNeeded}
          archiveAction={archiveAction}
          restoreAction={restoreAction}
          disconnectAction={disconnectAction}
          permissions={{
            archive: can(role, 'property.archive'),
            restore: can(role, 'property.restore'),
            disconnect: can(role, 'property.disconnect'),
          }}
        />
      </div>
    </PageShell>
  )
}
