import { useCallback, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type {
  ImportProgressDto,
  ImportProgressItemDto,
} from '#/contexts/integration/application/public-api'
import { propertyKeys } from '#/shared/queries/query-keys'
import type {
  GoogleImportManagerProps,
  GoogleImportStep,
} from './google-import-manager-contract'
import { googleImportStatusQuery } from './google-import-progress-query'
import { isImportParentTerminal } from './google-import-progress-model'
import {
  useGoogleImportProgressQuery,
  useTerminalImportInvalidation,
} from './use-google-import-progress-query'

type RetryRequest = Readonly<{
  retryRevision: number
  retryRequestId: string
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

type Props = Pick<
  GoogleImportManagerProps,
  'initialProgress' | 'getImportStatus' | 'retryImportItem' | 'cancelImport'
> &
  Readonly<{
    step: GoogleImportStep
    setStep: (step: GoogleImportStep) => void
  }>

export function useGoogleImportProgressController({
  initialProgress,
  getImportStatus,
  retryImportItem,
  cancelImport,
  step,
  setStep,
}: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const retryRequests = useRef(new Map<string, RetryRequest>())
  const { activeImportId, progressQuery, setLoadedImportId } =
    useGoogleImportProgressQuery({ initialProgress, getImportStatus, step })

  const invalidateCompletedImport = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: propertyKeys.list() })
  }, [queryClient])

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
    // `setLoadedImportId` is the `useState` setter returned by
    // `useGoogleImportProgressQuery` — stable for the hook's lifetime, but it
    // arrives through a custom hook so the lint rule cannot infer that.
    [getImportStatus, navigate, queryClient, setLoadedImportId, setStep],
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
      const progress = progressQuery.data
      if (!progress) return
      const request = getRetryRequest(
        retryRequests.current,
        item.itemId,
        item.retryRevision,
        () => crypto.randomUUID(),
      )
      const send = () =>
        retryImportItem({
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

  const { mutate: cancelImportRequest, isPending: isCancelling } = useMutation({
    mutationFn: async () => {
      if (!activeImportId) return
      try {
        const cancelled = await cancelImport({
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

  useTerminalImportInvalidation(progressQuery.data, invalidateCompletedImport)

  const retry = useCallback(
    (item: ImportProgressItemDto) => {
      if (retryPending) return
      retryItem(item)
    },
    [retryItem, retryPending],
  )

  const cancel = useCallback(() => {
    if (isCancelling || !activeImportId) return
    cancelImportRequest()
  }, [activeImportId, cancelImportRequest, isCancelling])

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
