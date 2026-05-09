import { createFileRoute, useSearch } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  getGoogleAuthUrl,
  listGoogleConnections,
} from '#/contexts/integration/server/google-connections'
import {
  ConnectGoogleButton,
  ImportConnectedView,
} from '#/components/features/integration'
import { ImportPageHeader } from './-import-page-header'

export const Route = createFileRoute('/_authenticated/properties/import/')({
  staleTime: 60_000,
  loader: async () => {
    const result = await listGoogleConnections()
    return { connections: result.connections }
  },
  component: ImportPage,
})

function ImportPage() {
  const search = useSearch({ strict: false }) as { connectionId?: string; error?: string }
  const { connections } = Route.useLoaderData()
  const getAuthUrl = useServerFn(getGoogleAuthUrl)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ImportPageHeader showSubtitle />

      {search.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">
            {search.error === 'denied'
              ? 'Google authorization was cancelled.'
              : search.error === 'connection_failed'
                ? 'Failed to connect Google account. Please try again.'
                : 'An error occurred during Google authorization.'}
          </p>
        </div>
      )}

      {[...connections].length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border py-12">
          <p className="text-muted-foreground">No Google accounts connected yet.</p>
          <ConnectGoogleButton getAuthUrl={getAuthUrl} />
        </div>
      ) : (
        <ImportConnectedView
          connections={
            connections as unknown as Array<import('#/shared/domain').GoogleConnection>
          }
          initialConnectionId={search.connectionId}
        />
      )}
    </div>
  )
}
