import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
// @ts-expect-error - useQuery will work with TanStack Router loaders after refactor
import { useQuery, useMutation } from '@tanstack/react-query'
import { listGoogleConnections } from '#/contexts/integration/server/google-connections'
import { listGbpLocations } from '#/contexts/integration/server/gbp-import'
import { startPropertyImport } from '#/contexts/integration/server/gbp-import'
import {
  ConnectGoogleButton,
  GoogleAccountSelector,
  LocationPicker,
} from '#/components/features/integration'
import { Button } from '#/components/ui/button'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Loader2 } from 'lucide-react'

// @ts-expect-error - Route will be registered after router codegen
export const Route = createFileRoute('/_authenticated/properties/import/')({
  component: ImportPage,
})

function ImportPage() {
  const navigate = useNavigate()
  const listConnections = useServerFn(listGoogleConnections)
  const listLocations = useServerFn(listGbpLocations)
  const startImport = useServerFn(startPropertyImport)

  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>(
    undefined,
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data: connectionsData, isLoading: isLoadingConnections } = useQuery({
    queryKey: ['google-connections'],
    queryFn: async () => {
      const result = await listConnections()
      return result.connections
    },
    staleTime: 60000,
  })

  const connections = connectionsData ?? []

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

  const locations = locationsData ?? []

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!selectedConnectionId || selectedIds.size === 0) {
        throw new Error('No locations selected')
      }

      // @ts-expect-error - l will have proper type after refactor
      const selectedLocations = locations.filter((l) => selectedIds.has(l.gbpPlaceId))

      const result = await startImport({
        data: {
          connectionId: selectedConnectionId,
          // @ts-expect-error - l will have proper type after refactor
          locations: selectedLocations.map((l) => ({
            gbpPlaceId: l.gbpPlaceId,
            businessName: l.businessName,
            address: l.address,
            primaryCategory: l.primaryCategory,
            latitude: null,
            longitude: null,
          })),
        },
      })

      return result.job
    },
    onSuccess: (job: { id: string }) => {
      navigate({
        // @ts-expect-error - Route will be registered after router codegen
        to: '/properties/import/$importId',
        // @ts-expect-error - Route params will be available after router codegen
        params: { importId: job.id },
      })
    },
  })

  if (isLoadingConnections) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/properties">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Import Properties</h1>
          </div>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/properties">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Import Properties</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Import properties from your Google Business Profile
          </p>
        </div>
      </div>

      {connections.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border py-12">
          <p className="text-muted-foreground">No Google accounts connected yet.</p>
          <ConnectGoogleButton />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Google Account</label>
            <GoogleAccountSelector
              connections={connections}
              value={selectedConnectionId}
              onValueChange={setSelectedConnectionId}
            />
            <Link
              // @ts-expect-error - Route will be registered after router codegen
              to="/api/integration/google/auth"
              className="text-sm text-primary hover:underline"
            >
              Connect another account
            </Link>
          </div>

          {isLoadingLocations && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {locationsError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <p className="text-sm text-destructive">
                Failed to load locations. Please try selecting a different account.
              </p>
            </div>
          )}

          {!isLoadingLocations && !locationsError && locations.length > 0 && (
            <>
              <LocationPicker
                locations={locations}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
              />
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedIds.size} of {locations.length} selected
                </p>
                <Button
                  onClick={() => importMutation.mutate()}
                  disabled={selectedIds.size === 0 || importMutation.isPending}
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    `Import ${selectedIds.size} ${
                      selectedIds.size === 1 ? 'property' : 'properties'
                    }`
                  )}
                </Button>
              </div>
            </>
          )}

          {!isLoadingLocations &&
            !locationsError &&
            selectedConnectionId &&
            locations.length === 0 && (
              <p className="text-center text-muted-foreground py-12">
                No locations found for this account.
              </p>
            )}
        </div>
      )}
    </div>
  )
}
