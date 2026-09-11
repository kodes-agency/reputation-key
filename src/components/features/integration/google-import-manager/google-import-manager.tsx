import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { GoogleImportManagerProps } from './google-import-manager-contract'
import { GoogleImportManagerView } from './google-import-manager-view'
import { GoogleImportProgressView } from './google-import-progress-view'
import { GoogleImportRecoveryStatus } from './google-import-loading-rows'
import {
  connectionCallbackErrorMessage,
  startErrorMessage,
} from './google-import-error-messages'
import { buildConfirmedImportItems } from './google-import-review-model'
import type { ImportReviewDraft } from './google-import-review-model'
import { useGoogleImport } from './use-google-import'
import { useGoogleImportProgress } from './use-google-import-progress'

const IMPORT_RECOVERY_DELAYS_MS = [0, 250, 750] as const

export function GoogleImportManager({
  organizationId,
  connections,
  initialConnectionId,
  initialProgress = null,
  initialRequestId,
  initialError,
  importFns,
  aiFns,
}: GoogleImportManagerProps) {
  const navigate = useNavigate()
  const mounted = useRef(true)
  const startInFlight = useRef(false)
  const ownedRequestId = useRef<string | null>(null)
  const recoveryStartedRequestId = useRef<string | null>(null)
  const [startPending, setStartPending] = useState(false)
  // Mirrors the route banner so the same callback never reads as two outcomes.
  const [startError, setStartError] = useState<string | null>(() =>
    connectionCallbackErrorMessage(initialError),
  )
  const [isRecoveringRequest, setIsRecoveringRequest] = useState(false)
  const clearStartError = useCallback(() => setStartError(null), [])
  const discovery = useGoogleImport({
    organizationId,
    connections,
    initialConnectionId,
    initialProgress,
    initialRequestId,
    importFns,
    onClearStartError: clearStartError,
  })
  const progress = useGoogleImportProgress({
    initialProgress,
    importFns,
    step: discovery.step,
    setStep: discovery.setStep,
  })
  const { loadProgress } = progress

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const recoverRequest = useCallback(
    async (requestId: string): Promise<string | null> => {
      for (const delayMs of IMPORT_RECOVERY_DELAYS_MS) {
        if (!mounted.current) return null
        if (delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs))
        }
        if (!mounted.current) return null
        try {
          const recovered = await importFns.recoverPropertyImportV2({
            data: { requestId },
          })
          if (recovered.requestId === requestId) return recovered.importJobId
        } catch {
          // Retry the same tenant-scoped receipt while a reloaded start commits.
        }
      }
      return null
    },
    [importFns],
  )
  // Provider content is cleared by the discovery hook's unmount cleanup when
  // the route changes; clearing it here first reset the step to discovery and
  // flashed the empty discovery panel between the click and the progress view.
  const openProgress = useCallback(
    async (importJobId: string) => {
      await loadProgress(importJobId)
      if (mounted.current) setStartError(null)
    },
    [loadProgress],
  )
  useEffect(() => {
    if (
      !initialRequestId ||
      initialProgress ||
      ownedRequestId.current === initialRequestId ||
      recoveryStartedRequestId.current === initialRequestId
    ) {
      return
    }
    recoveryStartedRequestId.current = initialRequestId
    setIsRecoveringRequest(true)
    void (async () => {
      try {
        const recoveredId = await recoverRequest(initialRequestId)
        if (!mounted.current) return
        if (recoveredId) {
          await openProgress(recoveredId)
        } else {
          setStartError(
            'This import request could not be recovered. Return to properties and start again.',
          )
        }
      } catch {
        if (mounted.current) {
          setStartError(
            'The import status is temporarily unavailable. Refresh this page to try again.',
          )
        }
      } finally {
        if (mounted.current) setIsRecoveringRequest(false)
      }
    })()
  }, [initialProgress, initialRequestId, openProgress, recoverRequest])
  const submitImport = async (reviewDraft: ImportReviewDraft) => {
    if (startInFlight.current) return
    startInFlight.current = true
    const requestId = crypto.randomUUID()
    const submittedEpoch = discovery.lifecycle.epoch()
    const submittedItems = [...buildConfirmedImportItems(reviewDraft)]
    ownedRequestId.current = requestId
    setStartPending(true)
    setStartError(null)
    try {
      await navigate({
        to: '/properties/import-google',
        search: { requestId },
        replace: true,
      })
      const result = await importFns.startPropertyImportV2({
        data: {
          requestId,
          items: submittedItems,
          confirmation: 'apply',
        },
      })
      if (result.requestId !== requestId) throw new Error('import_request_mismatch')
      if (mounted.current && discovery.lifecycle.epoch() === submittedEpoch) {
        await openProgress(result.importJobId)
      }
    } catch (error) {
      const recoveredId = await recoverRequest(requestId)
      if (
        recoveredId &&
        mounted.current &&
        discovery.lifecycle.epoch() === submittedEpoch
      ) {
        await openProgress(recoveredId)
      } else if (
        !recoveredId &&
        mounted.current &&
        discovery.lifecycle.epoch() === submittedEpoch
      ) {
        setStartError(startErrorMessage(error))
      }
    } finally {
      startInFlight.current = false
      if (mounted.current) setStartPending(false)
    }
  }

  if (isRecoveringRequest) return <GoogleImportRecoveryStatus />

  if (discovery.step === 'progress' && progress.progress) {
    return (
      <GoogleImportProgressView
        progress={progress.progress}
        aiFns={aiFns}
        isPollingError={progress.pollingError}
        isRefreshing={progress.isRefreshing}
        retryingItemId={progress.retryingItemId}
        isCancelling={progress.isCancelling}
        onRefresh={() => void progress.refresh()}
        onRetry={(item) => void progress.retry(item)}
        onCancel={() => void progress.cancel()}
      />
    )
  }

  return (
    <GoogleImportManagerView
      connections={connections}
      getAuthUrl={importFns.getGoogleAuthUrl}
      discovery={discovery}
      startPending={startPending}
      startError={startError}
      onSubmit={submitImport}
    />
  )
}
