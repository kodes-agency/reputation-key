import { createFileRoute } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  getActiveOrganization,
  updateOrganization,
  requestOrgLogoUpload,
  finalizeOrgLogoUpload,
} from '#/contexts/identity/server/organizations'
import {
  getGoogleReviewTargetAnalyticsFn,
  getPrivateFeedbackTargetAnalyticsFn,
  getResponseTargetPolicySettingsFn,
  setResponseTargetPolicyFn,
} from '#/contexts/inbox/server/inbox'
import { OrganizationSettingsPage } from '#/components/features/organization'
import { organizationCachePolicy } from '#/components/features/organization/organization-cache-policy'
import { identityKeys, inboxKeys } from '#/shared/queries/query-keys'

const activeOrgQuery = queryOptions({
  queryKey: identityKeys.activeOrg(),
  queryFn: () => getActiveOrganization(),
  staleTime: 60_000,
})

const responseTargetPolicyQuery = queryOptions({
  queryKey: inboxKeys.responseTargetPolicies(),
  queryFn: () => getResponseTargetPolicySettingsFn({ data: {} }),
  staleTime: 60_000,
})

const privateFeedbackTargetAnalyticsQuery = queryOptions({
  queryKey: inboxKeys.privateFeedbackTargetAnalytics(),
  queryFn: () => getPrivateFeedbackTargetAnalyticsFn({ data: {} }),
  staleTime: 60_000,
})

const googleReviewTargetAnalyticsQuery = queryOptions({
  queryKey: inboxKeys.googleReviewTargetAnalytics(),
  queryFn: () => getGoogleReviewTargetAnalyticsFn({ data: {} }),
  staleTime: 60_000,
})

export const Route = createFileRoute('/_authenticated/settings/organization')({
  staticData: { page: { title: 'Organization', under: 'settings' } },
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'organization.update')) {
      throw roleUnavailable('Organization', 'profile')
    }
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(activeOrgQuery),
      context.queryClient.ensureQueryData(responseTargetPolicyQuery),
      context.queryClient.ensureQueryData(privateFeedbackTargetAnalyticsQuery),
      context.queryClient.ensureQueryData(googleReviewTargetAnalyticsQuery),
    ])
  },
  // Organization settings rarely change — refetch only on explicit invalidation.
  staleTime: 60_000,
  component: OrganizationSettingsRoute,
})

function OrganizationSettingsRoute() {
  const queryClient = useQueryClient()
  const { data: orgResult } = useSuspenseQuery(activeOrgQuery)
  const { data: responseTargetSettings } = useSuspenseQuery(responseTargetPolicyQuery)
  const { data: privateFeedbackTargetAnalytics } = useSuspenseQuery(
    privateFeedbackTargetAnalyticsQuery,
  )
  const { data: googleReviewTargetAnalytics } = useSuspenseQuery(
    googleReviewTargetAnalyticsQuery,
  )
  const organization = orgResult.organization
  const updateResponseTargetPolicy = useActionMutation(setResponseTargetPolicyFn, {
    successMessage: 'Response target updated',
    invalidateKeys: [inboxKeys.responseTargetPolicies()],
  })
  const updateOrganizationAction = useActionMutation(updateOrganization, {
    onSuccess: () => organizationCachePolicy.onOrganizationUpdated(queryClient),
  })
  // Removing the logo is an immediate action: it reports by toast, so its
  // failure never lands in the identity form's banner.
  const removeOrganizationLogo = useActionMutation(updateOrganization, {
    errorMessage: actionErrorMessage,
    onSuccess: () => organizationCachePolicy.onOrganizationUpdated(queryClient),
  })

  return (
    <>
      <PageHeader
        title="Organization"
        description="Manage your organization's identity and response settings."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Organization' }]}
      />
      {organization ? (
        <OrganizationSettingsPage
          organization={organization}
          responseTargetSettings={responseTargetSettings}
          privateFeedbackTargetAnalytics={privateFeedbackTargetAnalytics}
          googleReviewTargetAnalytics={googleReviewTargetAnalytics}
          updateResponseTargetPolicy={updateResponseTargetPolicy}
          updateOrganization={updateOrganizationAction}
          removeOrganizationLogo={removeOrganizationLogo}
          requestOrgLogoUploadFn={requestOrgLogoUpload}
          finalizeOrgLogoUploadFn={finalizeOrgLogoUpload}
        />
      ) : (
        <div className="text-center text-sm text-muted-foreground py-12">
          No active organization found.
        </div>
      )}
    </>
  )
}
