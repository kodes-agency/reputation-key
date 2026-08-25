import { createFileRoute, Link, notFound, redirect } from '@tanstack/react-router'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
} from '@tanstack/react-query'
import { z } from 'zod/v4'
import { toast } from 'sonner'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import {
  completeContentReview,
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
import { portalKeys, badgeKeys, identityKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'
import { AlertCircle } from 'lucide-react'
import type { BadgeAwardWithTarget } from '#/contexts/badge/application/public-api'
import type { Portal, PortalTokenStatus } from '#/contexts/portal/application/public-api'
import type { UpdatePortalVariables } from '#/components/features/portal/shared/types'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import {
  listPortalResponsibleManagers,
  updatePortalResponsibleManagers,
} from '#/contexts/portal/server/portal-responsible-managers'
import { listMembers } from '#/contexts/identity/server/organizations'

type PortalQueryResult = Readonly<{
  portal: Portal | null
  tokenStatus: PortalTokenStatus
}>

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

const responsibleManagersQuery = (portalId: string) =>
  queryOptions({
    queryKey: portalKeys.responsibleManagers(portalId),
    queryFn: () => listPortalResponsibleManagers({ data: { portalId } }),
    staleTime: 30_000,
  })

const membersQuery = queryOptions({
  queryKey: identityKeys.members(),
  queryFn: () => listMembers(),
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

/**
 * Resolve the portal through the URL property's AUTHORIZED collection, so a
 * portal in another property or organization is reported exactly like one that
 * no longer exists — a direct URL never reveals that it exists elsewhere.
 *
 * The list is refetched ONCE before concluding the portal is gone. `invalidate`
 * after a create only refetches ACTIVE queries, and this list has no observer
 * while the user is on `../portals/new`, so the cache still held the
 * pre-creation list: a portal created a second earlier was reported unavailable.
 * The refetch costs nothing in the happy path — it runs only on a cache miss —
 * and removes that whole class of false negative for any stale list.
 */
const findAuthorizedPortal = async (
  queryClient: QueryClient,
  propertyId: string,
  portalId: string,
): Promise<Portal | null> => {
  const options = propertyPortalsQuery(propertyId)
  const cached = await queryClient.ensureQueryData(options)
  const hit = cached.portals.find((candidate) => String(candidate.id) === portalId)
  if (hit) return hit
  const fresh = await queryClient.fetchQuery({ ...options, staleTime: 0 })
  return fresh.portals.find((candidate) => String(candidate.id) === portalId) ?? null
}

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
    const portal = await findAuthorizedPortal(
      context.queryClient,
      params.propertyId,
      params.portalId,
    )
    // `notFound()`, not `/unavailable`: that page states the whole Portals
    // feature is switched off, which is a lie while the sidebar still links to a
    // working list. `notFoundComponent` renders an in-route "no longer
    // available" state instead. `/unavailable` stays for the capability-denied
    // and cross-tenant PROPERTY cases, which `gateControlledRoute` decides in
    // beforeLoad. A portal id belonging to another property or organization is
    // simply absent from this collection, so it lands here — identical to a
    // removed portal, which is the point.
    if (!portal) throw notFound()
    const [, { categories, links }, badges] = await Promise.all([
      // The detail entry is FETCHED, not seeded from the list row: `getPortal`
      // also returns `tokenStatus` (C2), which no list row carries, so a
      // hand-built `{ portal }` seed would leave the Share tab reading
      // `tokenStatus` as undefined instead of triggering a fetch.
      context.queryClient.ensureQueryData(portalQuery(params.portalId)),
      context.queryClient.ensureQueryData(portalLinksQuery(params.portalId)),
      context.queryClient.ensureQueryData(
        portalBadgesQuery(params.propertyId, params.portalId),
      ),
      context.queryClient.ensureQueryData(responsibleManagersQuery(params.portalId)),
      context.queryClient.ensureQueryData(membersQuery),
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
  notFoundComponent: PortalNoLongerAvailable,
})

/**
 * Rendered when the portal is absent from this property's authorized
 * collection. Deliberately says nothing about WHY — deleted, moved, or owned by
 * another property/organization all land here with identical copy, so the URL
 * cannot be used to probe for portals the caller may not see.
 */
function PortalNoLongerAvailable() {
  const { propertyId } = Route.useParams()
  return (
    <PageShell>
      <PageHeader
        title="Portal unavailable"
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: 'Portals', to: `/properties/${propertyId}/portals` },
          { label: 'Unavailable' },
        ]}
      />
      <EmptyState icon={AlertCircle} title="This portal is no longer available">
        <p className="text-sm text-muted-foreground">
          It may have been removed, or it may belong to a different property.
        </p>
        <Button asChild variant="outline">
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            Back to Portals
          </Link>
        </Button>
      </EmptyState>
    </PageShell>
  )
}

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
  const { data: responsibleManagers } = useSuspenseQuery(
    responsibleManagersQuery(portalId),
  )
  const { data: membersData } = useSuspenseQuery(membersQuery)
  const { portal, tokenStatus } = portalData
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
  // The only producer of the governed portal.content_review.completed /
  // configuration_completeness / approved_destination_ratio facts, which badge
  // and goal projections read — hence the badge invalidation.
  const completeReviewMutation = useActionMutation(completeContentReview, {
    successMessage: 'Content review recorded',
    invalidateKeys: [
      portalKeys.detail(portalId),
      badgeKeys.target({ propertyId, targetType: 'portal', targetId: portalId }),
    ],
  })
  const updateResponsibleManagersMutation = useActionMutation(
    updatePortalResponsibleManagers,
    {
      successMessage: 'Responsible managers updated',
      invalidateKeys: [
        portalKeys.detail(portalId),
        portalKeys.responsibleManagers(portalId),
      ],
    },
  )
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
        tokenStatus={tokenStatus}
        propertyId={propertyId}
        propertyTimezone={property.timezone}
        categories={categories}
        links={links}
        activeTab={tab}
        onTabChange={(nextTab) => {
          // No `replace: true`: replacing the entry made browser Back leave the
          // portal entirely instead of returning to the previously viewed tab.
          // Deep links via ?tab= are unaffected.
          void navigate({ search: { tab: nextTab } })
        }}
        updateMutation={mutation}
        organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
        issueTokenMutation={issueTokenMutation}
        rotateTokenMutation={rotateTokenMutation}
        revokeTokenMutation={revokeTokenMutation}
        requestUploadUrl={requestUploadUrlFn}
        finalizeUpload={finalizeUploadFn}
        getPortalAnalytics={getPortalAnalyticsFn}
        completeReviewMutation={completeReviewMutation}
        responsibleManagers={responsibleManagers}
        responsibleManagerMembers={membersData.members}
        updateResponsibleManagersMutation={updateResponsibleManagersMutation}
      />
      <PortalBadgeSection badges={badges as BadgeAwardWithTarget[]} />
    </PageShell>
  )
}
