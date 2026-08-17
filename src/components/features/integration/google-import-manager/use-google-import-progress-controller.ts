import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
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
  const mounted = useRef(true)
  const retryRequests = useRef(new Map<string, RetryRequest>())
  const refreshInFlight = useRef<Promise<ImportProgressDto | null> | null>(null)
  const [progress, setProgress] = useState<ImportProgressDto | null>(
    initialProgress ?? null,
  )
  const [pollingError, setPollingError] = useState(false)
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const invalidateCompletedImport = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: propertyKeys.list() }),
      router.invalidate(),
    ])
  }, [queryClient, router])

  const loadProgress = useCallback(
    async (importJobId: string) => {
      const next = await getImportStatus({ data: { importJobId } })
      setProgress(next)
      setStep('progress')
      await navigate({
        to: '/properties/import-google/$importId',
        params: { importId: importJobId },
      })
    },
    [getImportStatus, navigate, setStep],
  )

  const refresh = useCallback(async (): Promise<ImportProgressDto | null> => {
    if (!progress) return null
    if (refreshInFlight.current) return refreshInFlight.current
    if (mounted.current) setIsRefreshing(true)
    const operation = (async () => {
      try {
        const next = await getImportStatus({
          data: { importJobId: progress.importJobId },
        })
        if (!mounted.current) return next
        setProgress(next)
        setPollingError(false)
        if (next.status !== 'queued' && next.status !== 'processing') {
          await invalidateCompletedImport()
        }
        return next
      } catch {
        if (mounted.current) setPollingError(true)
        return null
      }
    })()
    refreshInFlight.current = operation
    try {
      return await operation
    } finally {
      refreshInFlight.current = null
      if (mounted.current) setIsRefreshing(false)
    }
  }, [getImportStatus, invalidateCompletedImport, progress])

  const retry = useCallback(
    async (item: ImportProgressItemDto) => {
      if (!progress || retryingItemId !== null) return
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
      setRetryingItemId(item.itemId)
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
      } finally {
        if (mounted.current) setRetryingItemId(null)
      }
    },
    [progress, refresh, retryImportItem, retryingItemId],
  )

  useEffect(() => {
    if (!progress || step !== 'progress') return
    if (progress.status !== 'queued' && progress.status !== 'processing') return
    if (progress.pollAfterMs === null) return
    const timeout = window.setTimeout(async () => {
      try {
        const next = await getImportStatus({
          data: { importJobId: progress.importJobId },
        })
        if (!mounted.current) return
        setProgress(next)
        setPollingError(false)
        if (next.status !== 'queued' && next.status !== 'processing') {
          await invalidateCompletedImport()
        }
      } catch {
        if (mounted.current) setPollingError(true)
      }
    }, progress.pollAfterMs)
    return () => window.clearTimeout(timeout)
  }, [getImportStatus, invalidateCompletedImport, progress, step])

  return {
    progress,
    pollingError,
    isRefreshing,
    retryingItemId,
    loadProgress,
    refresh,
    retry,
  }
}
