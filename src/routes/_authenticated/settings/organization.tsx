import { OrganizationReadRegion } from '#/components/features/organization/organization-read-region'
import { ResponseTargetSettingsCard } from '#/components/features/organization/response-target-settings-card'
import {
  GoogleReviewTargetSummary,
  PrivateFeedbackTargetSummary,
} from '#/components/features/organization/response-target-analytics-summary'
import { tenantScope, type TenantScope } from '#/shared/queries/tenant-scope'
import { useTenantScope } from '#/shared/hooks/useTenantScope'
import { createFileRoute } from '@tanstack/react-router'
import { roleUnavailable } from '#/shared/auth/route-notice'
import {
  queryOptions,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
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
import { inboxKeys, createKeys } from '#/shared/queries/query-keys'

const activeOrgQuery = (scope: TenantScope) =>
  queryOptions({
    queryKey: createKeys(scope).identityKeys.activeOrg(),
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
  staticData: { page: { title: 'Organization', tier: 'narrow', under: 'settings' } },
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'organization.update')) {
      throw roleUnavailable('Organization', 'profile')
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(activeOrgQuery(tenantScope(context)))
  },
  // Organization settings rarely change — refetch only on explicit invalidation.
  staleTime: 60_000,
  component: OrganizationSettingsRoute,
})

function OrganizationSettingsRoute() {
  const scope = useTenantScope()
  const queryClient = useQueryClient()
  const { data: orgResult } = useSuspenseQuery(activeOrgQuery(scope))
  const organization = orgResult.organization
  const updateOrganizationAction = useActionMutation(updateOrganization, {
    successMessage: 'Organization saved',
    onSuccess: () => organizationCachePolicy.onOrganizationUpdated(queryClient, scope),
  })
  // The logo is an image setting, which says a refusal itself (a toast), so neither
  // of these passes an `errorMessage`; a failure never lands in the identity form's banner.
  const removeOrganizationLogo = useActionMutation(updateOrganization, {
    successMessage: 'Logo removed',
    onSuccess: () => organizationCachePolicy.onOrganizationUpdated(queryClient, scope),
  })
  const finalizeOrgLogo = useActionMutation(finalizeOrgLogoUpload, {
    successMessage: 'Logo updated',
    onSuccess: () => organizationCachePolicy.onOrganizationUpdated(queryClient, scope),
  })

  return (
    <>
      <PageHeader
        title="Organization"
        description="Manage your organization's identity and response settings."
        breadcrumbs={trailCrumbs('settings', {}, 'Organization')}
      />
      {organization ? (
        <OrganizationSettingsPage
          organization={organization}
          responseTargets={<OrganizationResponseTargets />}
          updateOrganization={updateOrganizationAction}
          removeOrganizationLogo={removeOrganizationLogo}
          requestOrgLogoUploadFn={requestOrgLogoUpload}
          finalizeOrgLogo={finalizeOrgLogo}
        />
      ) : (
        <div className="text-center text-sm text-muted-foreground py-12">
          No active organization found.
        </div>
      )}
    </>
  )
}

function OrganizationResponseTargets() {
  const policy = useQuery(responseTargetPolicyQuery)
  const update = useActionMutation(setResponseTargetPolicyFn, {
    successMessage: 'Response target saved',
    invalidateKeys: [inboxKeys.responseTargetPolicies()],
  })
  return (
    <OrganizationReadRegion query={policy} label="response targets">
      {(settings) => (
        <ResponseTargetSettingsCard
          settings={settings}
          updatePolicy={update}
          googleReviewSummary={<GoogleResponsePerformance />}
          privateFeedbackSummary={<PrivateFeedbackPerformance />}
        />
      )}
    </OrganizationReadRegion>
  )
}

function GoogleResponsePerformance() {
  const query = useQuery(googleReviewTargetAnalyticsQuery)
  return (
    <OrganizationReadRegion query={query} label="Google review performance">
      {(analytics) => <GoogleReviewTargetSummary analytics={analytics} />}
    </OrganizationReadRegion>
  )
}

function PrivateFeedbackPerformance() {
  const query = useQuery(privateFeedbackTargetAnalyticsQuery)
  return (
    <OrganizationReadRegion query={query} label="private feedback performance">
      {(analytics) => <PrivateFeedbackTargetSummary analytics={analytics} />}
    </OrganizationReadRegion>
  )
}
