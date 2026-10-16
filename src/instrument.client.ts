import type * as SentrySdk from '@sentry/tanstackstart-react'
import type * as BrowserErrorEvent from '#/shared/observability/browser-error-event'
import { setBrowserExceptionCapture } from '#/shared/observability/browser-exception-capture'
import { rememberRecordedError } from '#/shared/observability/recorded-browser-errors'

type BrowserSentrySdk = Pick<typeof SentrySdk, 'captureException' | 'init'>
type BrowserSentryLoader = () => Promise<BrowserSentrySdk>
type BrowserEventHooks = Pick<typeof BrowserErrorEvent, 'beforeSend' | 'beforeBreadcrumb'>
type BrowserEventHooksLoader = () => Promise<BrowserEventHooks>

const MAX_BUFFERED_ERRORS = 10
const loadBrowserSentry: BrowserSentryLoader = () =>
  import('@sentry/tanstackstart-react').then(({ captureException, init }) => ({
    captureException,
    init,
  }))
// The event hooks (the scrubber among them) load with the SDK rather than in
// first paint: nothing is sent before the SDK is there to send it.
const loadBrowserEventHooks: BrowserEventHooksLoader = () =>
  import('#/shared/observability/browser-error-event').then(
    ({ beforeSend, beforeBreadcrumb }) => ({ beforeSend, beforeBreadcrumb }),
  )

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
  loadEventHooks: BrowserEventHooksLoader = loadBrowserEventHooks,
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
    const [Sentry, hooks] = await Promise.all([loadSentry(), loadEventHooks()])
    Sentry.init({
      dsn,
      release: metaContent(root, 'repkey-sentry-release'),
      environment: metaContent(root, 'repkey-sentry-environment'),
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // The SDK's BrowserSession default sends the provider a session record
      // on every page load and every client-side navigation, with the
      // browser's user-agent text, and that record passes none of the
      // callbacks below. Nothing reads release health. The Guest Portal
      // footer promises no third-party trackers and the Privacy Notice
      // (section 2) says no record of a page being opened is sent, so the
      // integration is left out. error-monitoring-disclosure.test.ts fails
      // if it comes back while the notice still says so.
      integrations: (defaults) =>
        defaults.filter((integration) => integration.name !== 'BrowserSession'),
      beforeSend: hooks.beforeSend,
      beforeBreadcrumb: hooks.beforeBreadcrumb,
    })
    // The returned event id is the only thing kept: it lets a Bug report point
    // at an exception monitoring already holds, without re-sending anything.
    setBrowserExceptionCapture((error) => {
      rememberRecordedError(Sentry.captureException(error))
    })
    for (const error of bufferedErrors) {
      rememberRecordedError(Sentry.captureException(error))
    }
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
