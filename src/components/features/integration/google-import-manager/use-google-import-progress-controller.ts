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

export const GOOGLE_IMPORT_REQUEST_STORAGE_KEY = 'repkey.google-import.request-id'

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
  const [progress, setProgress] = useState<ImportProgressDto | null>(
    initialProgress ?? null,
  )
  const [pollingError, setPollingError] = useState(false)
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null)

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
      sessionStorage.removeItem(GOOGLE_IMPORT_REQUEST_STORAGE_KEY)
      setProgress(next)
      setStep('progress')
      await navigate({ to: '/import/$importId', params: { importId: importJobId } })
    },
    [getImportStatus, navigate, setStep],
  )

  const refresh = useCallback(async () => {
    if (!progress) return
    try {
      setProgress(await getImportStatus({ data: { importJobId: progress.importJobId } }))
      setPollingError(false)
    } catch {
      setPollingError(true)
    }
  }, [getImportStatus, progress])

  const retry = useCallback(
    async (item: ImportProgressItemDto) => {
      if (!progress) return
      setRetryingItemId(item.itemId)
      try {
        await retryImportItem({
          data: {
            itemId: item.itemId,
            retryRequestId: crypto.randomUUID(),
            expectedRetryRevision: item.retryRevision,
          },
        })
        await refresh()
      } catch {
        toast.error('This item could not be retried. Refresh its status and try again.')
      } finally {
        if (mounted.current) setRetryingItemId(null)
      }
    },
    [progress, refresh, retryImportItem],
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

  return { progress, pollingError, retryingItemId, loadProgress, refresh, retry }
}
