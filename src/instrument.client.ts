import * as Sentry from '@sentry/tanstackstart-react'
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from '#/shared/observability/sentry-event-scrub'

const dsn = document.querySelector<HTMLMetaElement>(
  'meta[name="repkey-sentry-dsn"]',
)?.content

if (dsn) {
  const release = document.querySelector<HTMLMetaElement>(
    'meta[name="repkey-sentry-release"]',
  )?.content
  const environment = document.querySelector<HTMLMetaElement>(
    'meta[name="repkey-sentry-environment"]',
  )?.content

  Sentry.init({
    dsn,
    release,
    environment,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
  })
}
