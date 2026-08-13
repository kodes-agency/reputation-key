import { useCallback, useEffect, useRef, useState } from 'react'
import type { GoogleImportManagerProps } from './google-import-manager-contract'
import { GoogleImportManagerView } from './google-import-manager-view'
import { GoogleImportProgressView } from './google-import-progress-view'
import { startErrorMessage } from './google-import-error-messages'
import { buildConfirmedImportItems } from './google-import-review-model'
import { useGoogleImportDiscoveryController } from './use-google-import-discovery-controller'
import {
  GOOGLE_IMPORT_REQUEST_STORAGE_KEY,
  useGoogleImportProgressController,
} from './use-google-import-progress-controller'

export function GoogleImportManager({
  organizationId,
  connections,
  initialConnectionId,
  initialProgress = null,
  getAuthUrl,
  listAccounts,
  listCandidates,
  renewAuthorizationLease,
  startImport,
  recoverImport,
  getImportStatus,
  retryImportItem,
}: GoogleImportManagerProps) {
  const mounted = useRef(true)
  const [startPending, setStartPending] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const clearStartError = useCallback(() => setStartError(null), [])
  const discovery = useGoogleImportDiscoveryController({
    organizationId,
    connections,
    initialConnectionId,
    initialProgress,
    listAccounts,
    listCandidates,
    renewAuthorizationLease,
    onClearStartError: clearStartError,
  })
  const progress = useGoogleImportProgressController({
    initialProgress,
    getImportStatus,
    retryImportItem,
    step: discovery.step,
    setStep: discovery.setStep,
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const recoverRequest = async (requestId: string): Promise<string | null> => {
    try {
      const recovered = await recoverImport({ data: { requestId } })
      return recovered.importJobId
    } catch {
      return null
    }
  }
  const openProgress = async (importJobId: string) => {
    await discovery.lifecycle.clear('route_left')
    await progress.loadProgress(importJobId)
    setStartError(null)
  }
  const submitImport = async () => {
    if (!discovery.reviewDraft) return
    const requestId = crypto.randomUUID()
    sessionStorage.setItem(GOOGLE_IMPORT_REQUEST_STORAGE_KEY, requestId)
    setStartPending(true)
    setStartError(null)
    try {
      const result = await startImport({
        data: {
          requestId,
          items: [...buildConfirmedImportItems(discovery.reviewDraft)],
          confirmation: 'apply',
        },
      })
      await openProgress(result.importJobId)
    } catch (error) {
      const recoveredId = await recoverRequest(requestId)
      if (recoveredId) await openProgress(recoveredId)
      else if (mounted.current) setStartError(startErrorMessage(error))
    } finally {
      if (mounted.current) setStartPending(false)
    }
  }

  if (discovery.step === 'progress' && progress.progress) {
    return (
      <GoogleImportProgressView
        progress={progress.progress}
        isPollingError={progress.pollingError}
        retryingItemId={progress.retryingItemId}
        onRefresh={() => void progress.refresh()}
        onRetry={(item) => void progress.retry(item)}
      />
    )
  }

  return (
    <GoogleImportManagerView
      connections={connections}
      getAuthUrl={getAuthUrl}
      discovery={discovery}
      startPending={startPending}
      startError={startError}
      onSubmit={() => void submitImport()}
    />
  )
}
