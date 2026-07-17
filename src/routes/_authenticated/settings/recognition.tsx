import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { can } from '#/shared/domain/permissions'
import type { AuthRouteContext } from '#/routes/_authenticated'
import {
  getOrganizationBadgeDefinitionsFn,
  setOrganizationBadgeEnablement,
} from '#/contexts/badge/server/badges'
import { RecognitionSettingsPage } from '#/components/features/settings'
import { EmptyState } from '#/components/ui/empty-state'
import { Award } from 'lucide-react'
import { badgeKeys } from '#/shared/queries/query-keys'
import { gateDarkRoute } from '#/shared/auth/dark-route-gate'

const badgeDefinitionsQuery = queryOptions({
  queryKey: badgeKeys.orgDefinitions(),
  queryFn: () => getOrganizationBadgeDefinitionsFn(),
  staleTime: 60_000,
})

export const Route = createFileRoute('/_authenticated/settings/recognition')({
  beforeLoad: async ({ context }) => {
    await gateDarkRoute('badge.use', 'Recognition')
    const { role } = context as AuthRouteContext
    if (!can(role, 'badge.manage')) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  loader: async ({ context }) => {
    const badges = await context.queryClient.ensureQueryData(badgeDefinitionsQuery)
    return { badges }
  },
  staleTime: 60_000,
  component: RecognitionSettings,
})

function RecognitionSettings() {
  const { data: badges } = useSuspenseQuery(badgeDefinitionsQuery)
  const toggleBadge = useActionMutation(setOrganizationBadgeEnablement, {
    successMessage: 'Badge setting updated',
    invalidateKeys: [badgeKeys.orgDefinitions()],
  })

  return (
    <>
      <PageHeader
        title="Recognition"
        description="Control which achievement badges are active for your organization."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Recognition' }]}
      />
      <div className="mt-6">
        {badges.length > 0 ? (
          <RecognitionSettingsPage badges={badges} toggleBadge={toggleBadge} />
        ) : (
          <EmptyState icon={Award} title="No badges available">
            <p className="text-sm text-muted-foreground">
              Badge definitions are seeded automatically. If this persists, contact
              support.
            </p>
          </EmptyState>
        )}
      </div>
    </>
  )
}
