import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { GoogleAccountSelector } from '#/components/features/integration/google-account-selector'
import { ConnectGoogleButton } from '#/components/features/integration/connect-google-button'
import type { GoogleConnectionDto } from '#/contexts/integration/application/public-api'
import type { listGbpLocations } from '#/contexts/integration/server/gbp-import'
import { ImportLocationsSection } from './import-locations-section'
import { useGbpLocations } from './use-gbp-locations'
import type { Action } from '#/components/hooks/use-action'

type Props = Readonly<{
  connections: ReadonlyArray<GoogleConnectionDto>
  initialConnectionId?: string
  listGbpLocations: typeof listGbpLocations
  getAuthUrl: (opts: {
    data: { visibility: 'private' | 'organization' }
  }) => Promise<{ url: string }>
  importAction: Action<
    {
      data: {
        connectionId: string
        locations: Array<{
          gbpPlaceId: string
          businessName: string
          address: string | null
          primaryCategory: string | null
          gbpLocationName: string
        }>
      }
    },
    { job: { id: string } }
  >
}>

export function ImportConnectedView({
  connections,
  initialConnectionId,
  getAuthUrl,
  importAction,
  listGbpLocations,
}: Props) {
  const navigate = useNavigate()
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>(
    initialConnectionId ?? undefined,
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Data fetching delegated to hook — no effects or fetch callbacks in component
  const { locations, isLoading, error } = useGbpLocations(
    selectedConnectionId,
    listGbpLocations,
  )

  const handleImport = async () => {
    if (!selectedConnectionId || selectedIds.size === 0) return

    const selectedLocations = locations.filter((l) => selectedIds.has(l.gbpPlaceId))

    const job = await importAction({
      data: {
        connectionId: selectedConnectionId,
        locations: selectedLocations.map((l) => ({
          gbpPlaceId: l.gbpPlaceId,
          businessName: l.businessName,
          address: l.address,
          primaryCategory: l.primaryCategory,
          gbpLocationName: l.name,
        })),
      },
    })

    navigate({
      to: '/properties/import/$importId',
      params: { importId: job.job.id },
    })
  }

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
        <ConnectGoogleButton getAuthUrl={getAuthUrl} />
      </div>

      <ImportLocationsSection
        locations={locations}
        isLoading={isLoading}
        error={error}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onImport={handleImport}
        isImporting={importAction.isPending}
        hasConnection={!!selectedConnectionId}
      />
      {importAction.error ? (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
          role="alert"
        >
          <p className="text-sm text-destructive">
            Failed to start import.{' '}
            {importAction.error instanceof Error
              ? importAction.error.message
              : 'Please try again.'}
          </p>
        </div>
      ) : null}
    </div>
  )
}
