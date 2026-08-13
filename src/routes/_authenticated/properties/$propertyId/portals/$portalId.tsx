import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { z } from 'zod/v4'
import { toast } from 'sonner'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  finalizeUpload,
  getPortal,
  listPortals,
  issuePortalToken,
  requestUploadUrl,
  revokePortalTokens,
  rotatePortalToken,
  updatePortal,
} from '#/contexts/portal/server/portals'
import { getVisibleTargetBadges } from '#/contexts/badge/server/badges'
import { listPortalLinks } from '#/contexts/portal/server/portal-links'
import { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import {
  PORTAL_DETAIL_TABS,
  PortalDetailPage,
  type PortalDetailTab,
} from '#/components/features/portal'
import { PortalBadgeSection } from '#/components/features/badges/portal-badge-section'
import type { Action } from '#/components/hooks/use-action'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { useServerFn } from '@tanstack/react-start'
import { portalKeys, badgeKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import type { BadgeAwardWithTarget } from '#/contexts/badge/application/public-api'
import type { Portal } from '#/contexts/portal/application/public-api'
import type { UpdatePortalVariables } from '#/components/features/portal/shared/types'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'

type PortalQueryResult = Readonly<{ portal: Portal | null }>

const portalDetailSearchSchema = z.object({
  tab: z.enum(PORTAL_DETAIL_TABS).catch('settings').default('settings'),
})

const normalizePortalDetailSearch = (search: unknown): { tab: PortalDetailTab } =>
  portalDetailSearchSchema.parse(search)

const portalQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.detail(portalId),
    queryFn: () => getPortal({ data: { portalId } }),
    staleTime: 30_000,
  })

const propertyPortalsQuery = (propertyId: string) =>
  queryOptions({
    queryKey: portalKeys.list(propertyId),
    queryFn: () => listPortals({ data: { propertyId } }),
    staleTime: 30_000,
  })

const portalLinksQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.links(portalId),
    queryFn: () => listPortalLinks({ data: { portalId } }),
    staleTime: 30_000,
  })

const portalBadgesQuery = (propertyId: string, portalId: string) =>
  queryOptions({
    queryKey: badgeKeys.target({ propertyId, targetType: 'portal', targetId: portalId }),
    queryFn: () =>
      getVisibleTargetBadges({
        data: {
          propertyId,
          targetType: 'portal',
          targetId: portalId,
        },
      }),
    staleTime: 30_000,
  })

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId',
)({
  validateSearch: normalizePortalDetailSearch,
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      data: {
        capability: 'portal.read',
        featureLabel: 'Portals',
        propertyId: params.propertyId,
      },
    })
    const { role } = context as AuthRouteContext
    if (!can(role, 'portal.read')) throw redirect({ to: '/properties' })
  },
  staleTime: 30_000,
  loader: async ({ params, context }) => {
    // Resolve the resource through the URL property's authorized collection
    // before loading resource-scoped dependencies. A mismatched portal gets
    // the same controlled 200 response as other unavailable direct paths,
    // without exposing whether that portal exists in another property.
    const { portals } = await context.queryClient.ensureQueryData(
      propertyPortalsQuery(params.propertyId),
    )
    const portal = portals.find((candidate) => String(candidate.id) === params.portalId)
    if (!portal) {
      throw redirect({ to: '/unavailable', search: { feature: 'Portals' } })
    }
    context.queryClient.setQueryData(portalKeys.detail(params.portalId), { portal })
    const [{ categories, links }, badges] = await Promise.all([
      context.queryClient.ensureQueryData(portalLinksQuery(params.portalId)),
      context.queryClient.ensureQueryData(
        portalBadgesQuery(params.propertyId, params.portalId),
      ),
    ])
    return {
      portal,
      categories,
      links,
      propertyId: params.propertyId,
      badges: badges as BadgeAwardWithTarget[],
    }
  },
  component: PortalDetailRoute,
  pendingComponent: PortalDetailLoading,
  errorComponent: PortalDetailError,
})

function PortalDetailLoading() {
  return (
    <PageShell>
      <LoadingState label="Loading portal details" />
    </PageShell>
  )
}

function PortalDetailError({ error }: { error: Error }) {
  return (
    <PageShell>
      <PageHeader title="Portal" description="Manage this property’s public page." />
      <ErrorState message={error.message || 'This portal could not be loaded.'} />
    </PageShell>
  )
}

function usePortalUpdateAction(propertyId: string, portalId: string) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: UpdatePortalVariables) => updatePortal(input),
    onMutate: async (input: UpdatePortalVariables) => {
      const queryKey = portalKeys.detail(portalId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<PortalQueryResult>(queryKey)
      const { portalId: _portalId, ...patch } = input.data
      void _portalId
      queryClient.setQueryData<PortalQueryResult>(queryKey, (current) =>
        current?.portal
          ? { ...current, portal: { ...current.portal, ...patch } }
          : current,
      )
      return { previous }
    },
    onError: async (_error, _input, context) => {
      const queryKey = portalKeys.detail(portalId)
      queryClient.setQueryData(queryKey, context?.previous)
      await queryClient.refetchQueries({ queryKey, exact: true })
    },
    onSuccess: async () => {
      toast.success('Portal updated')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: portalKeys.detail(portalId) }),
        queryClient.invalidateQueries({ queryKey: portalKeys.links(portalId) }),
        queryClient.invalidateQueries({ queryKey: portalKeys.list(propertyId) }),
      ])
    },
  })

  return Object.assign(mutation.mutateAsync, {
    isPending: mutation.isPending,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
    data: mutation.data ?? null,
  }) as Action<UpdatePortalVariables>
}

function PortalDetailRoute() {
  const { propertyId, portalId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: portalData } = useSuspenseQuery(portalQuery(portalId))
  const { data: linksData } = useSuspenseQuery(portalLinksQuery(portalId))
  const { data: badges } = useSuspenseQuery(portalBadgesQuery(propertyId, portalId))
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const { portal } = portalData
  const { categories, links } = linksData
  const { property } = propData
  if (!portal) throw notFound()
  const ctx = Route.useRouteContext()

  const mutation = usePortalUpdateAction(propertyId, portalId)
  const issueTokenMutation = useActionMutation(issuePortalToken, {
    successMessage: 'Public link generated',
  })
  const rotateTokenMutation = useActionMutation(rotatePortalToken, {
    successMessage: 'Public link rotated',
  })
  const revokeTokenMutation = useActionMutation(revokePortalTokens, {
    successMessage: 'Public links revoked',
  })
  const requestUploadUrlFn = useServerFn(requestUploadUrl)
  const finalizeUploadFn = useServerFn(finalizeUpload)

  return (
    <PageShell>
      <PageHeader
        title={portal.name}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: property.name, to: `/properties/${propertyId}` },
          { label: 'Portals', to: `/properties/${propertyId}/portals` },
          { label: portal.name },
        ]}
      />
      <PortalDetailPage
        portal={portal}
        propertyId={propertyId}
        categories={categories}
        links={links}
        activeTab={tab}
        onTabChange={(nextTab) => {
          void navigate({ search: { tab: nextTab }, replace: true })
        }}
        updateMutation={mutation}
        organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
        issueTokenMutation={issueTokenMutation}
        rotateTokenMutation={rotateTokenMutation}
        revokeTokenMutation={revokeTokenMutation}
        requestUploadUrl={requestUploadUrlFn}
        finalizeUpload={finalizeUploadFn}
        getPortalAnalytics={getPortalAnalyticsFn}
      />
      <PortalBadgeSection badges={badges as BadgeAwardWithTarget[]} />
    </PageShell>
  )
}
