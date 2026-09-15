import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  discoveryWizardStep,
  importWizardStep,
  SetupPropertiesStep,
  SetupWizard,
} from '#/components/features/property-setup'
import type { GoogleImportManagerProps } from './google-import-manager-contract'
import { GoogleImportManagerView } from './google-import-manager-view'
import { GoogleImportProgressView } from './google-import-progress-view'
import { GoogleImportRecoveryStatus } from './google-import-loading-rows'
import {
  importedPropertiesForAi,
  isImportParentTerminal,
} from './google-import-progress-model'
import {
  connectionCallbackErrorMessage,
  startErrorMessage,
  startErrorRequiresNewRequest,
} from './google-import-error-messages'
import { buildConfirmedImportItems } from './google-import-review-model'
import type { ImportReviewDraft } from './google-import-review-model'
import { startGoogleImport } from './google-import-start'
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
  setupFns,
  viewerUserId,
}: GoogleImportManagerProps) {
  const navigate = useNavigate()
  const mounted = useRef(true)
  const startInFlight = useRef(false)
  const ownedRequestId = useRef<string | null>(null)
  // The idempotency handle for the confirmed import being started. It survives
  // a failed attempt so a retry replays a request that may have committed.
  const pendingRequestId = useRef<string | null>(null)
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
    const submittedItems = buildConfirmedImportItems(reviewDraft)
    startInFlight.current = true
    const submittedEpoch = discovery.lifecycle.epoch()
    pendingRequestId.current ??= crypto.randomUUID()
    const requestId = pendingRequestId.current
    ownedRequestId.current = requestId
    setStartPending(true)
    setStartError(null)
    try {
      const outcome = await startGoogleImport({
        requestId,
        items: submittedItems,
        start: importFns.startPropertyImportV2,
        recover: recoverRequest,
        isCurrent: () =>
          mounted.current && discovery.lifecycle.epoch() === submittedEpoch,
        navigateToRequest: async (committedRequestId) => {
          await navigate({
            to: '/properties/import-google',
            search: { requestId: committedRequestId },
            replace: true,
          })
        },
        openProgress,
      })
      if (outcome.kind === 'failed') {
        if (startErrorRequiresNewRequest(outcome.error)) pendingRequestId.current = null
        setStartError(startErrorMessage(outcome.error))
      } else if (outcome.kind !== 'abandoned') {
        pendingRequestId.current = null
      }
    } catch {
      // The import committed and the URL already names it; only opening its
      // progress failed, and a reload recovers it from the request id.
      if (mounted.current) {
        setStartError(
          'The import started, but its progress could not be loaded. Refresh this page to open it.',
        )
      }
    } finally {
      startInFlight.current = false
      if (mounted.current) setStartPending(false)
    }
  }

  if (isRecoveringRequest) {
    return (
      <SetupWizard step="import">
        <GoogleImportRecoveryStatus />
      </SetupWizard>
    )
  }

  if (discovery.step === 'progress' && progress.progress) {
    const importedProperties = importedPropertiesForAi(progress.progress)
    return (
      <SetupWizard
        step={importWizardStep({
          settled: isImportParentTerminal(progress.progress.status),
          importedPropertyCount: importedProperties.length,
        })}
      >
        <GoogleImportProgressView
          progress={progress.progress}
          isPollingError={progress.pollingError}
          isRefreshing={progress.isRefreshing}
          retryingItemId={progress.retryingItemId}
          isCancelling={progress.isCancelling}
          onRefresh={() => void progress.refresh()}
          onRetry={(item) => void progress.retry(item)}
          onCancel={() => void progress.cancel()}
          setupStep={
            <SetupPropertiesStep
              properties={importedProperties}
              fns={setupFns}
              viewerUserId={viewerUserId}
            />
          }
        />
      </SetupWizard>
    )
  }

  return (
    <SetupWizard
      step={discoveryWizardStep({
        connections,
        connectionId: discovery.connectionId,
        step: discovery.step,
      })}
    >
      <GoogleImportManagerView
        connections={connections}
        getAuthUrl={importFns.getGoogleAuthUrl}
        discovery={discovery}
        startPending={startPending}
        startError={startError}
        onSubmit={submitImport}
      />
    </SetupWizard>
  )
}
