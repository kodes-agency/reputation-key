import { createFileRoute, useSearch } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
// @ts-expect-error - useQuery will work with TanStack Router loaders after refactor
import { useQuery } from '@tanstack/react-query'
import {
  getGoogleAuthUrl,
  listGoogleConnections,
} from '#/contexts/integration/server/google-connections'
import {
  ConnectGoogleButton,
  ImportConnectedView,
} from '#/components/features/integration'
import { Loader2 } from 'lucide-react'
import { ImportPageHeader } from './-import-page-header'

export const Route = createFileRoute('/_authenticated/properties/import/')({
  component: ImportPage,
})

function ImportPage() {
  const search = useSearch({ strict: false }) as { connectionId?: string; error?: string }
  const listConnections = useServerFn(listGoogleConnections)
  const getAuthUrl = useServerFn(getGoogleAuthUrl)

  const { data: connectionsData, isLoading: isLoadingConnections } = useQuery({
    queryKey: ['google-connections'],
    queryFn: async () => {
      const result = await listConnections()
      return result.connections
    },
    staleTime: 60000,
  })

  const connections = connectionsData ?? []

  if (isLoadingConnections) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <ImportPageHeader />
        <div
          className="flex items-center justify-center py-12"
          role="status"
          aria-live="polite"
        >
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">Loading Google accounts...</span>
        </div>
      </div>
    )
  }

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

      {connections.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border py-12">
          <p className="text-muted-foreground">No Google accounts connected yet.</p>
          <ConnectGoogleButton getAuthUrl={getAuthUrl} />
        </div>
      ) : (
        <ImportConnectedView
          connections={connections}
          initialConnectionId={search.connectionId}
        />
      )}
    </div>
  )
}
