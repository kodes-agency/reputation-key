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
// Navigation-abort correlation: TanStack Router passes an AbortSignal into
// route-loader fetches, so ordinary client-side navigation (or a redirect such
// as the property deep-dive's ?timeRange=all default) aborts in-flight GET
// serverFn requests. In dev, React then logs the rejection as a console.error
// ("TypeError: Failed to fetch ... <MatchInnerImpl>"). The aborted request
// itself is unambiguous — requestfailed carries net::ERR_ABORTED — so the
// harness suppresses that specific React echo ONLY when a GET abort was just
// observed on the same page. A genuine fetch failure (server down) aborts
// nothing, so it still fails the gate. Aborted MUTATIONS stay gated: a write
// interrupted mid-flight is a real signal, not navigation noise.
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
  'pageerror' | 'console-error' | 'mutation-status' | 'request-failed'

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

/** Critical mutations the network gate watches (browser-issued traffic only —
 * page.request APIRequestContext calls never surface as page events). */
function isCriticalMutation(method: string, url: URL): boolean {
  if (method === 'POST' && url.pathname.startsWith('/_server')) return true
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
  // Timestamps of recent GET request aborts (net::ERR_ABORTED) on this page —
  // see "Navigation-abort correlation" in the file header.
  const recentGetAborts: number[] = []
  const NAVIGATION_ABORT_WINDOW_MS = 3_000

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
    // Navigation-abort echo: React dev logs the aborted route-loader fetch as
    // a component error. Suppress only with a fresh GET abort on record.
    if (text.includes('Failed to fetch') && text.includes('MatchInnerImpl')) {
      const cutoff = now() - NAVIGATION_ABORT_WINDOW_MS
      if (recentGetAborts.some((t) => t >= cutoff)) {
        transcript.push(
          `[console.error:navigation-abort] ${text.split('\n')[0]} (page: ${page.url()})`,
        )
        return
      }
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
    detections.push({ kind: 'console-error', message: text, pageUrl: page.url() })
  }

  const onResponse = (response: Response) => {
    const request = response.request()
    const url = parseUrl(response.url())
    if (!url) return
    const method = request.method()
    if (!isCriticalMutation(method, url)) return
    const status = response.status()
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
    // Non-mutation traffic is not gated, but GET aborts are remembered: they
    // legitimate the React "Failed to fetch" navigation echo (header comment).
    if (method === 'GET' && errorText.includes('ERR_ABORTED')) {
      recentGetAborts.push(now())
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
