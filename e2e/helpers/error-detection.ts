// BQC-6.2 — client/runtime error detection harness.
//
// What this does: every spec imports `test`/`expect` from here instead of
// '@playwright/test'. The `test` export attaches detectors to the `page`
// fixture BEFORE any navigation and, after the test body runs, fails the test
// if any of these fired during it:
//
//   - pageerror         uncaught exceptions, incl. unhandled promise rejections
//                       (Playwright reports both through this one event)
//   - console-error     console.error(...) output not matched by the allowlist
//   - mutation-status   non-2xx response to a CRITICAL MUTATION: a POST to
//                       /_server* (TanStack server-fn RPC) or a mutating
//                       POST/PUT/PATCH/DELETE to /api/auth/* (better-auth) —
//                       except allowlisted endpoint+status pairs
//   - request-failed    net-level failure (DNS / refused / aborted) on those
//                       same mutation paths
//
// Navigation-abort correlation: TanStack Start's client issues route-loader and
// query fetches as GET /_serverFn/<hash>. A hard navigation tears the document
// down while some are still in flight, and Chromium cancels them — the fetch
// promises reject with `TypeError: Failed to fetch`, React's error boundary
// catches, and react-dom's defaultOnCaughtError logs the error through
// console.error.
//
// The ECHO TEXT IS BUILD-DEPENDENT and must never be the key: the development
// build appends a component stack ("... <MatchInnerImpl>") while the production
// build logs the bare TypeError with no frames at all (react-dom's
// defaultOnCaughtError is `console.error(error)` — see
// react-dom/cjs/react-dom-client.production.js). Keying on those frames is what
// let this echo through beta-acceptance, which runs the production image.
//
// So the key is the EVIDENCE, not the wording: a `TypeError: Failed to fetch`
// echo is suppressed only by spending one server-function GET abort that this
// harness itself observed (requestfailed carries net::ERR_ABORTED) within
// NAVIGATION_ABORT_WINDOW_MS. Three properties keep that from becoming an
// amnesty for broken fetches:
//   - only /_server* GETs count — an aborted image or prefetch excuses nothing;
//   - each abort is SPENT by at most one echo, so N cancelled requests can
//     explain at most N rejections and an extra echo still fails the gate;
//   - a genuine failure aborts nothing (ERR_CONNECTION_REFUSED, ERR_FAILED,
//     a 5xx), so it never records an excuse in the first place.
// Aborted MUTATIONS stay gated: a write interrupted mid-flight is a real
// signal, not navigation noise.
//
// Document-status correlation: a route may DELIBERATELY answer a navigation
// with a 4xx — the portal detail loader throws `notFound()` for a portal that
// is absent from the URL property's authorized collection, TanStack turns that
// notFound match into `statusCode` 404, and the SSR document is served with
// that status. Chromium logs every >=400 resource load, document included, as
// "Failed to load resource: the server responded with a status of NNN ()".
// That line is a browser network-log entry, not application output: it cannot
// be silenced at source without downgrading a correct 404 to a soft 200.
//
// So the harness suppresses that echo ONLY when it has itself observed a >=400
// response to the MAIN-FRAME DOCUMENT request at exactly the URL the echo
// points at, keyed on (status, url). A failed SUBRESOURCE — image, API call,
// server-fn GET — echoes with its OWN url in ConsoleMessage.location(), which
// is never a main-frame navigation response, so it still fails the gate. The
// document's status is not hidden by this: it is the one thing a spec can read
// straight off `page.goto()`, and the cross-property fail-closed journey
// asserts it. Correlation is order-independent — an echo that arrives before
// its response event is recorded and dropped when the response lands.
//
// Fail mode: detections are collected, and fixture teardown throws ONE error
// listing all of them (with the page URL for each), attaching the full
// transcript (detections + every console warning/error line) via
// testInfo.attach — the artifacts floor. Trace/video/upload config is BQC-6.4.
//
// Known-benign output goes through e2e/helpers/error-allowlist.ts ONLY:
// narrow, owned, expiring entries. Expired entries never suppress. pageerror
// entries additionally require a pagePattern scope so an exception can never
// hide uncaught errors suite-wide.
//
// The collector machinery is exported separately from the auto-fail fixture so
// e2e/error-detection.spec.ts can drive it directly for the injection proof.

import { test as base, expect } from '@playwright/test'
import type { ConsoleMessage, Page, Request, Response, TestInfo } from '@playwright/test'
import { ERROR_ALLOWLIST, type AllowlistEntry } from './error-allowlist'

export type DetectionKind =
  | 'pageerror'
  | 'console-error'
  | 'mutation-status'
  | 'request-failed'

