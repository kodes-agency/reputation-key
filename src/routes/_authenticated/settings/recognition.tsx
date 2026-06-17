import { createFileRoute, redirect } from '@tanstack/react-router'
import { PageHeader } from '#/components/layout/page-header'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { can } from '#/shared/domain/permissions'
import type { AuthRouteContext } from '#/routes/_authenticated'
import {
  getOrganizationBadgeDefinitionsFn,
  setOrganizationBadgeEnablement,
} from '#/contexts/badge/server/badges'
import { RecognitionSettingsPage } from '#/components/features/settings'
import { EmptyState } from '#/components/ui/empty-state'
import { Award } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/settings/recognition')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'badge.manage')) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  loader: async () => {
    const badges = await getOrganizationBadgeDefinitionsFn()
    return { badges }
  },
  staleTime: 60_000,
  component: RecognitionSettings,
})

function RecognitionSettings() {
  const { badges } = Route.useLoaderData()
  const toggleBadge = useMutationAction(setOrganizationBadgeEnablement, {
    successMessage: 'Badge setting updated',
    invalidateRoutes: ['/_authenticated/settings/recognition'],
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
