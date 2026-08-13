import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { can } from '#/shared/domain/permissions'
import type { AuthRouteContext } from '#/routes/_authenticated'
import {
  activateRecognition,
  deactivateRecognition,
  getRecognitionSettings,
} from '#/contexts/leaderboard/server/leaderboards'
import { RecognitionSettingsPage } from '#/components/features/settings'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'

const recognitionSettingsSearch = z.object({
  propertyId: z.string().uuid().optional(),
})

export const Route = createFileRoute('/_authenticated/settings/recognition')({
  validateSearch: recognitionSettingsSearch,
  beforeLoad: async ({ context, search }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'badge.manage')) {
      throw redirect({ to: '/settings/profile' })
    }
    if (!search.propertyId) return
    await Promise.all([
      gateControlledRoute({
        data: {
          capability: 'badge.use',
          featureLabel: 'Recognition',
          propertyId: search.propertyId,
        },
      }),
      gateControlledRoute({
        data: {
          capability: 'leaderboard.use',
          featureLabel: 'Recognition board',
          propertyId: search.propertyId,
        },
      }),
    ])
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => ({
    settings: deps.propertyId
      ? await getRecognitionSettings({ data: { propertyId: deps.propertyId } })
      : null,
  }),
  component: RecognitionSettings,
})

function RecognitionSettings() {
  const { propertyId } = Route.useSearch()
  const { settings } = Route.useLoaderData()
  const activate = useActionMutation(activateRecognition, {
    successMessage: 'Recognition activation saved',
    invalidateKeys: [['recognition-settings', propertyId]],
  })
  const deactivate = useActionMutation(deactivateRecognition, {
    successMessage: 'Recognition deactivated',
    invalidateKeys: [['recognition-settings', propertyId]],
  })

  return (
    <>
      <PageHeader
        title="Recognition"
        description="Activate positive portal-group recognition for one governed property."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Recognition' }]}
      />
      <div className="mt-6">
        {!propertyId || !settings ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            Select a property before configuring recognition.
          </div>
        ) : (
          <RecognitionSettingsPage
            propertyId={propertyId}
            settings={settings}
            activate={activate}
            deactivate={deactivate}
          />
        )}
      </div>
    </>
  )
}
