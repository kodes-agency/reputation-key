import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type {
  ImportProgressDto,
  ImportProgressItemDto,
} from '#/contexts/integration/application/public-api'
import { propertyKeys } from '#/shared/queries/query-keys'
import type {
  GoogleImportFns,
  GoogleImportManagerProps,
  GoogleImportStep,
} from './google-import-manager-contract'
import {
  googleImportProgressPollInterval,
  googleImportStatusQuery,
} from './google-import-queries'
import { isImportParentTerminal } from './google-import-progress-model'

type RetryRequest = Readonly<{
  retryRevision: number
  retryRequestId: string
}>

type Props = Pick<GoogleImportManagerProps, 'initialProgress'> &
  Readonly<{
    importFns: Pick<
      GoogleImportFns,
      'getPropertyImportV2Status' | 'retryPropertyImportItem' | 'cancelPropertyImportV2'
    >
    step: GoogleImportStep
    setStep: (step: GoogleImportStep) => void
  }>

export function getRetryRequest(
  requests: Map<string, RetryRequest>,
  itemId: string,
  retryRevision: number,
  createRequestId: () => string,
): RetryRequest {
  const existing = requests.get(itemId)
  if (existing?.retryRevision === retryRevision) return existing
  const request = { retryRevision, retryRequestId: createRequestId() }
  requests.set(itemId, request)
  return request
}

export async function sendRetryWithOneReplay<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send()
  } catch {
    return send()
  }
}

function terminalImportRevision(progress: ImportProgressDto | undefined): string | null {
  if (!progress || !isImportParentTerminal(progress.status)) return null
  return `${progress.importJobId}:${progress.updatedAt}`
}

function useTerminalImportInvalidation(
  progress: ImportProgressDto | undefined,
  onTerminal: () => Promise<void>,
): void {
  const invalidatedRevision = useRef<string | null>(null)
  useEffect(() => {
    const revision = terminalImportRevision(progress)
    if (revision === null || invalidatedRevision.current === revision) return
    invalidatedRevision.current = revision
    void onTerminal()
  }, [onTerminal, progress])
}

export function useGoogleImportProgress({
  initialProgress,
  importFns,
  step,
  setStep,
}: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const retryRequests = useRef(new Map<string, RetryRequest>())
  const [loadedImportId, setLoadedImportId] = useState<string | null>(null)
  const activeImportId = initialProgress?.importJobId ?? loadedImportId
  const getImportStatus = importFns.getPropertyImportV2Status
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

  const invalidateCompletedImport = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: propertyKeys.list() })
  }, [queryClient])
  useTerminalImportInvalidation(progressQuery.data, invalidateCompletedImport)

  const loadProgress = useCallback(
    async (importJobId: string) => {
      await queryClient.fetchQuery(googleImportStatusQuery(importJobId, getImportStatus))
      setLoadedImportId(importJobId)
      setStep('progress')
      await navigate({
        to: '/properties/import-google/$importId',
        params: { importId: importJobId },
      })
    },
    [getImportStatus, navigate, queryClient, setStep],
  )

  const refresh = useCallback(async (): Promise<ImportProgressDto | null> => {
    if (!activeImportId) return null
    try {
      return await queryClient.fetchQuery(
        googleImportStatusQuery(activeImportId, getImportStatus),
      )
    } catch {
      return null
    }
  }, [activeImportId, getImportStatus, queryClient])

  const {
    mutate: retryItem,
    isPending: retryPending,
    variables: retryVariables,
  } = useMutation({
    mutationFn: async (item: ImportProgressItemDto) => {
      if (!progressQuery.data) return
      const request = getRetryRequest(
        retryRequests.current,
        item.itemId,
        item.retryRevision,
        () => crypto.randomUUID(),
      )
      const send = () =>
        importFns.retryPropertyImportItem({
          data: {
            itemId: item.itemId,
            retryRequestId: request.retryRequestId,
            expectedRetryRevision: request.retryRevision,
          },
        })
      try {
        await sendRetryWithOneReplay(send)
        retryRequests.current.delete(item.itemId)
        await refresh()
      } catch {
        const recovered = await refresh()
        const recoveredItem = recovered?.items.find(
          (candidate) => candidate.itemId === item.itemId,
        )
        if (recoveredItem && recoveredItem.retryRevision > item.retryRevision) {
          retryRequests.current.delete(item.itemId)
        } else {
          toast.error('This item could not be retried. Refresh its status and try again.')
        }
      }
    },
  })

  const { mutate: cancelImport, isPending: isCancelling } = useMutation({
    mutationFn: async () => {
      if (!activeImportId) return
      try {
        const cancelled = await importFns.cancelPropertyImportV2({
          data: { importJobId: activeImportId },
        })
        queryClient.setQueryData(
          googleImportStatusQuery(activeImportId, getImportStatus).queryKey,
          cancelled,
        )
      } catch {
        const recovered = await refresh()
        if (!recovered || !isImportParentTerminal(recovered.status)) {
          toast.error(
            'The import could not be cancelled. Refresh its status and try again.',
          )
        }
      }
    },
  })

  const retry = useCallback(
    (item: ImportProgressItemDto) => {
      if (!retryPending) retryItem(item)
    },
    [retryItem, retryPending],
  )
  const cancel = useCallback(() => {
    if (!isCancelling && activeImportId) cancelImport()
  }, [activeImportId, cancelImport, isCancelling])

  return {
    progress: progressQuery.data ?? null,
    pollingError: progressQuery.isError,
    isRefreshing: progressQuery.isFetching,
    retryingItemId: retryPending ? (retryVariables?.itemId ?? null) : null,
    isCancelling,
    loadProgress,
    refresh,
    retry,
    cancel,
  }
}