export type Detection = Readonly<{
  kind: DetectionKind
  /** Human-readable summary (original error message / request line). */
  message: string
  /** URL of the page when the detection fired. */
  pageUrl: string
  /** Original stack for pageerror detections. */
  stack?: string
}>

export type ErrorCollector = Readonly<{
  /** Detections recorded so far (copy — safe to poll). */
  detections: readonly Detection[]
  /**
   * Throws a single Error listing every detection when any were recorded;
   * attaches the transcript to testInfo when provided. No-op when clean.
   */
  assertEmpty(testInfo?: TestInfo): Promise<void>
  /** Detach all listeners (collector stops recording). */
  detach(): void
}>

export type AttachOptions = Readonly<{
  /**
   * Extra allowlist entries appended to ERROR_ALLOWLIST for this collector.
   * Used by the injection proof to exercise suppression/expiry without
   * touching the shipped list.
   */
  extraAllowlist?: readonly AllowlistEntry[]
  /** Clock override for expiry checks (defaults to Date.now). */
  now?: () => number
}>

/** An entry suppresses through the END of its expiry day (UTC); after that it
 * is dead weight and must not match — stale exceptions become failures again. */
export function isAllowlistEntryExpired(
  entry: AllowlistEntry,
  now: number = Date.now(),
): boolean {
  const endOfDay = Date.parse(`${entry.expires}T23:59:59.999Z`)
  if (Number.isNaN(endOfDay)) return true // malformed expiry fails closed
  return now > endOfDay
}

function matchesPattern(pattern: RegExp | string, text: string): boolean {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)
}

function findAllowlistMatch(
  allowlist: readonly AllowlistEntry[],
  kind: AllowlistEntry['kind'],
  text: string,
  status: number | undefined,
  pageUrl: string,
  now: number,
): AllowlistEntry | undefined {
  return allowlist.find((entry) => {
    if (entry.kind !== kind) return false
    if (isAllowlistEntryExpired(entry, now)) return false
    // pageerror entries MUST be page-scoped — an unscoped one would hide
    // uncaught errors anywhere in the suite, so it never matches.
    if (kind === 'pageerror' && entry.pagePattern === undefined) return false
    if (entry.pagePattern !== undefined && !matchesPattern(entry.pagePattern, pageUrl)) {
      return false
    }
    if (!matchesPattern(entry.pattern, text)) return false
    if (kind === 'mutation-status') {
      if (entry.status === undefined || status === undefined) return false
      return typeof entry.status === 'number'
        ? entry.status === status
        : entry.status.test(String(status))
    }
    return true
  })
}

/**
 * TanStack Start's server-function RPC prefix. Mutations POST to `/_server*`;
 * route-loader and query reads are `GET /_serverFn/<hash>`. One prefix serves
 * both the mutation gate and the navigation-abort correlation.
 */
const SERVER_FN_PATH_PREFIX = '/_server'

/** Critical mutations the network gate watches (browser-issued traffic only —
 * page.request APIRequestContext calls never surface as page events). */
function isCriticalMutation(method: string, url: URL): boolean {
  if (method === 'POST' && url.pathname.startsWith(SERVER_FN_PATH_PREFIX)) return true
  if (
    (method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH' ||
      method === 'DELETE') &&
    url.pathname.startsWith('/api/auth/')
  ) {
    return true
  }
  return false
}

/**
 * Chromium's network-log line for any resource that came back >=400. Group 1 is
 * the status; the resource itself is in ConsoleMessage.location().url.
 */
const RESOURCE_STATUS_ECHO =
  /^Failed to load resource: the server responded with a status of (\d+)/

/**
 * A rejected `fetch()` reported through console.error. Anchored at the start so
 * it cannot match prose that merely mentions the phrase, and deliberately blind
 * to everything after it: the frames differ between the development and
 * production builds (see "Navigation-abort correlation" in the file header).
 */
const FETCH_REJECTION_ECHO = /^TypeError: Failed to fetch\b/

function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw)
  } catch {
    return undefined
  }
}

function formatDetections(detections: readonly Detection[], title?: string): string {
  const header = title
    ? `E2E error gate — ${detections.length} runtime error(s) in "${title}":`
    : `E2E error gate — ${detections.length} runtime error(s):`
  const body = detections
    .map((d, i) => {
      const lines = [`[${i + 1}] ${d.kind}: ${d.message}`, `    page: ${d.pageUrl}`]
      if (d.stack) lines.push(`    stack: ${d.stack}`)
      return lines.join('\n')
    })
    .join('\n\n')
  return `${header}\n\n${body}\n\nKnown-benign signals belong in e2e/helpers/error-allowlist.ts (narrow, owned, expiring) — everything else is a real failure.`
}

