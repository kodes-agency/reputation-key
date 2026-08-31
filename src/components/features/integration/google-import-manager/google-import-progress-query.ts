import { queryOptions } from '@tanstack/react-query'
import type { ImportProgressDto } from '#/contexts/integration/application/public-api'
import { integrationKeys } from '#/shared/queries/query-keys'
import { isImportParentTerminal } from './google-import-progress-model'

export type GoogleImportStatusLoader = (input: {
  data: { importJobId: string }
}) => Promise<ImportProgressDto>

export function googleImportStatusQuery(
  importJobId: string,
  getImportStatus: GoogleImportStatusLoader,
) {
  return queryOptions({
    queryKey: integrationKeys.import(importJobId),
    queryFn: () => getImportStatus({ data: { importJobId } }),
    staleTime: 0,
    retry: false,
  })
}

export function googleImportProgressPollInterval(
  progress: ImportProgressDto | undefined,
  active: boolean,
): number | false {
  if (!active || !progress || isImportParentTerminal(progress.status)) return false
  return progress.pollAfterMs ?? false
}
