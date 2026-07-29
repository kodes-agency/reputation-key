// BQC-6.6 — browser-initiated request collector.
//
// The BQC-6.2 harness (error-detection.ts) records DETECTIONS, not a request
// log, so it cannot prove an ABSENCE. Dark-context promotion needs exactly
// that proof: "no browser-initiated read, mutation, upload, export, or
// external call". This helper is a tiny page.on('request') collector with two
// assertions:
//
//   assertNoMutations(except)          — zero browser-issued POST/PUT/PATCH/
//                                        DELETE whose URL matches none of the
//                                        `except` substrings
//   assertNoExternalHosts(allowedHosts) — zero http(s) requests to hosts
//                                        outside `allowedHosts`
//
// Scope rules match the 6.2 harness: only BROWSER traffic surfaces as page
// events — page.request APIRequestContext calls (signIn's auth API posts) are
// never recorded here. WebSockets are separate page events and not recorded.
//
// Font CDNs: styles.css @imports Satoshi (api.fontshare.com → cdn.fontshare.com
// binaries) and Plus Jakarta Sans/JetBrains Mono (fonts.googleapis.com →
// fonts.gstatic.com binaries). Those are the app's OWN static assets shipped
// with every page — not external service/data calls — so they are
// default-allowed in assertNoExternalHosts. Anything else external (Resend,
// Google APIs, AI providers, analytics) still fails the assertion.

import { expect, type Page, type Request } from '@playwright/test'

export type RecordedRequest = Readonly<{
  method: string
  url: string
  /** URL host (host:port), or '' for non-URLs. */
  host: string
}>

export type RequestLog = Readonly<{
  /** Requests recorded so far (copy — safe to inspect mid-test). */
  requests: readonly RecordedRequest[]
  /**
   * Fails when any recorded http(s) mutation (POST/PUT/PATCH/DELETE) matches
   * none of the `except` substrings. GET server-fn RPCs (gateDarkRoute and
   * the denied GET /_server reads) are reads, not mutations, and never count.
   */
  assertNoMutations(except?: readonly string[]): void
  /**
   * Fails when any recorded http(s) request went to a host outside
   * `allowedHosts` ∪ FONT_CDN_HOSTS. Pass the app origin host(s) the test
   * intends to touch (e.g. ['localhost:3001']).
   */
  assertNoExternalHosts(allowedHosts: readonly string[]): void
  /** Detach the listener (collector stops recording). */
  detach(): void
}>

/** The app's own stylesheet font CDNs — static assets, not service calls. */
export const FONT_CDN_HOSTS: readonly string[] = [
  'api.fontshare.com',
  'cdn.fontshare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function isHttp(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

function formatViolations(violations: readonly RecordedRequest[]): string {
  return violations.map((r) => `${r.method} ${r.url}`).join('\n  ')
}

/** Attach the collector to a page. Listeners register synchronously — call
 * before the navigation under test. */
export function attachRequestLog(page: Page): RequestLog {
  const requests: RecordedRequest[] = []
  const onRequest = (request: Request) => {
    let host: string
    try {
      host = new URL(request.url()).host
    } catch {
      host = ''
    }
    requests.push({ method: request.method(), url: request.url(), host })
  }
  page.on('request', onRequest)

  return {
    get requests() {
      return [...requests]
    },
    assertNoMutations(except = []) {
      const violations = requests.filter(
        (r) =>
          isHttp(r.url) &&
          MUTATION_METHODS.has(r.method) &&
          !except.some((pattern) => r.url.includes(pattern)),
      )
      expect(
        violations,
        `expected zero browser-initiated mutations, recorded:\n  ${formatViolations(violations)}`,
      ).toEqual([])
    },
    assertNoExternalHosts(allowedHosts) {
      const allowed = new Set([...allowedHosts, ...FONT_CDN_HOSTS])
      const violations = requests.filter((r) => isHttp(r.url) && !allowed.has(r.host))
      expect(
        violations,
        `expected zero requests outside ${[...allowed].join(', ')}, recorded:\n  ${formatViolations(violations)}`,
      ).toEqual([])
    },
    detach() {
      page.off('request', onRequest)
    },
  }
}
