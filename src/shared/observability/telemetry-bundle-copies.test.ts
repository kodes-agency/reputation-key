import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The production web build evaluates telemetry.ts three times: the Node
// --import preload, the Nitro app chunk and the lazy SSR chunk that runs server
// functions. Only the first two call initObservability, so these tests load two
// separate copies of the module and initialize just one, as production does.

const PROCESS_MONITOR_KEY = Symbol.for('repkey.shared.observability.processMonitor')
const EVENT_ID = 'b'.repeat(32)

function fakeSentry() {
  let initialized = false
  const scope = { clear: vi.fn(), addEventProcessor: vi.fn() }
  return {
    init: vi.fn(() => {
      initialized = true
    }),
    isInitialized: vi.fn(() => initialized),
    setTags: vi.fn(),
    captureException: vi.fn(),
    captureFeedback: vi.fn(() => EVENT_ID),
    withScope: vi.fn((callback: (s: typeof scope) => unknown) => callback(scope)),
    withIsolationScope: vi.fn((callback: (s: typeof scope) => unknown) =>
      callback(scope),
    ),
    flush: vi.fn(async () => true),
  }
}

async function loadSeparateCopy(): Promise<typeof import('./telemetry')> {
  vi.resetModules()
  return import('./telemetry')
}

function forgetProcessMonitor(): void {
  delete (globalThis as { [PROCESS_MONITOR_KEY]?: unknown })[PROCESS_MONITOR_KEY]
}

describe('process monitor shared across bundle copies', () => {
  let sentry: ReturnType<typeof fakeSentry>

  beforeEach(() => {
    forgetProcessMonitor()
    sentry = fakeSentry()
    vi.doMock('@sentry/node', () => sentry)
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SENTRY_DSN', 'https://public@o1.ingest.us.sentry.io/1')
    vi.stubEnv('RELEASE_SHA', 'c'.repeat(40))
  })

  afterEach(() => {
    forgetProcessMonitor()
    vi.doUnmock('@sentry/node')
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('delivers beta feedback from a copy the preload never initialized', async () => {
    const preloadCopy = await loadSeparateCopy()
    const serverFunctionCopy = await loadSeparateCopy()
    expect(serverFunctionCopy).not.toBe(preloadCopy)

    expect(preloadCopy.initObservability('web')).toBe('enabled')

    expect(
      serverFunctionCopy.captureObservabilityFeedback({
        message: 'The Inbox will not open',
        source: 'repkey-native-beta-feedback',
        tags: { feedback_type: 'bug' },
      }),
    ).toBe(EVENT_ID)
    expect(sentry.captureFeedback).toHaveBeenCalledOnce()
  })

  it('reports server-route exceptions from a copy the preload never initialized', async () => {
    const preloadCopy = await loadSeparateCopy()
    const serverRouteCopy = await loadSeparateCopy()

    preloadCopy.initObservability('web')
    serverRouteCopy.captureObservabilityException(new Error('upload failed'), {
      source: 'nitro',
    })

    expect(sentry.captureException).toHaveBeenCalledOnce()
  })

  it('initializes the SDK once however many copies ask', async () => {
    const preloadCopy = await loadSeparateCopy()
    const nitroCopy = await loadSeparateCopy()

    expect(preloadCopy.initObservability('web')).toBe('enabled')
    expect(nitroCopy.initObservability('web')).toBe('enabled')

    expect(sentry.init).toHaveBeenCalledOnce()
    expect(sentry.setTags).toHaveBeenCalledOnce()
  })
})