/** Attach all detectors to a page. Listeners are registered synchronously, so
 * call this before the first navigation. */
export function attachErrorDetection(
  page: Page,
  options: AttachOptions = {},
): ErrorCollector {
  const allowlist = [...ERROR_ALLOWLIST, ...(options.extraAllowlist ?? [])]
  const now = options.now ?? (() => Date.now())
  const detections: Detection[] = []
  const transcript: string[] = []
  // Timestamps of server-function GET aborts (net::ERR_ABORTED) observed on
  // this page and not yet spent on a console echo — see "Navigation-abort
  // correlation" in the file header.
  const unspentServerFnGetAborts: number[] = []
  const NAVIGATION_ABORT_WINDOW_MS = 3_000
  // `${status} ${url}` for every >=400 MAIN-FRAME DOCUMENT response seen on
  // this page, and the console echoes still waiting for one — see
  // "Document-status correlation" in the file header.
  const documentStatusKeys = new Set<string>()
  const unmatchedStatusEchoes = new Map<Detection, string>()

  /** Record a deliberate document status and retire any echo that preceded it. */
  const recordDocumentStatus = (key: string) => {
    documentStatusKeys.add(key)
    for (const [detection, echoKey] of unmatchedStatusEchoes) {
      if (echoKey !== key) continue
      unmatchedStatusEchoes.delete(detection)
      const index = detections.indexOf(detection)
      if (index < 0) continue
      detections.splice(index, 1)
      transcript.push(
        `[console.error:document-status] ${detection.message} (echo preceded its document response)`,
      )
    }
  }

  /**
   * Spend one in-window server-function GET abort on a fetch-rejection echo.
   * Records outside the window are dropped rather than kept: they can never
   * legitimate anything again, and leaving them would let a stale cancellation
   * excuse a much later failure. Returns false when nothing was available, in
   * which case the echo is a real detection.
   */
  const spendServerFnGetAbort = (): boolean => {
    const cutoff = now() - NAVIGATION_ABORT_WINDOW_MS
    const fresh = unspentServerFnGetAborts.findIndex((at) => at >= cutoff)
    if (fresh < 0) {
      unspentServerFnGetAborts.length = 0
      return false
    }
    unspentServerFnGetAborts.splice(0, fresh + 1)
    return true
  }

  const onPageError = (error: Error) => {
    const pageUrl = page.url()
    const match = findAllowlistMatch(
      allowlist,
      'pageerror',
      error.message,
      undefined,
      pageUrl,
      now(),
    )
    if (match) {
      transcript.push(
        `[pageerror:allowlisted:${match.id}] ${error.stack ?? error.message} (page: ${pageUrl})`,
      )
      return
    }
    detections.push({
      kind: 'pageerror',
      message: error.message,
      stack: error.stack,
      pageUrl,
    })
    transcript.push(`[pageerror] ${error.stack ?? error.message} (page: ${pageUrl})`)
  }

  const onConsole = (msg: ConsoleMessage) => {
    const type = msg.type()
    if (type !== 'error' && type !== 'warning') return
    const location = msg.location()
    const where = location?.url
      ? `${location.url}:${location.lineNumber}:${location.columnNumber}`
      : 'unknown-source'
    transcript.push(`[console.${type}] ${msg.text()} (${where}; page: ${page.url()})`)
    if (type !== 'error') return
    const text = msg.text()
    // Navigation-abort echo: React's error boundary logs the cancelled
    // route-loader fetch through console.error. The wording is build-dependent,
    // so the only key is a server-function GET abort this harness saw — and
    // each one is spent here, so a second echo needs a second cancellation.
    if (FETCH_REJECTION_ECHO.test(text) && spendServerFnGetAbort()) {
      transcript.push(
        `[console.error:navigation-abort] ${text.split('\n')[0]} (page: ${page.url()})`,
      )
      return
    }
    const consoleMatch = findAllowlistMatch(
      allowlist,
      'console-error',
      text,
      undefined,
      page.url(),
      now(),
    )
    if (consoleMatch) {
      transcript.push(`[console.error:allowlisted:${consoleMatch.id}] ${text}`)
      return
    }
    // Browser network-log echo of a >=400 resource. Suppressed only when the
    // SAME url answered the main-frame document request with the SAME status:
    // a deliberate 404/410 navigation is the spec's business, not the gate's.
    const statusEcho = RESOURCE_STATUS_ECHO.exec(text)
    if (statusEcho && location?.url) {
      const key = `${statusEcho[1]} ${location.url}`
      if (documentStatusKeys.has(key)) {
        transcript.push(`[console.error:document-status] ${text} (${where})`)
        return
      }
      const pending: Detection = {
        kind: 'console-error',
        message: text,
        pageUrl: page.url(),
      }
      detections.push(pending)
      unmatchedStatusEchoes.set(pending, key)
      return
    }
    detections.push({ kind: 'console-error', message: text, pageUrl: page.url() })
  }

  const onResponse = (response: Response) => {
    const request = response.request()
    const url = parseUrl(response.url())
    if (!url) return
    const status = response.status()
    if (status >= 400 && request.isNavigationRequest()) {
      let isMainFrame = false
      try {
        isMainFrame = request.frame() === page.mainFrame()
      } catch {
        // Service-worker-owned requests have no frame — never the document.
      }
      if (isMainFrame) recordDocumentStatus(`${status} ${response.url()}`)
    }
    const method = request.method()
    if (!isCriticalMutation(method, url)) return
    if (status >= 200 && status < 300) return
    const fullUrl = response.url()
    const statusMatch = findAllowlistMatch(
      allowlist,
      'mutation-status',
      fullUrl,
      status,
      page.url(),
      now(),
    )
    if (statusMatch) {
      transcript.push(
        `[mutation-status:allowlisted:${statusMatch.id}] ${method} ${fullUrl} → HTTP ${status} (page: ${page.url()})`,
      )
      return
    }
    detections.push({
      kind: 'mutation-status',
      message: `${method} ${fullUrl} → HTTP ${status}`,
      pageUrl: page.url(),
    })
  }

  const onRequestFailed = (request: Request) => {
    const url = parseUrl(request.url())
    if (!url) return
    const method = request.method()
    const errorText = request.failure()?.errorText ?? 'unknown'
    if (isCriticalMutation(method, url)) {
      detections.push({
        kind: 'request-failed',
        message: `${method} ${request.url()} failed at network level: ${errorText}`,
        pageUrl: page.url(),
      })
      return
    }
    // Non-mutation traffic is not gated, but a cancelled server-function GET is
    // remembered: it is the one thing that legitimates a "Failed to fetch"
    // console echo (header comment). Aborted images, prefetches and /api reads
    // excuse nothing — they never reach a route loader's error boundary.
    if (
      method === 'GET' &&
      url.pathname.startsWith(SERVER_FN_PATH_PREFIX) &&
      errorText.includes('ERR_ABORTED')
    ) {
      unspentServerFnGetAborts.push(now())
      transcript.push(
        `[request-aborted] GET ${url.pathname} aborted during navigation (page: ${page.url()})`,
      )
    }
  }

  page.on('pageerror', onPageError)
  page.on('console', onConsole)
  page.on('response', onResponse)
  page.on('requestfailed', onRequestFailed)

  return {
    get detections() {
      return [...detections]
    },
    async assertEmpty(testInfo?: TestInfo) {
      if (detections.length === 0) return
      const report = formatDetections(detections, testInfo?.title)
      const body = `${report}\n\n── transcript (detections + console warning/error) ──\n${
        transcript.length > 0
          ? transcript.join('\n')
          : '(no console warning/error output)'
      }\n`
      if (testInfo) {
        await testInfo.attach('e2e-error-transcript', {
          body,
          contentType: 'text/plain',
        })
      }
      throw new Error(body)
    },
    detach() {
      page.off('pageerror', onPageError)
      page.off('console', onConsole)
      page.off('response', onResponse)
      page.off('requestfailed', onRequestFailed)
    },
  }
}

/**
 * The harness `test`. Specs import { test, expect } from this module instead of
 * '@playwright/test'. The page-fixture override attaches detectors before any
 * navigation and asserts zero detections in teardown, so the FIRST test that
 * produces a runtime error fails immediately with the original error.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    // BQC-6.1 hermeticity: styles.css @imports font CSS from external CDNs
    // (api.fontshare.com, fonts.googleapis.com — binaries from cdn.fontshare.com /
    // fonts.gstatic.com). Tests must never depend on real network — fontshare
    // returned 500 in CI once and gated a green suite (#274). Stub the four
    // hosts with an empty stylesheet; glyph rendering is irrelevant to every
    // assertion. Follow-up for the product: self-host the fonts.
    await page.route(
      /api\.fontshare\.com|cdn\.fontshare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/,
      (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
    )
    const collector = attachErrorDetection(page)
    await use(page)
    await collector.assertEmpty(testInfo)
  },
})

export { expect }
