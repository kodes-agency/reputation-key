import type * as SentrySdk from '@sentry/tanstackstart-react'
import { setBrowserExceptionCapture } from '#/shared/observability/browser-exception-capture'
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from '#/shared/observability/sentry-event-scrub'

type BrowserSentrySdk = Pick<typeof SentrySdk, 'captureException' | 'init'>
type BrowserSentryLoader = () => Promise<BrowserSentrySdk>

const MAX_BUFFERED_ERRORS = 10
const loadBrowserSentry: BrowserSentryLoader = () =>
  import('@sentry/tanstackstart-react').then(({ captureException, init }) => ({
    captureException,
    init,
  }))

type BrowserObservabilityDocument = Readonly<{
  querySelector(selector: string): Pick<Element, 'getAttribute'> | null
}>

function metaContent(
  root: BrowserObservabilityDocument,
  name: string,
): string | undefined {
  return root.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? undefined
}

export async function initializeBrowserObservability(
  root: BrowserObservabilityDocument,
  loadSentry: BrowserSentryLoader = loadBrowserSentry,
): Promise<void> {
  setBrowserExceptionCapture()
  const dsn = metaContent(root, 'repkey-sentry-dsn')
  if (!dsn) return

  const bufferedErrors: unknown[] = []
  const bufferError = (error: unknown): void => {
    if (bufferedErrors.length >= MAX_BUFFERED_ERRORS) bufferedErrors.shift()
    bufferedErrors.push(error)
  }
  setBrowserExceptionCapture(bufferError)
  const onError = (event: ErrorEvent): void => {
    bufferError(event.error ?? new Error(event.message || 'Unhandled browser error'))
  }
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    bufferError(event.reason ?? new Error('Unhandled promise rejection'))
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  try {
    const Sentry = await loadSentry()
    Sentry.init({
      dsn,
      release: metaContent(root, 'repkey-sentry-release'),
      environment: metaContent(root, 'repkey-sentry-environment'),
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: scrubSentryEvent,
      beforeBreadcrumb: scrubSentryBreadcrumb,
    })
    setBrowserExceptionCapture((error) => {
      Sentry.captureException(error)
    })
    for (const error of bufferedErrors) Sentry.captureException(error)
  } catch (error) {
    setBrowserExceptionCapture()
    throw error
  } finally {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  // Monitoring fails OPEN, exactly as the server path does: a blocked or
  // failed SDK chunk (ad blocker, CDN outage) must not surface as an
  // unhandled rejection. The exported function still rejects so its own
  // tests can assert the failure path.
  void initializeBrowserObservability(document).catch(() => {})
}
