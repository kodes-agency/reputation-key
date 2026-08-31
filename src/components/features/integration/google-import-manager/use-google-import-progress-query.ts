import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ImportProgressDto } from '#/contexts/integration/application/public-api'
import type {
  GoogleImportManagerProps,
  GoogleImportStep,
} from './google-import-manager-contract'
import {
  googleImportProgressPollInterval,
  googleImportStatusQuery,
} from './google-import-progress-query'
import { isImportParentTerminal } from './google-import-progress-model'

type Options = Pick<GoogleImportManagerProps, 'initialProgress' | 'getImportStatus'> &
  Readonly<{ step: GoogleImportStep }>

/**
 * Owns which import job the progress screen is watching and the polling query
 * for it. `initialProgress` wins over a job loaded later in the session, and
 * `'inactive-google-import'` is only ever a placeholder key for the disabled
 * query — it is never fetched because `enabled` is false without a real id.
 */
export function useGoogleImportProgressQuery({
  initialProgress,
  getImportStatus,
  step,
}: Options) {
  const [loadedImportId, setLoadedImportId] = useState<string | null>(null)
  const initialImportId = initialProgress?.importJobId ?? null
  const activeImportId = initialImportId ?? loadedImportId
  const progressQuery = useQuery({
    ...googleImportStatusQuery(
      activeImportId ?? 'inactive-google-import',
      getImportStatus,
    ),
    enabled: activeImportId !== null && step === 'progress',
    initialData:
      initialProgress?.importJobId === activeImportId ? initialProgress : undefined,
    refetchInterval: (query) =>
      googleImportProgressPollInterval(query.state.data, step === 'progress'),
    refetchIntervalInBackground: false,
  })

  return { activeImportId, progressQuery, setLoadedImportId }
}

/**
 * Refreshes the caller-supplied caches once per terminal revision of an import.
 * The revision guard is what keeps a settled import from re-invalidating on
 * every poll-driven render.
 */
export function useTerminalImportInvalidation(
  progress: ImportProgressDto | undefined,
  onTerminal: () => Promise<void>,
) {
  const invalidatedTerminalRevision = useRef<string | null>(null)
  useEffect(() => {
    const revision = terminalImportRevision(progress)
    if (revision === null) return
    if (invalidatedTerminalRevision.current === revision) return
    invalidatedTerminalRevision.current = revision
    void onTerminal()
  }, [onTerminal, progress])
}

function terminalImportRevision(progress: ImportProgressDto | undefined): string | null {
  if (!progress || !isImportParentTerminal(progress.status)) return null
  return `${progress.importJobId}:${progress.updatedAt}`
}
