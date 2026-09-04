import { beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => ({ init: vi.fn() }))

vi.mock('@sentry/tanstackstart-react', () => ({ init: sentry.init }))

import { initializeBrowserObservability } from '#/instrument.client'
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from '#/shared/observability/sentry-event-scrub'

function metaDocument(contents: Readonly<Record<string, string>>) {
  return {
    querySelector(selector: string) {
      const content = contents[selector]
      if (content === undefined) return null
      return {
        getAttribute(attribute: string) {
          return attribute === 'content' ? content : null
        },
      }
    },
  }
}

describe('browser observability initialization', () => {
  beforeEach(() => sentry.init.mockClear())

  it('does not initialize Sentry without a DSN meta tag', () => {
    initializeBrowserObservability(
      metaDocument({
        'meta[name="repkey-sentry-release"]': 'release-without-dsn',
      }),
    )

    expect(sentry.init).not.toHaveBeenCalled()
  })

  it('initializes once from meta tags with privacy-safe defaults and shared scrubbers', () => {
    const dsn = 'https://public@o1.ingest.us.sentry.io/1'
    const release = 'b'.repeat(40)
    const environment = 'google-closed-beta'

    initializeBrowserObservability(
      metaDocument({
        'meta[name="repkey-sentry-dsn"]': dsn,
        'meta[name="repkey-sentry-release"]': release,
        'meta[name="repkey-sentry-environment"]': environment,
      }),
    )

    expect(sentry.init).toHaveBeenCalledOnce()
    expect(sentry.init).toHaveBeenCalledWith({
      dsn,
      release,
      environment,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: scrubSentryEvent,
      beforeBreadcrumb: scrubSentryBreadcrumb,
    })
  })
})
