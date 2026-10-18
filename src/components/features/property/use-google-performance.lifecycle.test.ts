// A property's Google performance read is cancelled whenever its section leaves
// the screen or the page is hidden (`clearQueryKey` in use-google-performance.ts
// removes the query, which aborts the request in flight). The browser answers an
// abort by rejecting the pending call with an `AbortError`, and that rejection
// must have a handler: an unhandled one reaches error monitoring as an issue for
// what is a normal navigation (Sentry JAVASCRIPT-TANSTACKSTART-REACT-Y).
//
// The unit project has no DOM, so the hook is mounted on React DOM's real
// reconciler over a stand-in document that has only what the hook touches: an
// event target for `visibilitychange` and `pagehide`, and a container that
// draws nothing. The server function stands in for the browser's `fetch`: it
// rejects with the signal's reason when it is aborted, which is what Chrome does.

import { act, createElement } from 'react'
import {
  QueryClient,
  QueryClientProvider,
  environmentManager,
} from '@tanstack/react-query'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { GooglePerformanceServerFns } from './use-google-performance'

vi.mock('@tanstack/react-start', () => ({
  // Without the router: the real one only adds redirect handling around the call.
  useServerFn:
    <A extends unknown[], R>(serverFn: (...args: A) => Promise<R>) =>
    (...args: A) =>
      serverFn(...args),
}))

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener))
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type))
  }
}

const IDLE = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25))

type ServerCall = Readonly<{ signal: AbortSignal }>

/** A read the browser has sent and the server has not answered. */
function pendingServerFn(rejectWith: (signal: AbortSignal) => unknown) {
  const calls: ServerCall[] = []
  const fn = vi.fn(({ signal }: { signal: AbortSignal }) => {
    calls.push({ signal })
    return new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(rejectWith(signal)))
    })
  })
  return { calls, fn }
}

describe('use-google-performance cancellation', () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)
  let page: FakeEventTarget & { visibilityState: string }
  let root: { render(node: unknown): void; unmount(): void } | undefined
  let useGooglePerformance: typeof import('./use-google-performance').useGooglePerformance
  let createRoot: typeof import('react-dom/client').createRoot

  beforeAll(async () => {
    page = Object.assign(new FakeEventTarget(), { visibilityState: 'visible' })
    const view = Object.assign(new FakeEventTarget(), {
      document: page,
      setTimeout,
      clearTimeout,
      HTMLIFrameElement: class {},
    })
    Object.assign(page, { defaultView: view, activeElement: null })
    vi.stubGlobal('window', view)
    vi.stubGlobal('document', page)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    environmentManager.setIsServer(() => false)
    ;({ createRoot } = await import('react-dom/client'))
    ;({ useGooglePerformance } = await import('./use-google-performance'))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    environmentManager.setIsServer(() => typeof window === 'undefined')
  })

  beforeEach(() => {
    unhandled.length = 0
    page.visibilityState = 'visible'
    process.on('unhandledRejection', onUnhandled)
  })

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
  })

  async function mount(serverFns: GooglePerformanceServerFns): Promise<void> {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
    })
    const Section = () => {
      useGooglePerformance({ propertyId: 'property-1', preset: '30d', serverFns })
      return null
    }
    const container = Object.assign(new FakeEventTarget(), {
      nodeType: 1,
      nodeName: 'DIV',
      tagName: 'DIV',
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      ownerDocument: page,
    })
    root = createRoot(container as unknown as Element)
    await act(async () => {
      root!.render(createElement(QueryClientProvider, { client }, createElement(Section)))
    })
    await IDLE()
  }

  const serverFns = (getPerformance: unknown): GooglePerformanceServerFns =>
    ({
      getPerformance,
      renewLease: vi.fn(),
    }) as unknown as GooglePerformanceServerFns

  it.each([
    [
      'an abort that rejects the call with the signal reason',
      (signal: AbortSignal) => signal.reason,
    ],
    [
      'an abort that rejects the call with the browser own AbortError',
      () => new DOMException('The user aborted a request.', 'AbortError'),
    ],
  ])(
    'leaves no unhandled rejection when the section unmounts mid-read: %s',
    async (_label, rejectWith) => {
      const pending = pendingServerFn(rejectWith)
      await mount(serverFns(pending.fn))
      expect(pending.calls).toHaveLength(1)
      expect(pending.calls[0]!.signal.aborted).toBe(false)

      await act(async () => {
        root!.unmount()
      })
      await IDLE()

      expect(pending.calls[0]!.signal.aborted).toBe(true)
      expect(unhandled).toEqual([])
    },
  )

  it('leaves no unhandled rejection when the section unmounts mid-renewal of its lease', async () => {
    const inAnHour = new Date(Date.now() + 3_600_000).toISOString()
    // Renewed every 40 ms here instead of the production 10 s, so the test waits
    // for the real interval rather than faking time under React's scheduler.
    const lease = {
      leaseRef: 'lease-1',
      expiresAt: inAnHour,
      ttlSeconds: 60,
      renewAfterMs: 40,
    }
    const ready = {
      status: 'ready',
      data: {
        retrievedAt: new Date().toISOString(),
        contentExpiresAt: inAnHour,
        authorizationLease: lease,
      },
    }
    const renewal = pendingServerFn((signal) => signal.reason)
    await mount({
      getPerformance: vi.fn(async () => ready),
      renewLease: renewal.fn,
    } as unknown as GooglePerformanceServerFns)
    await vi.waitFor(() => expect(renewal.calls).toHaveLength(1), { timeout: 2_000 })

    await act(async () => {
      root!.unmount()
    })
    await IDLE()

    expect(renewal.calls[0]!.signal.aborted).toBe(true)
    expect(unhandled).toEqual([])
  })

  it('leaves no unhandled rejection when the page is hidden mid-read', async () => {
    const pending = pendingServerFn((signal) => signal.reason)
    await mount(serverFns(pending.fn))
    expect(pending.calls).toHaveLength(1)

    await act(async () => {
      page.visibilityState = 'hidden'
      page.dispatch('visibilitychange')
    })
    await IDLE()

    expect(pending.calls[0]!.signal.aborted).toBe(true)
    expect(unhandled).toEqual([])

    await act(async () => {
      root!.unmount()
    })
    await IDLE()
    expect(unhandled).toEqual([])
  })
})
