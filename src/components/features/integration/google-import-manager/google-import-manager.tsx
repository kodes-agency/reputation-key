import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { GoogleImportManagerProps } from './google-import-manager-contract'
import { GoogleImportManagerView } from './google-import-manager-view'
import { GoogleImportProgressView } from './google-import-progress-view'
import { GoogleImportRecoveryStatus } from './google-import-loading-rows'
import { startErrorMessage } from './google-import-error-messages'
import { buildConfirmedImportItems } from './google-import-review-model'
import { useGoogleImportDiscoveryController } from './use-google-import-discovery-controller'
import { useGoogleImportProgressController } from './use-google-import-progress-controller'

const IMPORT_RECOVERY_DELAYS_MS = [0, 250, 750] as const

export function GoogleImportManager({
  organizationId,
  connections,
  initialConnectionId,
  initialProgress = null,
  initialRequestId,
  initialError,
  getAuthUrl,
  listAccounts,
  listCandidates,
  renewAuthorizationLease,
  startImport,
  recoverImport,
  getImportStatus,
  retryImportItem,
}: GoogleImportManagerProps) {
  const navigate = useNavigate()
  const mounted = useRef(true)
  const startInFlight = useRef(false)
  const ownedRequestId = useRef<string | null>(null)
  const recoveryStartedRequestId = useRef<string | null>(null)
  const [startPending, setStartPending] = useState(false)
  // Copy mirrors the route-level banner in
  // routes/_authenticated/properties/import-google/index.tsx so the same callback
  // code never reads as two different outcomes.
  const [startError, setStartError] = useState<string | null>(
    initialError === 'account_already_connected'
      ? 'That Google account is already connected. Select it above instead of authorizing again.'
      : initialError === 'denied'
        ? 'Google authorization was cancelled.'
        : initialError
          ? 'Google Account connection failed. Try connecting again.'
          : null,
  )
  const [isRecoveringRequest, setIsRecoveringRequest] = useState(false)
  const clearStartError = useCallback(() => setStartError(null), [])
  const discovery = useGoogleImportDiscoveryController({
    organizationId,
    connections,
    initialConnectionId,
    initialProgress,
    initialRequestId,
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

  const recoverRequest = useCallback(
    async (requestId: string): Promise<string | null> => {
      for (const delayMs of IMPORT_RECOVERY_DELAYS_MS) {
        if (!mounted.current) return null
        if (delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs))
        }
        if (!mounted.current) return null
        try {
          const recovered = await recoverImport({ data: { requestId } })
          if (recovered.requestId === requestId) return recovered.importJobId
        } catch {
          // A reloaded start request may still be committing. Retry the bounded,
          // tenant-scoped receipt lookup with the same opaque request ID.
        }
      }
      return null
    },
    [recoverImport],
  )
  const openProgress = useCallback(
    async (importJobId: string) => {
      await discovery.lifecycle.clear('route_left')
      await progress.loadProgress(importJobId)
      if (mounted.current) setStartError(null)
    },
    [discovery.lifecycle, progress.loadProgress],
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
  const submitImport = async () => {
    if (!discovery.reviewDraft || startInFlight.current) return
    startInFlight.current = true
    const requestId = crypto.randomUUID()
    const submittedEpoch = discovery.lifecycle.epoch()
    const submittedItems = [...buildConfirmedImportItems(discovery.reviewDraft)]
    ownedRequestId.current = requestId
    setStartPending(true)
    setStartError(null)
    try {
      await navigate({
        to: '/properties/import-google',
        search: { requestId },
        replace: true,
      })
      const result = await startImport({
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
        isPollingError={progress.pollingError}
        isRefreshing={progress.isRefreshing}
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
