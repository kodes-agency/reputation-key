import * as Sentry from '@sentry/tanstackstart-react'
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from '#/shared/observability/sentry-event-scrub'

type BrowserObservabilityDocument = Readonly<{
  querySelector(selector: string): Pick<Element, 'getAttribute'> | null
}>

function metaContent(
  root: BrowserObservabilityDocument,
  name: string,
): string | undefined {
  return root.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? undefined
}

export function initializeBrowserObservability(root: BrowserObservabilityDocument): void {
  const dsn = metaContent(root, 'repkey-sentry-dsn')
  if (!dsn) return

  Sentry.init({
    dsn,
    release: metaContent(root, 'repkey-sentry-release'),
    environment: metaContent(root, 'repkey-sentry-environment'),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
  })
}

if (typeof document !== 'undefined') initializeBrowserObservability(document)
