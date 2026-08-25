import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import {
  googleImportProgressPollInterval,
  googleImportStatusQuery,
} from './google-import-progress-query'
import { isImportParentTerminal } from './google-import-progress-model'

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
  'initialProgress' | 'getImportStatus' | 'retryImportItem'
> &
  Readonly<{
    step: GoogleImportStep
    setStep: (step: GoogleImportStep) => void
  }>

export function useGoogleImportProgressController({
  initialProgress,
  getImportStatus,
  retryImportItem,
  step,
  setStep,
}: Props) {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const retryRequests = useRef(new Map<string, RetryRequest>())
  const invalidatedTerminalRevision = useRef<string | null>(null)
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

  const invalidateCompletedImport = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: propertyKeys.list() }),
      router.invalidate(),
    ])
  }, [queryClient, router])

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

  const retryMutation = useMutation({
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

  useEffect(() => {
    const progress = progressQuery.data
    if (!progress || !isImportParentTerminal(progress.status)) return
    const revision = `${progress.importJobId}:${progress.updatedAt}`
    if (invalidatedTerminalRevision.current === revision) return
    invalidatedTerminalRevision.current = revision
    void invalidateCompletedImport()
  }, [invalidateCompletedImport, progressQuery.data])

  const retry = useCallback(
    (item: ImportProgressItemDto) => {
      if (retryMutation.isPending) return
      retryMutation.mutate(item)
    },
    [retryMutation],
  )

  return {
    progress: progressQuery.data ?? null,
    pollingError: progressQuery.isError,
    isRefreshing: progressQuery.isFetching,
    retryingItemId: retryMutation.isPending
      ? (retryMutation.variables?.itemId ?? null)
      : null,
    loadProgress,
    refresh,
    retry,
  }
}
