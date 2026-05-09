// Server import exception: 6 mutations (getAuthUrl, listLocations, startImport + state orchestration)
import { useState, useEffect } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { getGoogleAuthUrl } from '#/contexts/integration/server/google-connections'
import {
  listGbpLocations,
  startPropertyImport,
} from '#/contexts/integration/server/gbp-import'
import { GoogleAccountSelector } from '#/components/features/integration'
import type { GoogleConnection } from '#/shared/domain'
import { ImportLocationsSection } from './import-locations-section'

type Props = Readonly<{
  connections: GoogleConnection[]
  initialConnectionId?: string
}>

export function ImportConnectedView({ connections, initialConnectionId }: Props) {
  const navigate = useNavigate()
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>(
    initialConnectionId ?? undefined,
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isConnectingNewAccount, setIsConnectingNewAccount] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const getAuthUrl = useServerFn(getGoogleAuthUrl)
  const listLocations = useServerFn(listGbpLocations)
  const startImport = useServerFn(startPropertyImport)

  useEffect(() => {
    if (initialConnectionId && connections.length > 0) {
      setSelectedConnectionId(initialConnectionId)
    }
  }, [initialConnectionId, connections])

  const {
    data: locationsData,
    isLoading: isLoadingLocations,
    error: locationsError,
  } = useQuery({
    queryKey: ['gbp-locations', selectedConnectionId],
    queryFn: async () => {
      if (!selectedConnectionId) throw new Error('No connection selected')
      const result = await listLocations({ data: { connectionId: selectedConnectionId } })
      return result.locations
    },
    enabled: !!selectedConnectionId,
    staleTime: 30000,
  })

  const locations = locationsData ? [...locationsData] : []

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!selectedConnectionId || selectedIds.size === 0) {
        throw new Error('No locations selected')
      }

      const selectedLocations = locations.filter((l) => selectedIds.has(l.gbpPlaceId))

      const result = await startImport({
        data: {
          connectionId: selectedConnectionId,
          locations: selectedLocations.map((l) => ({
            gbpPlaceId: l.gbpPlaceId,
            businessName: l.businessName,
            address: l.address,
            primaryCategory: l.primaryCategory,
          })),
        },
      })

      return result.job
    },
    onSuccess: (job: { id: string }) => {
      navigate({
        to: '/properties/import/$importId',
        params: { importId: job.id },
      })
    },
  })

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="google-account-select" className="text-sm font-medium">
          Google Account
        </label>
        <GoogleAccountSelector
          connections={connections}
          value={selectedConnectionId}
          onValueChange={(id) => {
            setSelectedConnectionId(id)
            setSelectedIds(new Set())
          }}
        />
        <button
          type="button"
          onClick={async () => {
            try {
              setIsConnectingNewAccount(true)
              setConnectError(null)
              const result = await getAuthUrl({ data: { visibility: 'private' } })
              window.location.href = result.url
            } catch (err) {
              console.error('Failed to connect Google account:', err)
              setConnectError('Failed to connect Google account. Please try again.')
              setIsConnectingNewAccount(false)
            }
          }}
          disabled={isConnectingNewAccount}
          className="text-sm text-primary hover:underline disabled:opacity-50"
        >
          {isConnectingNewAccount ? 'Connecting...' : 'Connect another account'}
        </button>
        {connectError && (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {connectError}
          </p>
        )}
      </div>

      <ImportLocationsSection
        locations={locations}
        isLoading={isLoadingLocations}
        error={locationsError}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onImport={() => importMutation.mutate()}
        isImporting={importMutation.isPending}
        hasConnection={!!selectedConnectionId}
      />
      {importMutation.isError && (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
          role="alert"
        >
          <p className="text-sm text-destructive">
            Failed to start import.{' '}
            {importMutation.error instanceof Error
              ? importMutation.error.message
              : 'Please try again.'}
          </p>
        </div>
      )}
    </div>
  )
}
