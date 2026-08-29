import { AlertCircle } from 'lucide-react'
import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { GoogleImportCandidateList } from './google-import-candidate-list'
import { GoogleImportLoadingRows } from './google-import-loading-rows'

type Props = Readonly<{
  candidates: readonly ImportCandidateDto[]
  selectedIds: ReadonlySet<string>
  isLoading: boolean
  error: string | null
  onToggleCandidate: (candidate: ImportCandidateDto, checked: boolean) => void
  onToggleLoaded: (checked: boolean) => void
}>

/**
 * The four mutually exclusive states of the loaded-location region: provider
 * failure, first load, an empty result for the current search, and the list
 * itself. Kept as early returns so the branch order stays readable.
 */
export function GoogleImportCandidateResults({
  candidates,
  selectedIds,
  isLoading,
  error,
  onToggleCandidate,
  onToggleLoaded,
}: Props) {
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Locations unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  if (isLoading) {
    return <GoogleImportLoadingRows label="Loading Google locations" />
  }
  if (candidates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No matching loaded locations. Clear the search or load another page.
      </p>
    )
  }
  return (
    <GoogleImportCandidateList
      candidates={candidates}
      selectedIds={selectedIds}
      onToggleCandidate={onToggleCandidate}
      onToggleLoaded={onToggleLoaded}
    />
  )
}
