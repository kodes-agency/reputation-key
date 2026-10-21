// Test support only (`use-google-review-check.test.ts`, `use-google-return-check.test.ts`):
// mounts `useGoogleReviewCheck` the way the pane does, over a fake page, with a
// stub in place of the server function. Nothing in the app imports it.
//
// The unit project has no DOM, so the hook is mounted on React DOM's real
// reconciler over a stand-in document that has only what the reconciler
// touches. The page's clock, timers and visibility are `fakePage()`, handed to
// the hook, and the server function is a stub that answers what a test says.
// Each suite mocks `@tanstack/react-router` and `sonner` itself (a `vi.mock` is
// hoisted per test file).

import { act, createElement } from 'react'
import {
  QueryClient,
  QueryClientProvider,
  environmentManager,
} from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import type {
  InboxGoogleCheckOutcome,
  InboxItem,
} from '#/contexts/inbox/application/public-api'
import { fakePage } from './google-return-fake-page'
import type { InboxServerFns } from './types'
import type { GoogleReviewCheck } from './use-google-review-check'

export const MINUTE = 60_000
export const IDLE = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

/** The stub for `checkReviewOnGoogleFn`: answers each call from `outcomes`, in order. */
export function stubServer(outcomes: ReadonlyArray<InboxGoogleCheckOutcome | Error>) {
  let call = 0
  const fn = vi.fn(async (_input: { data: { reviewId: string } }) => {
    const next = outcomes[call++] ?? 'no_reply'
    if (next instanceof Error) throw next
    return { outcome: next }
  })
  return { fn, asServerFn: fn as unknown as InboxServerFns['checkReviewOnGoogle'] }
}

/** The document React's reconciler touches: an event target and nothing else. */
const fakeDocument = () => {
  const doc = {
    nodeType: 9,
    activeElement: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const view = { document: doc, setTimeout, clearTimeout, HTMLIFrameElement: class {} }
  return Object.assign(doc, { defaultView: view })
}

let latest: GoogleReviewCheck | null = null
const capture = (value: GoogleReviewCheck) => {
  latest = value
}

/** Registers the per-test page, client and mount, and returns what a suite does with them. */
export function installHookHarness() {
  let root: { render(node: unknown): void; unmount(): void } | undefined
  let page = fakePage()
  let client = new QueryClient()
  let doc: ReturnType<typeof fakeDocument>
  let createRoot: typeof import('react-dom/client').createRoot
  let useGoogleReviewCheck: typeof import('./use-google-review-check').useGoogleReviewCheck

  beforeAll(async () => {
    doc = fakeDocument()
    vi.stubGlobal('window', doc.defaultView)
    vi.stubGlobal('document', doc)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    environmentManager.setIsServer(() => false)
    ;({ createRoot } = await import('react-dom/client'))
    ;({ useGoogleReviewCheck } = await import('./use-google-review-check'))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    environmentManager.setIsServer(() => typeof window === 'undefined')
  })

  beforeEach(() => {
    page = fakePage()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    latest = null
    // The suite's `sonner` mock keeps its calls from test to test otherwise.
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
  })

  const container = () => ({
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: doc,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })

  return {
    page: () => page,
    client: () => client,
    /** What the hook last returned. */
    check: (): GoogleReviewCheck => {
      if (latest === null) throw new Error('The hook has not rendered')
      return latest
    },
    /** Render the pane with `item` open (a second call is a re-render with another item). */
    async show(
      item: InboxItem | null,
      server: InboxServerFns['checkReviewOnGoogle'],
    ): Promise<void> {
      const Probe = () => {
        capture(
          useGoogleReviewCheck({ item, checkReviewOnGoogle: server, env: page.env }),
        )
        return null
      }
      root ??= createRoot(container() as unknown as Element)
      await act(async () => {
        root!.render(createElement(QueryClientProvider, { client }, createElement(Probe)))
      })
    },
    async unmount(): Promise<void> {
      await act(async () => {
        root!.unmount()
      })
      root = undefined
    },
    /** The manager chose "Open on Google", was away for `awayFor`, and the tab is visible again. */
    async backFromGoogle(awayFor = 3 * MINUTE): Promise<void> {
      await act(async () => {
        latest!.noteOpenedGoogle()
        page.hide()
        page.advance(awayFor)
        page.show()
      })
      await IDLE()
    },
    async passTime(ms: number): Promise<void> {
      await act(async () => {
        page.advance(ms)
      })
      await IDLE()
    },
  }
}
