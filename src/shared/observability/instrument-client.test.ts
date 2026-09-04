import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeBrowserObservability } from '#/instrument.client'
import { captureBrowserException } from '#/shared/observability/browser-exception-capture'
import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from '#/shared/observability/sentry-event-scrub'

const sentry = {
  init: vi.fn((options: unknown) => void options),
  captureException: vi.fn((exception: unknown) => {
    void exception
    return 'event-id'
  }),
}

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

function errorWindow() {
  type EventType = 'error' | 'unhandledrejection'
  type Listener = (event: unknown) => void
  const listeners: Record<EventType, Set<Listener>> = {
    error: new Set(),
    unhandledrejection: new Set(),
  }
  const addEventListener = vi.fn((type: EventType, listener: Listener) => {
    listeners[type].add(listener)
  })
  const removeEventListener = vi.fn((type: EventType, listener: Listener) => {
    listeners[type].delete(listener)
  })

  return {
    target: { addEventListener, removeEventListener },
    addEventListener,
    removeEventListener,
    dispatch(type: EventType, event: unknown) {
      for (const listener of listeners[type]) listener(event)
    },
    listenerCount() {
      return listeners.error.size + listeners.unhandledrejection.size
    },
  }
}

function configuredDocument() {
  return metaDocument({
    'meta[name="repkey-sentry-dsn"]': 'https://public@o1.ingest.us.sentry.io/1',
    'meta[name="repkey-sentry-release"]': 'b'.repeat(40),
    'meta[name="repkey-sentry-environment"]': 'google-closed-beta',
  })
}

describe('browser observability initialization', () => {
  beforeEach(() => {
    sentry.init.mockClear()
    sentry.captureException.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('does not load Sentry or leave listeners when no DSN meta tag exists', async () => {
    const errors = errorWindow()
    const loadSentry = vi.fn(async () => sentry)
    vi.stubGlobal('window', errors.target)

    await initializeBrowserObservability(
      metaDocument({
        'meta[name="repkey-sentry-release"]': 'release-without-dsn',
      }),
      loadSentry,
    )

    expect(loadSentry).not.toHaveBeenCalled()
    expect(sentry.init).not.toHaveBeenCalled()
    expect(errors.addEventListener).not.toHaveBeenCalled()
    expect(errors.removeEventListener).not.toHaveBeenCalled()
    expect(errors.listenerCount()).toBe(0)
  })

  it('initializes once, replays a buffered error once, and removes listeners', async () => {
    const errors = errorWindow()
    const loadSentry = vi.fn(async () => sentry)
    const bufferedError = new Error('before Sentry loaded')
    vi.stubGlobal('window', errors.target)

    const initialized = initializeBrowserObservability(configuredDocument(), loadSentry)
    errors.dispatch('error', { error: bufferedError, message: bufferedError.message })
    await initialized

    expect(loadSentry).toHaveBeenCalledOnce()
    expect(sentry.init).toHaveBeenCalledOnce()
    expect(sentry.init).toHaveBeenCalledWith({
      dsn: 'https://public@o1.ingest.us.sentry.io/1',
      release: 'b'.repeat(40),
      environment: 'google-closed-beta',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: scrubSentryEvent,
      beforeBreadcrumb: scrubSentryBreadcrumb,
    })
    expect(sentry.captureException).toHaveBeenCalledOnce()
    expect(sentry.captureException).toHaveBeenCalledWith(bufferedError)
    expect(errors.removeEventListener).toHaveBeenCalledTimes(2)
    expect(errors.listenerCount()).toBe(0)
  })
  it('buffers a route-boundary exception while the SDK import is pending', async () => {
    const errors = errorWindow()
    const loadSentry = vi.fn(async () => sentry)
    const routeError = new Error('route failed during SDK import')
    vi.stubGlobal('window', errors.target)

    const initialized = initializeBrowserObservability(configuredDocument(), loadSentry)
    captureBrowserException(routeError)
    await initialized

    expect(sentry.captureException).toHaveBeenCalledOnce()
    expect(sentry.captureException).toHaveBeenCalledWith(routeError)
    expect(errors.listenerCount()).toBe(0)
  })

  it('caps the buffer at ten entries by dropping the oldest error', async () => {
    const errors = errorWindow()
    const loadSentry = vi.fn(async () => sentry)
    const bufferedErrors = Array.from(
      { length: 11 },
      (_, index) => new Error(`buffered ${String(index + 1)}`),
    )
    vi.stubGlobal('window', errors.target)

    const initialized = initializeBrowserObservability(configuredDocument(), loadSentry)
    for (const error of bufferedErrors) {
      errors.dispatch('unhandledrejection', { reason: error })
    }
    await initialized

    expect(sentry.captureException.mock.calls.map(([error]) => error)).toEqual(
      bufferedErrors.slice(1),
    )
    expect(errors.listenerCount()).toBe(0)
  })
})
